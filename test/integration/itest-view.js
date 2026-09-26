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
const state = () => (JSON.parse(sqlite("select staticData from workflow_entity where id='clawdViewLab0001'") || '{}').global || {});
let fails = 0;
const check = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };
const frameText = (r) => { try { const p = JSON.parse(r.b); return (p.draw || []).filter((c) => c[0] === 'text').map((c) => c[3]).join('|') || p.text || ''; } catch (e) { return ''; } };

(async () => {
  const c = mqtt.connect('mqtt://127.0.0.1:1883');
  await new Promise((r) => c.on('connect', r));
  const pub = (t, m, retain) => new Promise((r) => c.publish(t, m, { retain: !!retain }, r));


  // view mode: the device sends commands, n8n publishes the state
  const got = [];
  c.subscribe('clawd/state');
  c.on('message', (topic, m, pkt) => got.push({ topic, m: m.toString(), retain: pkt.retain, t: Date.now() }));
  await sleep(17000);                                   // at least one 15 s tick
  check(got.length >= 1 && got[got.length - 1].m.split(',').length === 22, `state published (${got.length})`);
  let t = Date.now();
  await pub('clawd/cmd', '{"a":"warm"}');
  await sleep(1500);
  const after = got.filter((g) => g.t >= t);
  check(after.length >= 1, 'a command publishes the new state at once');
  const f = after[after.length - 1].m.split(',').map(Number);
  check(f[20] >= 60 && f[16] === 7, `warmth ${f[20]}, effect ${f[16]}`);
  t = Date.now();
  await pub('clawd/cmd', 'rm -rf /');
  await sleep(1500);
  check(got.filter((g) => g.t >= t).length === 0, 'junk commands are ignored');
  const res = await fetch('http://127.0.0.1:5678/webhook/clawd-action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"warm"}' });
  await sleep(1500);
  const sw = since(t).filter((r) => r.u === '/api/v1/apps/active');
  check(res.status === 200 && sw.length === 1, 'HA action switches to the Clawd script');
  check(since(t).filter((r) => r.u.startsWith('/api/v1/apps/pushed')).length === 0, 'view mode never pushes frames');
  const errs = sqlite("select count(*) from execution_entity where deletedAt is null and status in ('error','crashed')");
  check(Number(errs) === 0, `no failed executions (${errs})`);
  c.end();
  console.log(fails ? `${fails} FAILED` : 'ALL OK');
  process.exit(fails ? 1 : 0);
})();
