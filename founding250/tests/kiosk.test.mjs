import { chromium } from 'playwright-core';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { dirname, extname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

// Behaviour tests for the kiosk: run with `npm test` from this folder.
// Serves ../public locally and mocks the Supabase RPC, so nothing touches the live list.
// Set CHROMIUM_PATH to use a system Chromium instead of a Playwright-managed one.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const srv = createServer(async (q, r) => {
  let p = join(ROOT, decodeURIComponent(q.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html'; if (!extname(p)) p = join(ROOT, 'index.html');
  try { const b = await readFile(p); r.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' }); r.end(b); } catch { r.writeHead(404); r.end(); }
}).listen(4811);
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const results = []; const ok = (name, cond, info = '') => { results.push((cond ? 'PASS ' : 'FAIL ') + name + (info ? '  — ' + info : '')); };
async function page(opts = {}, q = '?kiosk=1') {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 820, height: 1180 }, deviceScaleFactor: 1, hasTouch: true, reducedMotion: opts.reducedMotion || 'no-preference' });
  const pg = await ctx.newPage(); const errors = []; pg.on('pageerror', (e) => errors.push(e.message)); pg.on('console', (m) => { if (m.type() === 'error' && !/ERR_INTERNET_DISCONNECTED/.test(m.text())) errors.push(m.text()); });
  if (opts.clock) await pg.clock.install();
  if (opts.init) await pg.addInitScript(opts.init);
  const calls = []; let mode = opts.rpc || 'ok';
  await pg.route('**/rest/v1/rpc/claim_founding_place', async (route) => {
    calls.push(route.request().postDataJSON());
    if (mode === 'down') return route.abort('internetdisconnected');
    if (mode === 'closed') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"code":"CAPACITY_REACHED"}' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"recorded":true,"receiptId":"r-1","welcomeStatus":"pending_followup","testOnly":false}' });
  });
  await pg.goto('http://localhost:4811/' + q, { waitUntil: 'load' });
  return { pg, ctx, calls, errors, setMode: (m) => { mode = m; } };
}

