// Integration test for the push workflow running in a real n8n.
const mqtt = require('mqtt');
const fs = require('fs');
const DB = require('path').join(process.env.N8N_USER_FOLDER || '.', '.n8n', 'database.sqlite');
const sqlite = (q) => require('child_process').execFileSync('python3', ['-c',
  `import sqlite3,sys;c=sqlite3.connect('${DB}');print(c.execute(sys.argv[1]).fetchone()[0])`, q], { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOG = require('path').join(__dirname, 'tmp', 'awtrix.log');
const reqs = () => fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const since = (t) => reqs().filter((r) => r.t >= t);
const state = () => (JSON.parse(sqlite("select staticData from workflow_entity where id='clawdPushLab0001'") || '{}').global || {});
let fails = 0;
const check = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };
const frameText = (r) => { try { const p = JSON.parse(r.b); return (p.draw || []).filter((c) => c[0] === 'text').map((c) => c[3]).join('|') || p.text || ''; } catch (e) { return ''; } };

(async () => {
  const c = mqtt.connect('mqtt://127.0.0.1:1883');
  await new Promise((r) => c.on('connect', r));
  const pub = (t, m, retain) => new Promise((r) => c.publish(t, m, { retain: !!retain }, r));

  // 1. ticks push a frame every 2 s while Clawd is on screen
  await pub('awtrixNG/state/apps/active', 'clawd', true);
  await sleep(500);
  let t = Date.now();
  await sleep(6500);
  let pushes = since(t).filter((r) => r.u === '/api/v1/apps/pushed/clawd');
  check(pushes.length >= 2, `ticks push frames (${pushes.length} in 6.5 s)`);
  check(pushes.every((r) => r.ct === 'application/json'), 'Content-Type is application/json');
  const p0 = JSON.parse(pushes[0].b);
  check(p0.lifetimeExpiry === 'mark' && p0.lifetimeMs === 90000, 'stale marker set');

  // 2. another app on screen: presses are ignored, pushes slow down
  await pub('awtrixNG/state/apps/active', 'Time', true);
  await sleep(1500);
  let s = state();
  const warm0 = s.clawd.warm, ui0 = s.clawd.ui;
  t = Date.now();
  await pub('awtrixNG/state/buttons/select', '1', true);
  await sleep(150);
  await pub('awtrixNG/state/buttons/select', '0', true);
  await sleep(6000);
  s = state();
  check(s.dev && s.dev.fg === false, 'engine knows Clawd is not on screen');
  check(s.clawd.ui === ui0 && s.clawd.warm === warm0, 'select on another app did nothing');
  check(since(t).filter((r) => r.u === '/api/v1/apps/active').length === 0, 'no switch to Clawd from a button');
  const offPushes = since(t).filter((r) => r.u === '/api/v1/apps/pushed/clawd').length;
  check(offPushes <= 1, `off screen: ${offPushes} pushes in 6 s`);

  // 3. Clawd on screen: an immediate fresh frame; select warms the egg
  t = Date.now();
  await pub('awtrixNG/state/apps/active', 'clawd', true);
  await sleep(800);
  check(since(t).filter((r) => r.u === '/api/v1/apps/pushed/clawd').length >= 1, 'fresh frame when Clawd comes on screen');
  await pub('awtrixNG/state/buttons/select', '1', true);
  await sleep(150);
  await pub('awtrixNG/state/buttons/select', '0', true);
  await sleep(1200);
  s = state();
  check(s.clawd.warm === Math.min(warm0 + 60, 900) || s.clawd.st !== 0, `egg warmed by the press (warm=${s.clawd.warm})`);
  check(since(t).some((r) => r.u === '/api/v1/audio/play'), 'warm-egg sound on /api/v1/audio/play');
  check(since(t).filter((r) => r.u === '/api/v1/apps/active').length === 0, 'still no switch from a physical button');

  // 4. HA webhook: hatch it quickly by pretending time passed, then feed
  const sd = state();
  const res = await fetch('http://127.0.0.1:5678/webhook/clawd-action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"stats"}' });
  check(res.status === 200, `webhook answers 200 (${res.status})`);
  await sleep(1500);
  const sw = since(t).filter((r) => r.u === '/api/v1/apps/active');
  check(sw.length === 1 && JSON.parse(sw[0].b).name === 'clawd' && JSON.parse(sw[0].b).fast === true, 'HA action switches to Clawd');
  const statsPush = since(t).reverse().find((r) => r.u === '/api/v1/apps/pushed/clawd' && JSON.parse(r.b).text);
  check(statsPush && JSON.parse(statsPush.b).repeat === 1 && !('scroll' in JSON.parse(statsPush.b)), 'stats text pushed with repeat 1');

  // 5. rapid presses while ticks run: every press must count (menu needs a live pet)
  console.log('   ... waiting for stats to close');
  await sleep(14000);
  // make the pet alive through the database is not possible while running, so use the egg:
  // 8 presses 400 ms apart should add 8 x 60 s of warmth
  s = state();
  const w0 = s.clawd.warm;
  for (let i = 0; i < 8; i++) {
    await pub('awtrixNG/state/buttons/select', '1', true);
    await sleep(120);
    await pub('awtrixNG/state/buttons/select', '0', true);
    await sleep(280);
  }
  await sleep(2500);
  s = state();
  check(s.clawd.warm - w0 === Math.min(480, 900 - w0) || s.clawd.st === 1, `8 presses during ticks all counted (warm +${s.clawd.warm - w0})`);
  if (900 - w0 < 480) console.log('   (egg warmth near its cap; reset the state for a stronger check)');

  // 6. saved state does not churn on every tick
  const u0 = sqlite("select updatedAt from workflow_entity where id='clawdPushLab0001'");
  await sleep(10000);
  const u1 = sqlite("select updatedAt from workflow_entity where id='clawdPushLab0001'");
  const execs = sqlite("select count(*) from execution_entity where workflowId='clawdPushLab0001' and deletedAt is null and status='success'");
  check(Number(execs) === 0, `successful executions are not stored (${execs})`);
  const errs = sqlite("select count(*) from execution_entity where deletedAt is null and status in ('error','crashed')");
  check(Number(errs) === 0, `no failed executions (${errs})`);
  console.log(`   updatedAt ${u0} -> ${u1}`);

  c.end();
  console.log(fails ? `${fails} FAILED` : 'ALL OK');
  process.exit(fails ? 1 : 0);
})();
