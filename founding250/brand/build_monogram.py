"""Construct a clean HV monogram from the traced outline.

Every stroke edge is one straight line fitted to the trace; joins are exact
intersections; each serif is a crisp end plus one smooth cubic into its stroke,
fitted to the traced points. Output: SVG path in the same coordinate frame as the
original viewBox (0 0 1318.36 818.57, with the V point overshooting the baseline).
"""
import json
import re
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from trace_tools import *  # noqa: E402,F401,F403  (contours_from_d, resample_closed, tls_line, ...)

# The source is the original auto-trace, kept beside this script. Its path sits in page
# coordinates; the translate on the path element brings it into the viewBox frame.
_traced = (HERE / 'hv-monogram-traced-original.svg').read_text()
TRACE_D = re.search(r' d="([^"]+)"', _traced).group(1)
P = contours_from_d(TRACE_D, -366.65, -377.30)[0]
Q, h = resample_closed(P, 0.5)
n = len(Q)
X, Y = Q[:, 0], Q[:, 1]


class Line:
    def __init__(self, c, d):
        self.c = np.asarray(c, float)
        d = np.asarray(d, float)
        self.d = d / np.hypot(*d)

    def at_y(self, y):
        t = (y - self.c[1]) / self.d[1]
        return self.c + t * self.d

    def at_x(self, x):
        t = (x - self.c[0]) / self.d[0]
        return self.c + t * self.d

    def dist(self, p):
        v = np.asarray(p) - self.c
        return abs(v[0] * self.d[1] - v[1] * self.d[0])


def meet(a, b):
    return line_intersect(a.c, a.d, b.c, b.d)


def fit(mask, vertical=False, horizontal=False):
    pts = Q[mask]
    if vertical:
        return Line([np.median(pts[:, 0]), 0], [0, 1]), len(pts)
    if horizontal:
        return Line([0, np.median(pts[:, 1])], [1, 0]), len(pts)
    c, d, _ = tls_line(pts)
    return Line(c, d), len(pts)


def near_line(a, b, band):
    L = Line(a, np.subtract(b, a))
    return np.array([L.dist(p) < band for p in Q])


# ---- straight edges ------------------------------------------------------
stemL, _ = fit((X < 140) & (Y > 150) & (Y < 680), vertical=True)
stemR, _ = fit((X > 150) & (X < 240) & (((Y > 130) & (Y < 330)) | ((Y > 395) & (Y < 700))), vertical=True)
barT, _ = fit((X > 240) & (X < 640) & (Y > 330) & (Y < 362), horizontal=True)
barB, _ = fit((X > 240) & (X < 660) & (Y > 362) & (Y < 395), horizontal=True)
thickL, _ = fit(near_line((566, 65), (901, 833), 7) & (((Y > 95) & (Y < 330)) | ((Y > 400) & (Y < 800))))
thickR, _ = fit(near_line((700, 79), (949, 653), 7) & (Y > 115) & (Y < 620))
thinL, _ = fit(near_line((949, 653), (1185, 119), 7) & (Y > 150) & (Y < 620))
thinR, _ = fit(near_line((1189, 181), (908, 829), 7) & (Y > 210) & (Y < 800))
y_top = float(np.median(Y[(Y < 3) & (((X > 20) & (X < 265)) | ((X > 505) & (X < 740)) | ((X > 1155) & (X < 1295)))]))
y_bot = float(np.median(Y[(Y > 811) & (X > 20) & (X < 265)]))
vb_pts = Q[(X > 880) & (X < 930) & (Y > 800)]
y_vb = float(vb_pts[:, 1].max())

# ---- serif halves ----------------------------------------------------------
corners, turn = find_corners(Q, h, 7, 34, 9)
tips = [c for c in corners if abs(turn[c]) > 100]


def nearest_tip(x, y):
    return min(tips, key=lambda c: np.hypot(X[c] - x, Y[c] - y))


def walk(i, step):
    return (i + step) % n


