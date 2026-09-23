/* Healthy Vitalss — Founding 250 kiosk.
   Attract → capture → payoff, then a full reset. Every entry is written to this device first
   and synced to Supabase in the background (claim_founding_place is idempotent by request key),
   so venue Wi-Fi never decides whether a visitor gets their place. */
(() => {
  'use strict';

  /* ================================================================ configuration */
  const CONFIG = {
    supabaseUrl: 'https://dxsihfggouctydraqctd.supabase.co',
    publishableKey: 'sb_publishable_9r5UL1PYTnTxlWLbDG8mHg_h4H13DRD',   // anon; may only call claim_founding_place
    event: 'olympia-2026',
    captureIdleMs: 45000,      // kiosk: an abandoned entry clears after this long
    payoffHoldMs: 10000,       // kiosk: how long the confirmation holds before the next visitor
    requestTimeoutMs: 8000,
    syncEveryMs: 10000,
  };
  const COPY = {
    closed: 'The Founding 250 is now complete. Thank you for finding us.',
    offline: 'We couldn’t connect just now. Check your signal and try again. Your details are still here.',
    name: 'Enter your first name.',
    email: 'Enter your email to save your place.',
    emailBad: 'That email doesn’t look right. Please check it.',
    fallbackName: 'friend',
  };

  /* ================================================================ environment */
  const html = document.documentElement;
  const $ = (s) => document.querySelector(s);
  const params = new URLSearchParams(location.search);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const tabletSized = Math.min(screen.width, screen.height) >= 700;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const kiosk = params.has('kiosk') ? params.get('kiosk') !== '0' : (standalone || (coarse && tabletSized));
  const source = (CONFIG.event + '-' + (params.get('s') || (kiosk ? 'kiosk' : 'web'))).replace(/[^a-z0-9-]/gi, '').slice(0, 60);
  html.classList.toggle('kiosk', kiosk);
  html.style.setProperty('--hold-ms', CONFIG.payoffHoldMs + 'ms');

  const stage = $('#stage'), form = $('#form'), first = $('#first'), email = $('#email'), msg = $('#msg');
  const fFirst = $('#f-first'), fEmail = $('#f-email'), saveBtn = $('#save'), beginBtn = $('#begin');
  const panels = { attract: $('#p-attract'), capture: $('#p-capture'), payoff: $('#p-payoff') };

  /* ================================================================ states */
  let state = 'attract', idleTimer = 0, holdTimer = 0;
  function setState(next) {
    state = next;
    html.dataset.state = next;
    for (const [k, el] of Object.entries(panels)) {
      const on = k === next;
      el.toggleAttribute('inert', !on);
      el.setAttribute('aria-hidden', String(!on));
    }
    light.onState(next);
  }
  function bumpIdle() {
    clearTimeout(idleTimer);
    if (kiosk && state === 'capture') idleTimer = setTimeout(reset, CONFIG.captureIdleMs);
  }
  function reset() {
    clearTimeout(idleTimer); clearTimeout(holdTimer);
    try { document.activeElement && document.activeElement.blur(); } catch (_) {}
    first.value = ''; email.value = ''; say(''); ignoredSuggestion = '';
    delete html.dataset.busy; saveBtn.disabled = false;
    html.classList.remove('typing');
    setState('attract');
    window.scrollTo(0, 0);
  }

  /* one tap anywhere on the attract screen begins; the wordmark is the staff door */
  function begin(e) {
    if (state !== 'attract') return;
    if (e && e.target && e.target.closest && e.target.closest('#word')) return;
    motion.arm();                 // iPadOS only grants motion inside a tap
    press(beginBtn);
    setState('capture');
    bumpIdle();
    try { first.focus({ preventScroll: true }); } catch (_) { first.focus(); }
  }
  stage.addEventListener('click', (e) => { if (state === 'attract') begin(e); });
  addEventListener('pointerdown', bumpIdle, { passive: true });
  // iPadOS grants motion only from a completed tap (click / touchend), never from pointerdown
  addEventListener('click', () => motion.arm(), { capture: true });
  addEventListener('touchend', () => motion.arm(), { capture: true, passive: true });
  addEventListener('keydown', (e) => { if (state === 'attract' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); begin(); } });

  function press(btn) {
    if (!btn || reduce) return;
    btn.classList.remove('pressed'); void btn.offsetWidth; btn.classList.add('pressed');
    setTimeout(() => btn.classList.remove('pressed'), 900);
  }
  document.querySelectorAll('.action').forEach((b) => b.addEventListener('pointerdown', () => press(b), { passive: true }));

  /* ================================================================ messages */
  const ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.3v4.6M8 11.1v.9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
  function mark(which) {
    fFirst.classList.toggle('bad', which === 'first');
    fEmail.classList.toggle('bad', which === 'email');
    first.setAttribute('aria-invalid', String(which === 'first'));
    email.setAttribute('aria-invalid', String(which === 'email'));
  }
  function say(text, which, soft) {
    msg.classList.toggle('soft', !!soft);
    msg.textContent = '';
    if (text) { msg.innerHTML = ICON; const s = document.createElement('span'); s.textContent = text; msg.append(s); }
    mark(which || '');
  }
  function sayNode(node) {
    msg.classList.add('soft'); msg.innerHTML = ICON;
    const s = document.createElement('span'); s.append(node); msg.append(s); mark('');
  }

  /* ================================================================ validation */
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const DOMAINS = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com', 'me.com', 'live.com', 'msn.com', 'comcast.net', 'proton.me', 'protonmail.com', 'att.net', 'sbcglobal.net', 'verizon.net', 'mac.com', 'ymail.com', 'googlemail.com'];
  const lev = (a, b) => {
    const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i].concat(Array(n).fill(0)));
    for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[m][n];
  };
  function suggest(addr) {
    const at = addr.lastIndexOf('@'); if (at < 1) return null;
    const user = addr.slice(0, at), dom = addr.slice(at + 1).toLowerCase();
    if (DOMAINS.includes(dom) || dom.length < 5) return null;
    let best = null, bd = 3;
    for (const c of DOMAINS) { const x = lev(dom, c); if (x < bd) { bd = x; best = c; } }
    return best && bd <= 2 ? user + '@' + best : null;
  }
  const cleanName = (v) => v.replace(/[\u0000-\u001F\u007F<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  let ignoredSuggestion = '';

  first.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); email.focus(); } });
  first.addEventListener('input', () => { if (fFirst.classList.contains('bad')) say(''); bumpIdle(); });
  email.addEventListener('input', () => { if (msg.textContent) say(''); bumpIdle(); });
  saveBtn.addEventListener('mousedown', (e) => e.preventDefault());   // keep the keyboard up through the tap

  /* ================================================================ submit */
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (html.dataset.busy) return;
    const name = cleanName(first.value);
    const addr = email.value.trim().toLowerCase();
    if (!name) { say(COPY.name, 'first'); first.focus(); return; }
    if (!addr) { say(COPY.email, 'email'); email.focus(); return; }
    if (!EMAIL_RE.test(addr) || addr.length > 254) { say(COPY.emailBad, 'email'); email.focus(); return; }
    const alt = suggest(addr);
    if (alt && ignoredSuggestion !== addr) {
      const f = document.createDocumentFragment();
      f.append('Did you mean ');
      const yes = document.createElement('button'); yes.type = 'button'; yes.className = 'link'; yes.textContent = alt;
      yes.addEventListener('click', () => { email.value = alt; say(''); form.requestSubmit(); });
      const no = document.createElement('button'); no.type = 'button'; no.className = 'link'; no.textContent = 'use as typed';
      no.addEventListener('click', () => { ignoredSuggestion = addr; say(''); form.requestSubmit(); });
      f.append(yes, '? Or ', no, '.');
      sayNode(f);
      return;
    }
    say('');
    html.dataset.busy = '1'; saveBtn.disabled = true;

    const entry = queue.add({ firstName: name, email: addr, source });
    if (kiosk) {
      // the device holds the entry; the visitor never waits on the venue network
      toPayoff(name);
      sync.now();
    } else {
      const outcome = await sync.one(entry, true);
      if (outcome === 'sent') toPayoff(name);
      else if (outcome === 'closed') { say(COPY.closed, '', true); }
      else if (outcome === 'rejected') { say(COPY.emailBad, 'email'); }
      else { say(COPY.offline); }
    }
    delete html.dataset.busy; saveBtn.disabled = false;
  });

  function toPayoff(name) {
    clearTimeout(idleTimer);
    try { document.activeElement && document.activeElement.blur(); } catch (_) {}
    html.classList.remove('typing');
    const shown = (name.split(' ')[0] || COPY.fallbackName);
    const who = $('#who');
    who.textContent = shown;
    who.parentElement.parentElement.classList.toggle('long', shown.length > 11);
    setState('payoff');
    window.scrollTo(0, 0);
    if (kiosk) holdTimer = setTimeout(reset, CONFIG.payoffHoldMs);
  }
  $('#done').addEventListener('click', reset);

  /* ================================================================ keyboard: keep the form above it */
  const vv = window.visualViewport;
  function typingOn() { html.classList.add('typing'); bumpIdle(); [60, 250, 600].forEach((t) => setTimeout(() => window.scrollTo(0, 0), t)); }
  function typingOffSoon() {
    setTimeout(() => {
      const a = document.activeElement;
      if (a !== first && a !== email) { html.classList.remove('typing'); window.scrollTo(0, 0); }
    }, 140);
  }
  [first, email].forEach((el) => { el.addEventListener('focus', typingOn); el.addEventListener('blur', typingOffSoon); });
  if (vv) vv.addEventListener('resize', () => {
    const open = vv.height < innerHeight * 0.82;
    if (!open && html.classList.contains('typing') && document.activeElement !== first && document.activeElement !== email) html.classList.remove('typing');
    window.scrollTo(0, 0);
  });

  /* ================================================================ local queue */
  const KEY = 'hv-f250-queue-v2';
  let mem = [];
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
  const queue = {
    load() { try { const q = JSON.parse(localStorage.getItem(KEY) || '[]'); mem = Array.isArray(q) ? q : []; } catch (_) {} return mem; },
    save(q) { mem = q; try { localStorage.setItem(KEY, JSON.stringify(q)); return true; } catch (_) { return false; } },
    add(p) {
      const q = queue.load();
      const same = q.find((it) => it.state === 'pending' && it.email === p.email);
      if (same) { same.firstName = p.firstName; queue.save(q); return same; }
      const it = { id: uuid(), firstName: p.firstName, email: p.email, source: p.source, ts: new Date().toISOString(), tries: 0, next: 0, state: 'pending' };
      q.push(it); queue.save(q); staff.paint(); return it;
    },
    update(it) { const q = queue.load(); const i = q.findIndex((x) => x.id === it.id); if (i >= 0) q[i] = it; else q.push(it); queue.save(q); },
    prune() {   // once synced, a visitor's details leave this device; only a receipt stays for counts
      const week = Date.now() - 7 * 864e5;
      queue.save(queue.load().filter((it) => !(it.state === 'sent' && Date.parse(it.ts) < week)));
    },
  };

  /* ================================================================ sync */
  let lastSync = null, lastError = '';
  const fetchT = (url, opts, ms) => {
    const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
    return fetch(url, Object.assign({}, opts, { signal: c.signal })).finally(() => clearTimeout(t));
  };
  const sync = {
    busy: false,
    async one(it, immediate) {
      try {
        const r = await fetchT(CONFIG.supabaseUrl + '/rest/v1/rpc/claim_founding_place', {
          method: 'POST',
          headers: { 'content-type': 'application/json', apikey: CONFIG.publishableKey },
          body: JSON.stringify({ firstName: it.firstName, email: it.email, requestKey: it.id, source: it.source }),
          cache: 'no-store', credentials: 'omit', keepalive: true,
        }, CONFIG.requestTimeoutMs);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        lastSync = new Date(); lastError = '';
        if (j && j.recorded) {
          Object.assign(it, { state: 'sent', receipt: j.receiptId || null, firstName: null, email: null, sentAt: lastSync.toISOString() });
          queue.update(it); staff.paint(); return 'sent';
        }
        const code = (j && j.code) || 'UNKNOWN';
        Object.assign(it, { state: 'rejected', code });
        queue.update(it); staff.paint();
        return code === 'SIGNUPS_CLOSED' || code === 'CAPACITY_REACHED' ? 'closed' : 'rejected';
      } catch (err) {
        lastError = String(err && err.message || err);
        it.tries = (it.tries || 0) + 1;
        it.next = Date.now() + Math.min(60000, 2000 * Math.pow(2, Math.min(it.tries, 5))) * (0.8 + Math.random() * 0.4);
        queue.update(it); staff.paint();
        if (immediate && it.tries < 2) { await new Promise((res) => setTimeout(res, 900)); return sync.one(it, false); }
        return 'offline';
      }
    },
    async now(force) {
      if (sync.busy) return; sync.busy = true;
      try {
        for (const it of queue.load()) {
          if (it.state !== 'pending') continue;
          if (!force && it.next && it.next > Date.now()) continue;
          await sync.one(it, false);
        }
        queue.prune();
      } finally { sync.busy = false; staff.paint(); }
    },
  };
  setInterval(() => sync.now(), CONFIG.syncEveryMs);
  addEventListener('online', () => sync.now(true));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync.now(); });

  /* ================================================================ light: alive, not animated */
  const ground = document.querySelector('.ground');
  const brand = $('#brand');
  const sheen = document.getElementById('sheen');
  const tokenFace = document.querySelector('.token-face');
  const tilt = { x: 0, y: 0, tx: 0, ty: 0, bx: null, by: null, rawX: 0, rawY: 0, last: 0 };
  const pointer = { x: 0, y: 0, tx: 0, ty: 0, last: 0 };
  const motion = {
    state: reduce ? 'off (reduced motion)' : 'waiting',
    asked: false,
    listen() {
      if (motion.listening) return; motion.listening = true;
      addEventListener('deviceorientation', (e) => {
        if (e.beta == null || e.gamma == null) return;
        const a = ((screen.orientation && screen.orientation.angle) || window.orientation || 0) % 360;
        let x, y;
        if (a === 90 || a === -270) { x = e.beta; y = -e.gamma; }
        else if (a === 270 || a === -90) { x = -e.beta; y = e.gamma; }
        else if (a === 180 || a === -180) { x = -e.gamma; y = -e.beta; }
        else { x = e.gamma; y = e.beta; }
        if (Math.abs(e.beta) > 84 && (a === 0 || a === 180)) x = tilt.rawX;   // hold x through the upright gimbal point
        tilt.rawX = x; tilt.rawY = y;
        if (tilt.bx === null) { tilt.bx = x; tilt.by = y; }
        tilt.last = performance.now();
        if (motion.state !== 'on') { motion.state = 'on'; staff.paint(); }
      }, { passive: true });
    },
    arm() {
      if (reduce || motion.asked) return;
      const DOE = window.DeviceOrientationEvent;
      if (!DOE || typeof DOE.requestPermission !== 'function') return;
      if (motion.state === 'on') return;
      motion.asked = true;
      try {
        DOE.requestPermission().then((r) => {
          if (r === 'granted') { motion.listen(); if (motion.state !== 'on') motion.state = 'granted'; }
          else motion.state = 'denied — enable in Settings › Safari';
          staff.paint();
        }).catch(() => { motion.asked = false; motion.state = 'needs a tap'; staff.paint(); });
      } catch (_) { motion.asked = false; }
    },
  };
  if (!reduce) {
    motion.listen();   // Android and desktop deliver at once; iPadOS once a tap has granted it
    if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') motion.state = 'needs a tap';
    addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      pointer.tx = (e.clientX / innerWidth - 0.5) * 2; pointer.ty = (e.clientY / innerHeight - 0.5) * 2; pointer.last = performance.now();
    }, { passive: true });
  }

  const light = {
    t: 0, lastFrame: 0, lastPaint: 0, raf: 0,
    onState() {},
    frame(now) {
      light.raf = requestAnimationFrame(light.frame);
      if (now - light.lastPaint < 32) return;   // ~30 fps is plenty for light this slow
      const dt = Math.min(0.1, (now - (light.lastFrame || now)) / 1000);
      light.lastFrame = now; light.lastPaint = now; light.t += dt;
      const t = light.t, TAU = Math.PI * 2;

      // tilt relative to how the device is being held: the baseline follows slowly
      if (tilt.bx !== null) {
        const k = Math.min(1, dt / 6);
        tilt.bx += (tilt.rawX - tilt.bx) * k; tilt.by += (tilt.rawY - tilt.by) * k;
        tilt.tx = Math.max(-1, Math.min(1, (tilt.rawX - tilt.bx) / 16));
        tilt.ty = Math.max(-1, Math.min(1, (tilt.rawY - tilt.by) / 16));
      }
      const ks = Math.min(1, dt * 5);
      tilt.x += (tilt.tx - tilt.x) * ks; tilt.y += (tilt.ty - tilt.y) * ks;
      const pOn = now - pointer.last < 4000 ? 1 : 0;
      pointer.x += (pointer.tx * pOn - pointer.x) * Math.min(1, dt * 2.5);
      pointer.y += (pointer.ty * pOn - pointer.y) * Math.min(1, dt * 2.5);

      // ambient: a slow drift of the key light, never a loop anyone can see restart
      const ax = 0.55 * Math.sin(TAU * t / 19) + 0.30 * Math.sin(TAU * t / 31 + 1.3);
      const ay = 0.45 * Math.cos(TAU * t / 23 + 0.6) + 0.20 * Math.sin(TAU * t / 41);
      const lx = Math.max(-1.4, Math.min(1.4, ax * 0.6 + tilt.x * 1.1 + pointer.x * 0.8));
      const ly = Math.max(-1.4, Math.min(1.4, ay * 0.6 + tilt.y * 1.1 + pointer.y * 0.6));
      light.apply(lx, ly);
    },
    apply(lx, ly) {
      const vmax = Math.max(innerWidth, innerHeight) / 100;
      const s = ground.style;
      s.setProperty('--kx', ((-8 + lx * 9) * vmax).toFixed(1) + 'px');
      s.setProperty('--ky', ((-22 + ly * 6) * vmax).toFixed(1) + 'px');
      s.setProperty('--cx', (-lx * 3.5 * vmax).toFixed(1) + 'px');
      s.setProperty('--cy', (-ly * 2.5 * vmax).toFixed(1) + 'px');
      s.setProperty('--wx', (lx * 1.8 * vmax).toFixed(1) + 'px');
      s.setProperty('--wy', (ly * 1.2 * vmax).toFixed(1) + 'px');
      s.setProperty('--gx', (50 + lx * 30).toFixed(1) + '%');
      brand.style.setProperty('--px', (-lx * 3).toFixed(2) + 'px');
      brand.style.setProperty('--py', (-ly * 2).toFixed(2) + 'px');
      // the satin band on the mark sits where the light would catch it
      const c = 660 + lx * 760;
      const x1 = (c - 420).toFixed(0), x2 = (c + 420).toFixed(0);
      if (sheen.getAttribute('x1') !== x1) { sheen.setAttribute('x1', x1); sheen.setAttribute('x2', x2); }
      if (tokenFace) { tokenFace.style.setProperty('--tx', (34 + lx * 12).toFixed(1) + '%'); tokenFace.style.setProperty('--ty', (26 + ly * 10).toFixed(1) + '%'); }
    },
    start() { if (!light.raf && !reduce) { light.lastFrame = 0; light.raf = requestAnimationFrame(light.frame); } },
    stop() { if (light.raf) cancelAnimationFrame(light.raf); light.raf = 0; },
  };
  if (reduce) light.apply(0, 0); else light.start();
  document.addEventListener('visibilitychange', () => { document.hidden ? light.stop() : light.start(); });

  /* ================================================================ staff panel */
  const staffEl = $('#staff');
  const staff = {
    paint() {
      if (staffEl.hidden) return;
      const q = queue.load();
      $('#s-pending').textContent = q.filter((i) => i.state === 'pending').length;
      $('#s-sent').textContent = q.filter((i) => i.state === 'sent').length;
      const rej = q.filter((i) => i.state === 'rejected');
      $('#s-rejected').textContent = rej.length;
      $('#s-last').textContent = lastSync ? lastSync.toLocaleTimeString() : '—';
      $('#s-net').textContent = navigator.onLine ? (lastError ? 'online · last try failed' : 'online') : 'offline';
      $('#s-motion').textContent = motion.state;
      $('#s-mode').textContent = (kiosk ? 'kiosk' : 'web') + ' · ' + source;
      const codes = [...new Set(rej.map((i) => i.code))].join(', ');
      $('#s-note').textContent = (lastError ? 'Last error: ' + lastError + '. ' : '') + (codes ? 'Needs attention: ' + codes + '. Export them before clearing the device.' : '');
    },
    open() { staffEl.hidden = false; staff.paint(); clearTimeout(idleTimer); clearTimeout(holdTimer); },
    close() { staffEl.hidden = true; if (state !== 'attract') reset(); },
  };
  const word = $('#word');
  let taps = [], lp = 0;
  word.addEventListener('pointerdown', (e) => { e.stopPropagation(); clearTimeout(lp); lp = setTimeout(staff.open, 1800); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => word.addEventListener(ev, () => clearTimeout(lp)));
  word.addEventListener('click', (e) => {
    e.stopPropagation();
    const n = Date.now(); taps = taps.filter((t) => n - t < 3000); taps.push(n);
    if (taps.length >= 5) { taps = []; staff.open(); }
  });
  word.addEventListener('contextmenu', (e) => e.preventDefault());
  $('#s-close').addEventListener('click', staff.close);
  $('#s-sync').addEventListener('click', () => sync.now(true));
  $('#s-motion-btn').addEventListener('click', () => { motion.asked = false; motion.arm(); staff.paint(); });
  $('#s-csv').addEventListener('click', () => {
    const rows = queue.load().filter((i) => i.state !== 'sent');
    const esc = (v) => { v = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
    const csv = [['request_key', 'first_name', 'email', 'source', 'signed_up_at', 'state', 'code']]
      .concat(rows.map((i) => [i.id, i.firstName, i.email, i.source, i.ts, i.state, i.code || '']))
      .map((r) => r.map(esc).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'founding250-waiting-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.append(a); a.click(); a.remove();
  });

  /* ================================================================ offline shell */
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }

  /* ================================================================ start */
  setState('attract');
  sync.now(true);

  // test hooks (read-only views; nothing here changes behaviour)
  window.__hv = { state: () => state, queue: () => queue.load(), motion: () => motion.state, kiosk, source };
})();
