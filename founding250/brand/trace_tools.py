"""Helpers for redrawing a noisy auto-traced outline as clean vector geometry.

Used by build_monogram.py.

Pipeline per closed contour:
  1. sample the traced path densely and resample by arc length
  2. find real corners (large, fast turns) and rebuild each as a crisp vertex
     where the tangent lines on either side meet
  3. between corners, denoise along the arc, split into straight runs and curves
  4. straight runs become true lines; curves become G1-continuous cubic Beziers
"""
import sys, json, math
import numpy as np
from scipy.ndimage import gaussian_filter1d
from svgpathtools import parse_path

H_STEP = 0.5          # resample step (units)


def contours_from_d(d, tx, ty):
    path = parse_path(d)
    out = []
    for sp in path.continuous_subpaths():
        pts = []
        for seg in sp:
            n = max(6, int(seg.length() / 0.15))
            ts = np.linspace(0, 1, n, endpoint=False)
            pts.extend(seg.point(t) for t in ts)
        z = np.array(pts) + complex(tx, ty)
        out.append(np.column_stack([z.real, z.imag]))
    return out


def resample_closed(P, h):
    Q = np.vstack([P, P[:1]])
    seg = np.hypot(*np.diff(Q, axis=0).T)
    s = np.concatenate([[0], np.cumsum(seg)])
    L = s[-1]
    n = max(16, int(round(L / h)))
    t = np.linspace(0, L, n, endpoint=False)
    return np.column_stack([np.interp(t, s, Q[:, 0]), np.interp(t, s, Q[:, 1])]), L / n


def signed_area(P):
    x, y = P[:, 0], P[:, 1]
    return 0.5 * np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y)


def tls_line(P):
    c = P.mean(axis=0)
    u, s, vt = np.linalg.svd(P - c)
    d = vt[0]
    dev = np.abs((P - c) @ vt[1])
    return c, d, dev.max()


def line_intersect(p1, d1, p2, d2):
    A = np.array([d1, -d2]).T
    if abs(np.linalg.det(A)) < 1e-9:
        return None
    t = np.linalg.solve(A, p2 - p1)
    return p1 + t[0] * d1


def find_corners(Q, h, win=7.0, thresh=48.0, nms=9.0):
    n = len(Q)
    S = np.column_stack([gaussian_filter1d(Q[:, 0], 2.0 / h, mode='wrap'),
                         gaussian_filter1d(Q[:, 1], 2.0 / h, mode='wrap')])
    D = np.roll(S, -1, axis=0) - np.roll(S, 1, axis=0)
    th = np.unwrap(np.arctan2(D[:, 1], D[:, 0]))
    k = max(1, int(round(win / h)))
    # turning over +-k, from wrapped angle differences (safe across the seam)
    dth = np.angle(np.exp(1j * (np.roll(th, -1) - th)))
    cum = np.concatenate([[0], np.cumsum(np.concatenate([dth, dth, dth]))])
    idx = np.arange(n) + n
    turn = np.degrees(cum[idx + k] - cum[idx - k])
    cand = np.where(np.abs(turn) > thresh)[0]
    corners = []
    m = int(round(nms / h))
    for i in cand:
        lo, hi = i - m, i + m
        window = np.abs(turn[np.arange(lo, hi + 1) % n])
        if np.abs(turn[i]) >= window.max() - 1e-9:
            if all(min((i - c) % n, (c - i) % n) > m for c in corners):
                corners.append(i)
    return sorted(corners), turn


def crisp_vertex(Q, i, h, near=8.0, far=40.0, maxd=25.0):
    n = len(Q)
    a = [(i - j) % n for j in range(int(far / h), int(near / h), -1)]
    b = [(i + j) % n for j in range(int(near / h), int(far / h))]
    ca, da, _ = tls_line(Q[a])
    cb, db, _ = tls_line(Q[b])
    v = line_intersect(ca, da, cb, db)
    if v is None or np.hypot(*(v - Q[i])) > maxd:
        return Q[i].copy()
    return v


def smooth_open(P, sigma_pts):
    """Gaussian smoothing with endpoints pinned (odd reflection keeps ends and slopes)."""
    if len(P) < 5 or sigma_pts < 0.5:
        return P.copy()
    pad = min(len(P) - 1, int(3 * sigma_pts) + 1)
    head = 2 * P[0] - P[1:pad + 1][::-1]
    tail = 2 * P[-1] - P[-pad - 1:-1][::-1]
    E = np.vstack([head, P, tail])
    Sx = gaussian_filter1d(E[:, 0], sigma_pts, mode='nearest')
    Sy = gaussian_filter1d(E[:, 1], sigma_pts, mode='nearest')
    return np.column_stack([Sx, Sy])[pad:pad + len(P)]