def serif(tip_xy, flat_y, stroke, toward):
    """toward = +1 or -1: contour direction from the tip toward the stroke."""
    ti = nearest_tip(*tip_xy)
    # extreme x of the rounded tip
    idx = [walk(ti, k) for k in range(-40, 41)]
    xs = X[idx]
    x_tip = xs.min() if tip_xy[0] < stroke.at_y(flat_y)[0] else xs.max()
    # underside direction: trace points 5..22 units from the tip, toward the stroke
    us = [walk(ti, toward * k) for k in range(int(5 / h), int(22 / h))]
    cu, du, _ = tls_line(Q[us])
    if np.dot(du, Q[us[-1]] - Q[us[0]]) < 0:
        du = -du
    under = Line(cu, du)
    face_end = under.at_x(x_tip)
    # join on the stroke: walk toward the stroke until the trace settles onto the stroke line
    k = 0
    path_idx = []
    j = ti
    while k < 2400:
        j = walk(j, toward)
        path_idx.append(j)
        if stroke.dist(Q[j]) < 1.2:
            # require it to stay on the line for the next 15 units
            ahead = [walk(j, toward * m) for m in range(1, int(15 / h))]
            if all(stroke.dist(Q[a]) < 2.5 for a in ahead):
                break
        k += 1
    J = stroke.c + np.dot(Q[j] - stroke.c, stroke.d) * stroke.d
    # stroke direction pointing from J away from the serif (into the straight stroke)
    sd = stroke.d if np.dot(stroke.d, Q[walk(j, toward * 60)] - Q[j]) > 0 else -stroke.d
    pts = np.vstack([face_end, Q[path_idx[int(4 / h):]], J])
    pts = resample_open(pts, 1.0)
    pts[0], pts[-1] = face_end, J
    t1 = du
    t2 = -sd
    u = chord_params(pts)
    ctrl = fit_cubic(pts, t1, t2, u)
    for _ in range(6):
        u = reparam(ctrl, pts, u)
        ctrl = fit_cubic(pts, t1, t2, u)
    err = np.hypot(*(bez(ctrl, u) - pts).T)
    return dict(x_tip=float(x_tip), flat=np.array([x_tip, flat_y]), face_end=face_end, J=J, ctrl=ctrl, maxerr=float(err.max()), meanerr=float(err.mean()))


S = {}
S['thinTL'] = serif((1134, 6), y_top, thinL, -1)
S['thinTR'] = serif((1318, 6), y_top, thinR, +1)
S['HBR'] = serif((285, 810), y_bot, stemR, -1)
S['HBL'] = serif((0, 811), y_bot, stemL, +1)
S['HTL'] = serif((0, 6), y_top, stemL, -1)
S['HTR'] = serif((285, 7), y_top, stemR, +1)
S['thickTL'] = serif((485, 7), y_top, thickL, -1)
S['thickTR'] = serif((758, 8), y_top, thickR, +1)

# ---- assemble the outline -------------------------------------------------
vb_r = thinR.at_y(y_vb)
vb_l = thickL.at_y(y_vb)
if vb_r[0] < vb_l[0]:           # the edges cross above the flat: use a sharp point
    vb_l = vb_r = meet(thinR, thickL)
inner = meet(thickR, thinL)
bar_bl, bar_br = meet(stemR, barB), meet(thickL, barB)
bar_tl, bar_tr = meet(stemR, barT), meet(thickL, barT)

out = []


def M(p): out.append(('M', np.asarray(p)))
def L(p): out.append(('L', np.asarray(p)))
def C(ctrl): out.append(('C', ctrl))


def serif_out(s):            # from the tip end face into the stroke (as fitted)
    L(s['face_end'])
    C(s['ctrl'])


def serif_in(s):             # from the stroke join back to the tip (reverse cubic), then the face
    c = s['ctrl'][::-1]
    C(c)
    L(s['flat'])


M(S['thinTL']['flat'])
L(S['thinTR']['flat'])
serif_out(S['thinTR'])
L(vb_r)
if not np.allclose(vb_r, vb_l):
    L(vb_l)
L(bar_br)
L(bar_bl)
L(S['HBR']['J'])
serif_in(S['HBR'])
L(S['HBL']['flat'])
serif_out(S['HBL'])
L(S['HTL']['J'])
serif_in(S['HTL'])
L(S['HTR']['flat'])
serif_out(S['HTR'])
L(bar_tl)
L(bar_tr)
L(S['thickTL']['J'])
serif_in(S['thickTL'])
L(S['thickTR']['flat'])
serif_out(S['thickTR'])
L(inner)
L(S['thinTL']['J'])
serif_in(S['thinTL'])
out.append(('Z', None))

d = cmds_to_d(out)
SVG = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1318.36 818.57" role="img" '
       'aria-label="Healthy Vitalss HV monogram"><path fill="#131311" d="{}"/></svg>\n')
(HERE / 'hv-monogram.svg').write_text(SVG.format(d))
report = {k: {'x_tip': round(v['x_tip'], 1), 'maxerr': round(v['maxerr'], 2), 'meanerr': round(v['meanerr'], 2)} for k, v in S.items()}
report['lines'] = {'stemL_x': round(stemL.c[0], 2), 'stemR_x': round(stemR.c[0], 2), 'barT_y': round(barT.c[1], 2), 'barB_y': round(barB.c[1], 2),
                   'y_top': round(y_top, 2), 'y_bot': round(y_bot, 2), 'y_vb': round(y_vb, 2),
                   'thickL_slope': round(thickL.d[0] / thickL.d[1], 4), 'thickR_slope': round(thickR.d[0] / thickR.d[1], 4),
                   'thinL_slope': round(thinL.d[0] / thinL.d[1], 4), 'thinR_slope': round(thinR.d[0] / thinR.d[1], 4)}
report['vbottom'] = [np.round(vb_l, 1).tolist(), np.round(vb_r, 1).tolist()]
report['segments'] = sum(1 for k, _ in out if k in 'LC')
print(json.dumps(report, indent=1))