// 1. keyboard clearance: in typing mode the button must sit above a worst-case iPad keyboard
for (const [name, vp, kb] of [['iPad 11 portrait', { width: 820, height: 1180 }, 390], ['iPad 11 landscape', { width: 1180, height: 820 }, 440], ['iPad Pro 12.9 portrait', { width: 1024, height: 1366 }, 420], ['iPad Pro 12.9 landscape', { width: 1366, height: 1024 }, 470], ['iPad mini portrait', { width: 744, height: 1133 }, 380], ['iPad mini landscape', { width: 1133, height: 744 }, 420]]) {
  const { pg, ctx, errors } = await page({ viewport: vp });
  await pg.click('#begin'); await pg.waitForTimeout(900);
  const g = await pg.evaluate(() => { const b = document.querySelector('#save').getBoundingClientRect(); const e = document.querySelector('#email').getBoundingClientRect(); const h = document.querySelector('#h-capture').getBoundingClientRect(); return { typing: document.documentElement.classList.contains('typing'), save: Math.round(b.bottom), email: Math.round(e.bottom), headTop: Math.round(h.top), vh: innerHeight }; });
  ok(`${name}: form clears keyboard`, g.typing && g.save <= g.vh - kb - 8 && g.headTop >= 0, JSON.stringify(g) + ' visible=' + (g.vh - kb));
  ok(`${name}: no errors`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// 2. kiosk offline: visitor still confirmed, entry queued, synced later, then details purged
{
  const { pg, ctx, calls, setMode, errors } = await page({ rpc: 'down' });
  await pg.click('#begin'); await pg.fill('#first', 'Ana María'); await pg.fill('#email', 'ana@example.com'); await pg.click('#save'); await pg.waitForTimeout(600);
  const s1 = await pg.evaluate(() => ({ st: __hv.state(), q: __hv.queue() }));
  ok('offline kiosk: confirmation shown', s1.st === 'payoff');
  ok('offline kiosk: entry held with details', s1.q.length === 1 && s1.q[0].state === 'pending' && s1.q[0].email === 'ana@example.com', JSON.stringify(s1.q[0]));
  setMode('ok'); await pg.evaluate(() => window.dispatchEvent(new Event('online'))); await pg.waitForTimeout(800);
  const s2 = await pg.evaluate(() => __hv.queue());
  ok('offline kiosk: synced when back online', s2[0].state === 'sent' && s2[0].email === null && s2[0].firstName === null, JSON.stringify(s2[0]));
  ok('offline kiosk: same request key reused on retry', calls.length >= 2 && calls.every((c) => c.requestKey === calls[0].requestKey), calls.map((c) => c.requestKey).join(','));
  ok('offline kiosk: first name shown', (await pg.textContent('#who')) === 'Ana');
  ok('offline kiosk: no errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// 3. web mode offline: no false confirmation, details stay on screen
{
  const { pg, ctx, errors } = await page({ rpc: 'down', viewport: { width: 393, height: 852 } }, '?kiosk=0');
  await pg.click('#begin'); await pg.fill('#first', 'Sam'); await pg.fill('#email', 'sam@example.com'); await pg.click('#save'); await pg.waitForTimeout(1600);
  const st = await pg.evaluate(() => ({ st: __hv.state(), msg: document.querySelector('#msg').textContent, first: document.querySelector('#first').value }));
  ok('web offline: stays on form with message', st.st === 'capture' && /couldn/.test(st.msg) && st.first === 'Sam', JSON.stringify(st));
  ok('web offline: no errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// 4. validation, suggestion, double-tap
{
  const { pg, ctx, calls, errors } = await page();
  await pg.click('#begin');
  await pg.click('#save'); ok('validation: empty name flagged', (await pg.textContent('#msg')).includes('first name') && await pg.$eval('#f-first', (e) => e.classList.contains('bad')));
  await pg.fill('#first', 'Lee'); await pg.fill('#email', 'lee@nope'); await pg.click('#save');
  ok('validation: bad email flagged', (await pg.textContent('#msg')).includes('look right') && await pg.$eval('#f-email', (e) => e.classList.contains('bad')));
  await pg.fill('#email', 'lee@gmial.com'); await pg.click('#save');
  const sug = await pg.textContent('#msg'); ok('suggestion: offers gmail.com', sug.includes('lee@gmail.com'), sug);
  await pg.click('#msg .link'); await pg.waitForTimeout(500);
  ok('suggestion: accepted and submitted', calls.length === 1 && calls[0].email === 'lee@gmail.com', JSON.stringify(calls));
  ok('validation: no errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}
{
  const { pg, ctx, calls } = await page();
  await pg.click('#begin'); await pg.fill('#first', 'Kai'); await pg.fill('#email', 'kai@example.com');
  await pg.evaluate(() => { const f = document.querySelector('#form'); f.requestSubmit(); f.requestSubmit(); f.requestSubmit(); }); await pg.waitForTimeout(700);
  const q = await pg.evaluate(() => __hv.queue());
  ok('double tap: one entry, one request', q.length === 1 && calls.length === 1, `queue=${q.length} calls=${calls.length}`);
  await ctx.close();
}

// 5. capacity reached reported to staff, not to the visitor (kiosk)
{
  const { pg, ctx } = await page({ rpc: 'closed' });
  await pg.click('#begin'); await pg.fill('#first', 'Jo'); await pg.fill('#email', 'jo@example.com'); await pg.click('#save'); await pg.waitForTimeout(700);
  const q = await pg.evaluate(() => __hv.queue());
  ok('capacity: entry marked for staff with code', q[0].state === 'rejected' && q[0].code === 'CAPACITY_REACHED' && q[0].email === 'jo@example.com', JSON.stringify(q[0]));
  await pg.click('#done'); await pg.waitForTimeout(700);
  for (let i = 0; i < 5; i++) await pg.click('#word', { force: true });
  const panel = await pg.evaluate(() => ({ open: !document.querySelector('#staff').hidden, rej: document.querySelector('#s-rejected').textContent, note: document.querySelector('#s-note').textContent }));
  ok('staff panel: opens on 5 taps and shows it', panel.open && panel.rej === '1' && /CAPACITY_REACHED/.test(panel.note), JSON.stringify(panel));
  await ctx.close();
}

// 6. idle reset and payoff hold (fake clock)
{
  const { pg, ctx } = await page({ clock: true });
  await pg.click('#begin'); await pg.fill('#first', 'Idle'); await pg.clock.fastForward(46000); await pg.waitForTimeout(100);
  const a = await pg.evaluate(() => ({ st: __hv.state(), first: document.querySelector('#first').value }));
  ok('idle: abandoned entry clears after 45 s', a.st === 'attract' && a.first === '', JSON.stringify(a));
  await pg.click('#begin'); await pg.fill('#first', 'Hold'); await pg.fill('#email', 'hold@example.com'); await pg.click('#save'); await pg.waitForTimeout(100);
  await pg.clock.fastForward(10500); await pg.waitForTimeout(100);
  const b = await pg.evaluate(() => ({ st: __hv.state(), who: document.querySelector('#first').value }));
  ok('payoff: returns to attract after 10 s and clears', b.st === 'attract' && b.who === '', JSON.stringify(b));
  await ctx.close();
}

// 7. motion: tilt moves the light; iPadOS permission requested inside the tap
{
  const init = () => { window.__permCalls = 0; window.DeviceOrientationEvent.requestPermission = () => { window.__permCalls++; window.__permActive = navigator.userActivation ? navigator.userActivation.isActive : 'n/a'; return Promise.resolve('granted'); }; };
  const { pg, ctx, errors } = await page({ init });
  const m0 = await pg.evaluate(() => __hv.motion());
  await pg.click('#begin'); await pg.waitForTimeout(200);
  const perm = await pg.evaluate(() => ({ calls: window.__permCalls, active: window.__permActive, motion: __hv.motion() }));
  ok('iPadOS: permission requested once, inside a user tap', perm.calls === 1 && perm.active === true, JSON.stringify({ m0, ...perm }));
  const before = await pg.evaluate(() => getComputedStyle(document.querySelector('.ground')).getPropertyValue('--kx'));
  await pg.evaluate(() => { for (let i = 0; i < 3; i++) window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 45, gamma: 0 })); });
  await pg.waitForTimeout(300);
  await pg.evaluate(() => { window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 45, gamma: 22 })); });
  await pg.waitForTimeout(900);
  const after = await pg.evaluate(() => ({ kx: getComputedStyle(document.querySelector('.ground')).getPropertyValue('--kx'), motion: __hv.motion(), x1: document.getElementById('sheen').getAttribute('x1') }));
  const dx = parseFloat(after.kx) - parseFloat(before);
  ok('tilt: light moves with the device', after.motion === 'on' && dx > 40, `before=${before} after=${JSON.stringify(after)} dx=${dx.toFixed(1)}`);
  ok('motion: no errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}
{
  const { pg, ctx, errors } = await page({ reducedMotion: 'reduce' });
  await pg.waitForTimeout(300);
  const a = await pg.evaluate(() => getComputedStyle(document.querySelector('.ground')).getPropertyValue('--kx'));
  await pg.waitForTimeout(1200);
  const b = await pg.evaluate(() => getComputedStyle(document.querySelector('.ground')).getPropertyValue('--kx'));
  await pg.click('#begin'); await pg.fill('#first', 'Still'); await pg.fill('#email', 'still@example.com'); await pg.click('#save'); await pg.waitForTimeout(300);
  ok('reduced motion: light static, flow works', a === b && (await pg.evaluate(() => __hv.state())) === 'payoff' && errors.length === 0, `kx ${a} → ${b}; ${errors.join('|')}`);
  await ctx.close();
}
console.log(results.join('\n'));
console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
await browser.close(); srv.close();
if (results.some((r) => r.startsWith('FAIL'))) process.exitCode = 1;