def resample_open(P, h):
    seg = np.hypot(*np.diff(P, axis=0).T)
    s = np.concatenate([[0], np.cumsum(seg)])
    L = s[-1]
    if L < 1e-6:
        return P[:1].copy()
    n = max(2, int(round(L / h)) + 1)
    t = np.linspace(0, L, n)
    return np.column_stack([np.interp(t, s, P[:, 0]), np.interp(t, s, P[:, 1])])


# ---------- Bezier fitting (Schneider, with fixed end tangents) ----------
def bez(ctrl, t):
    t = t[:, None]
    mt = 1 - t
    return mt ** 3 * ctrl[0] + 3 * mt ** 2 * t * ctrl[1] + 3 * mt * t ** 2 * ctrl[2] + t ** 3 * ctrl[3]


def chord_params(P):
    d = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(P, axis=0).T))])
    return d / d[-1] if d[-1] > 0 else np.linspace(0, 1, len(P))


def fit_cubic(P, t1, t2, u):
    p0, p3 = P[0], P[-1]
    b0, b1, b2, b3 = (1 - u) ** 3, 3 * u * (1 - u) ** 2, 3 * u ** 2 * (1 - u), u ** 3
    A1 = t1[None, :] * b1[:, None]
    A2 = t2[None, :] * b2[:, None]
    C = np.array([[np.sum(A1 * A1), np.sum(A1 * A2)], [np.sum(A1 * A2), np.sum(A2 * A2)]])
    tmp = P - (p0[None] * (b0 + b1)[:, None] + p3[None] * (b2 + b3)[:, None])
    X = np.array([np.sum(A1 * tmp), np.sum(A2 * tmp)])
    seglen = np.hypot(*(p3 - p0))
    try:
        a1, a2 = np.linalg.solve(C, X)
    except np.linalg.LinAlgError:
        a1 = a2 = seglen / 3
    eps = 1e-6 * seglen
    if a1 < eps or a2 < eps or a1 > seglen * 1.6 or a2 > seglen * 1.6:
        a1 = a2 = seglen / 3
    return np.array([p0, p0 + a1 * t1, p3 + a2 * t2, p3])


def reparam(ctrl, P, u):
    for _ in range(3):
        t = u[:, None]
        mt = 1 - t
        Q = bez(ctrl, u)
        d1 = 3 * (mt ** 2 * (ctrl[1] - ctrl[0]) + 2 * mt * t * (ctrl[2] - ctrl[1]) + t ** 2 * (ctrl[3] - ctrl[2]))
        d2 = 6 * (mt * (ctrl[2] - 2 * ctrl[1] + ctrl[0]) + t * (ctrl[3] - 2 * ctrl[2] + ctrl[1]))
        num = np.sum((Q - P) * d1, axis=1)
        den = np.sum(d1 * d1, axis=1) + np.sum((Q - P) * d2, axis=1)
        den[np.abs(den) < 1e-12] = 1e-12
        u = np.clip(u - num / den, 0, 1)
        u[0], u[-1] = 0, 1
    return u


def unit(v):
    n = np.hypot(*v)
    return v / n if n > 1e-12 else v


def fit_curve(P, t1, t2, tol, depth=0):
    if len(P) == 2:
        L = np.hypot(*(P[1] - P[0])) / 3
        return [np.array([P[0], P[0] + t1 * L, P[1] + t2 * L, P[1]])]
    u = chord_params(P)
    ctrl = fit_cubic(P, t1, t2, u)
    for _ in range(4):
        err = np.hypot(*(bez(ctrl, u) - P).T)
        if err.max() <= tol:
            return [ctrl]
        u = reparam(ctrl, P, u)
        ctrl = fit_cubic(P, t1, t2, u)
    err = np.hypot(*(bez(ctrl, u) - P).T)
    if err.max() <= tol * (1.8 if depth == 0 else 1.0) or depth > 8 or len(P) < 8:
        return [ctrl]
    k = int(np.argmax(err[2:-2])) + 2
    tc = unit(P[min(k + 2, len(P) - 1)] - P[max(k - 2, 0)])
    return fit_curve(P[:k + 1], t1, -tc, tol, depth + 1) + fit_curve(P[k:], tc, t2, tol, depth + 1)


# ---------- straight-run detection ----------
def split_runs(S, eps, min_len, h):
    """Return list of (i0, i1, kind) covering S; kind 'L' for straight runs, 'C' for curves."""
    n = len(S)
    runs = []
    i = 0
    min_pts = int(min_len / h)
    while i < n - 1:
        j = i + min_pts
        if j >= n:
            break
        _, _, dev = tls_line(S[i:j + 1])
        if dev <= eps:
            while j + 1 < n:
                _, _, dev2 = tls_line(S[i:j + 2])
                if dev2 > max(eps, 0.006 * (j + 1 - i) * h):
                    break
                j += 1
            runs.append((i, j, 'L'))
            i = j
        else:
            i += 1
    # fill gaps with curves
    pieces = []
    cur = 0
    for (a, b, k) in runs:
        if a > cur:
            pieces.append((cur, a, 'C'))
        pieces.append((a, b, 'L'))
        cur = b
    if cur < n - 1:
        pieces.append((cur, n - 1, 'C'))
    return pieces


def fmt(v):
    s = f"{v:.2f}".rstrip('0').rstrip('.')
    return '0' if s in ('-0', '') else s


def refit_contour(P, params):
    h = H_STEP
    Q, h = resample_closed(P, h)
    corners, turn = find_corners(Q, h, params['win'], params['corner_deg'], params['nms'])
    n = len(Q)
    if not corners:
        # smooth closed contour: start at the point of maximum turning
        corners = [int(np.argmax(np.abs(turn)))]
        sharp = False
    else:
        sharp = True
    verts = [crisp_vertex(Q, c, h) if sharp else Q[c].copy() for c in corners]
    trim = int(params['trim'] / h) if sharp else 0
    cmds = []
    start = verts[0]
    cmds.append(('M', start))
    for ci in range(len(corners)):
        c0, c1 = corners[ci], corners[(ci + 1) % len(corners)]
        v0, v1 = verts[ci], verts[(ci + 1) % len(corners)]
        span = (c1 - c0) % n or n
        idx = [(c0 + j) % n for j in range(trim, span - trim + 1)]
        if len(idx) < 2:
            cmds.append(('L', v1))
            continue
        seg = np.vstack([v0, Q[idx], v1])
        seg = resample_open(seg, h)
        sm = smooth_open(seg, params['sigma'] / h)
        sm[0], sm[-1] = v0, v1
        S1 = resample_open(sm, 1.0)
        pieces = split_runs(S1, params['line_eps'], params['line_min'], 1.0)
        # build lines + curves with G1 joins
        lines = {}
        for (a, b, k) in pieces:
            if k == 'L':
                c, d, _ = tls_line(S1[a:b + 1])
                if np.dot(d, S1[b] - S1[a]) < 0:
                    d = -d
                pa = c + np.dot(S1[a] - c, d) * d
                pb = c + np.dot(S1[b] - c, d) * d
                lines[(a, b)] = (pa, pb, d)
        # snap consecutive endpoints
        prev_end = S1[0]
        prev_dir = None
        out = []
        for pi, (a, b, k) in enumerate(pieces):
            last = pi == len(pieces) - 1
            if k == 'L':
                pa, pb, d = lines[(a, b)]
                if pi == 0:
                    pa = S1[0] if np.hypot(*(pa - S1[0])) < 3.5 else pa
                if last:
                    pb = S1[-1] if np.hypot(*(pb - S1[-1])) < 3.5 else pb
                if pi > 0 and pieces[pi - 1][2] == 'L' and out and out[-1][0] == 'L':
                    x = line_intersect(out[-1][1], prev_dir, pa, d)
                    if x is not None and np.hypot(*(x - pa)) < 6:
                        out[-1] = ('L', x)
                elif pi == 0 and np.hypot(*(pa - prev_end)) > 0.05:
                    out.append(('L', pa))
                out.append(('L', pb))
                prev_end, prev_dir = pb, d
            else:
                seg_pts = S1[a:b + 1].copy()
                p0 = prev_end if pi > 0 else S1[0]
                nxt = pieces[pi + 1] if not last else None
                p1 = lines[(nxt[0], nxt[1])][0] if nxt and nxt[2] == 'L' else S1[b]
                seg_pts[0], seg_pts[-1] = p0, p1
                t1 = prev_dir if prev_dir is not None else unit(seg_pts[min(4, len(seg_pts) - 1)] - seg_pts[0])
                if nxt and nxt[2] == 'L':
                    t2 = -lines[(nxt[0], nxt[1])][2]
                else:
                    t2 = unit(seg_pts[max(-5, -len(seg_pts))] - seg_pts[-1])
                for ctrl in fit_curve(seg_pts, t1, t2, params['tol']):
                    out.append(('C', ctrl))
                prev_end = p1
                prev_dir = unit(out[-1][1][3] - out[-1][1][2]) if out[-1][0] == 'C' else prev_dir
        cmds.extend(out)
    cmds.append(('Z', None))
    return cmds, len(corners)


def cmds_to_d(cmds):
    parts = []
    last = None
    clean = []
    for k, v in cmds:
        if k == 'L' and last is not None and np.hypot(*(np.asarray(v) - last)) < 0.6:
            continue
        clean.append((k, v))
        if k in ('M', 'L'):
            last = np.asarray(v)
        elif k == 'C':
            last = np.asarray(v[3])
    cmds = clean
    for k, v in cmds:
        if k == 'M':
            parts.append(f"M{fmt(v[0])} {fmt(v[1])}")
        elif k == 'L':
            parts.append(f"L{fmt(v[0])} {fmt(v[1])}")
        elif k == 'C':
            parts.append("C" + " ".join(f"{fmt(p[0])} {fmt(p[1])}" for p in v[1:]))
        else:
            parts.append("Z")
    return "".join(parts)
