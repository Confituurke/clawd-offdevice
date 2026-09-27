// Structural tests for the generated n8n workflows. Run with: node --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FILES = ['n8n/clawd-workflow.json', 'n8n/clawd-workflow-view.json'];
const load = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
// The HTTP calls live in an inline sub-workflow (Execute Workflow, "Define Below").
const subOf = (wf) => JSON.parse(wf.nodes.find((n) => n.type === 'n8n-nodes-base.executeWorkflow').parameters.workflowJson);
const allNodes = (wf) => wf.nodes.concat(subOf(wf).nodes);

// Run a Code node's JS the way n8n does: as the body of an async function with
// $input and $getWorkflowStaticData in scope.
function runCode(js, items, staticData) {
  const ctx = {
    $input: { all: () => items.map((json) => ({ json })) },
    $getWorkflowStaticData: () => staticData,
    Intl, Date, Math, JSON, String, Number, Object, Array, Map, Set, parseInt, parseFloat,
    module: { exports: {} }
  };
  vm.createContext(ctx);
  // round-trip through JSON so objects from the sandbox compare normally
  return JSON.parse(JSON.stringify(vm.runInContext(`(function(){${js}\n})()`, ctx).map((i) => i.json)));
}

test('workflow JSON is up to date with the engine source', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build.js'), '--check']);
});

for (const f of FILES) {
  test(`${f}: connections point at existing nodes, names are unique`, () => {
    const main = load(f);
    for (const wf of [main, subOf(main)]) {
      const names = wf.nodes.map((n) => n.name);
      assert.equal(new Set(names).size, names.length);
      for (const [from, c] of Object.entries(wf.connections)) {
        assert.ok(names.includes(from), `unknown source ${from}`);
        for (const out of c.main) for (const l of out) assert.ok(names.includes(l.node), `unknown target ${l.node}`);
      }
      assert.equal(wf.settings.saveDataSuccessExecution, 'none');
    }
    const bg = main.nodes.find((n) => n.type === 'n8n-nodes-base.executeWorkflow');
    assert.equal(bg.parameters.options.waitForSubWorkflow, false, 'HTTP calls run in the background');
  });

  test(`${f}: HTTP nodes use NG routes, time out quickly and never fail the run`, () => {
    const wf = load(f);
    const http = allNodes(wf).filter((x) => x.type === 'n8n-nodes-base.httpRequest');
    assert.ok(http.length >= 2);
    assert.equal(wf.nodes.filter((x) => x.type === 'n8n-nodes-base.httpRequest').length, 0, 'no HTTP in the state-owning run');
    for (const n of http) {
      assert.equal(n.onError, 'continueRegularOutput', n.name);
      assert.ok(n.parameters.options.timeout <= 3000, n.name);
      assert.match(n.parameters.url, /\/api\/v1\/(apps\/pushed|apps\/active|audio\/play|notifications)/, n.name);
      assert.doesNotMatch(n.parameters.url, /sounds\/play/);
    }
  });

  test(`${f}: the engine Code node runs a tick end to end`, () => {
    const wf = load(f);
    const settings = wf.nodes.find((n) => n.name === 'Settings');
    const cfg = {};
    for (const a of settings.parameters.assignments.assignments) cfg[a.name.replace(/^cfg\./, '')] = a.value;
    const engine = wf.nodes.find((n) => n.name === 'Clawd Engine');
    const sd = {};
    const out = runCode(engine.parameters.jsCode, [{ event: 'tick', cfg }], sd);
    assert.equal(out.length, 1);
    assert.ok(sd.clawd && sd.clawd.st === 0, 'state saved in static data');
    if (cfg.MODE === 'push') assert.ok(out[0].payload.draw.length > 0);
    else assert.ok(out[0].publish.message.startsWith('2,'));
  });
}

test('push workflow: MQTT events are parsed from AWTRIX NG topics', () => {
  const wf = load(FILES[0]);
  const node = wf.nodes.find((n) => n.name === 'MQTT Event');
  const out = runCode(node.parameters.jsCode, [
    { topic: 'awtrixNG/state/buttons/select', message: '1' },
    { topic: 'awtrixNG/state/buttons/select', message: '0' },
    { topic: 'home/clock/state/apps/active', message: 'clawd' },
    { topic: 'awtrixNG/state/device', message: '{}' },
    { topic: 'clawd/ha', message: 'feed' },
    { topic: 'clawd/ha', message: '' }
  ], {});
  assert.deepEqual(out, [
    { event: 'button', btn: 'select', prefix: 'awtrixNG' },
    { event: 'active', app: 'clawd', prefix: 'home/clock' },
    { event: 'cmd', payload: 'feed', topic: 'clawd/ha' }
  ]);
});

test('push workflow: listens on Home Assistant\'s topic and publishes the retained state line', () => {
  const wf = load(FILES[0]);
  const trg = wf.nodes.find((n) => n.name === 'AWTRIX MQTT');
  assert.ok(trg.parameters.topics.split(',').includes('clawd/ha'));
  assert.ok(!trg.parameters.topics.split(',').includes('clawd/cmd'), 'clawd/cmd is the clock\'s');
  const pub = wf.nodes.find((n) => n.name === 'Publish State');
  assert.equal(pub.type, 'n8n-nodes-base.mqtt');
  assert.equal(pub.parameters.options.retain, true);
  assert.equal(pub.onError, 'continueRegularOutput');
  assert.ok(wf.connections['Has State'].main[0].some((l) => l.node === 'Publish State'));
  assert.ok(wf.connections['Clawd Engine'].main[0].some((l) => l.node === 'Has State'));
  const settings = wf.nodes.find((n) => n.name === 'Settings').parameters.assignments.assignments.map((a) => a.name);
  for (const k of ['cfg.STATE_TOPIC', 'cfg.HA_TOPIC']) assert.ok(settings.includes(k), k);
});

test('view workflow: listens on the clock\'s and Home Assistant\'s topics and passes the topic on', () => {
  const wf = load(FILES[1]);
  const trg = wf.nodes.find((n) => n.name === 'Device Commands (MQTT)');
  assert.deepEqual(trg.parameters.topics.split(','), ['clawd/cmd', 'clawd/ha']);
  const node = wf.nodes.find((n) => n.name === 'Command Event');
  assert.deepEqual(runCode(node.parameters.jsCode, [{ topic: 'clawd/ha', message: 'feed' }], {}),
    [{ event: 'cmd', payload: 'feed', topic: 'clawd/ha' }]);
  const settings = wf.nodes.find((n) => n.name === 'Settings').parameters.assignments.assignments.map((a) => a.name);
  for (const k of ['cfg.STATE_TOPIC', 'cfg.CMD_TOPIC', 'cfg.HA_TOPIC']) assert.ok(settings.includes(k), k);
});

test('push workflow: burst frames are split and sent 250 ms apart', () => {
  const wf = load(FILES[0]);
  const split = allNodes(wf).find((n) => n.name === 'Split Frames');
  const out = runCode(split.parameters.jsCode, [{ base: 'http://x', app: 'clawd', frames: [{ draw: [] }, { draw: [] }] }], {});
  assert.equal(out.length, 2);
  const push = allNodes(wf).find((n) => n.name === 'Push Burst Frame');
  assert.deepEqual(push.parameters.options.batching, { batch: { batchSize: 1, batchInterval: 250 } });
});

test('push workflow: the mirror is gated, rendered in a Code node and published retained', () => {
  const wf = load(FILES[0]);
  assert.ok(wf.connections['Clawd Engine'].main[0].some((l) => l.node === 'Has Mirror'));
  const settings = Object.fromEntries(wf.nodes.find((n) => n.name === 'Settings').parameters.assignments.assignments.map((a) => [a.name, a.value]));
  assert.equal(settings['cfg.MIRROR'], false, 'off by default');
  const node = wf.nodes.find((n) => n.name === 'Mirror Frame');
  const out = runCode(node.parameters.jsCode, [
    { push: true, mirror: 'clawd/screen', payload: { draw: [['pixel', 0, 0, '#FF0000']] } },
    { push: true, mirror: null, payload: { draw: [] } }
  ], {});
  assert.equal(out.length, 1);
  assert.equal(out[0].topic, 'clawd/screen');
  assert.ok(Buffer.from(out[0].message, 'base64').subarray(1, 4).toString() === 'PNG');
  const pub = wf.nodes.find((n) => n.name === 'Publish Mirror');
  assert.equal(pub.parameters.options.retain, true);
  assert.equal(pub.onError, 'continueRegularOutput');
  assert.equal(load(FILES[1]).nodes.find((n) => n.name === 'Mirror Frame'), undefined, 'view mode has no mirror');
});

test('view mirror workflow: reads the screen only while Clawd is shown and publishes a retained PNG', () => {
  const wf = load('n8n/clawd-workflow-mirror.json');
  const names = wf.nodes.map((n) => n.name);
  assert.equal(new Set(names).size, names.length);
  for (const [from, c] of Object.entries(wf.connections)) {
    assert.ok(names.includes(from), from);
    for (const out of c.main) for (const l of out) assert.ok(names.includes(l.node), l.node);
  }
  assert.equal(wf.settings.saveDataSuccessExecution, 'none');
  const node = (n) => wf.nodes.find((x) => x.name === n);
  assert.equal(node('App On Screen (MQTT)').parameters.topics, '+/state/apps/active');
  const every = node('Tick every 10s').parameters.rule.interval[0];
  assert.ok(every.field === 'seconds' && every.secondsInterval >= 5 && every.secondsInterval <= 10);
  const cfg = Object.fromEntries(node('Settings').parameters.assignments.assignments.map((a) => [a.name, a.value]));
  assert.equal(cfg['cfg.MIRROR'], false, 'off by default');
  assert.equal(cfg['cfg.MIRROR_TOPIC'], 'clawd/screen');
  const http = node('Read Screen');
  assert.equal(http.parameters.method, 'GET');
  assert.equal(http.parameters.options.timeout, 2000);
  assert.equal(http.onError, 'continueRegularOutput', 'a failed read is ignored');
  const pub = node('Publish Mirror');
  assert.equal(pub.parameters.options.retain, true);
  assert.equal(pub.onError, 'continueRegularOutput');

  // The Code nodes, run as n8n runs them: app change, then tick, then the screen.
  const store = {};
  const cfgIn = { MIRROR: true, AWTRIX_HOST: 'clock', MQTT_PREFIX: 'awtrix', APP_NAME: 'clawd', MIRROR_TOPIC: 'clawd/screen' };
  const ev = runCode(node('Active Event').parameters.jsCode, [{ topic: 'awtrix/state/apps/active', message: 'clawd' }], {});
  assert.deepEqual(ev, [{ event: 'active', app: 'clawd', prefix: 'awtrix' }]);
  assert.deepEqual(runCode(node('Mirror Gate').parameters.jsCode, [{ ...ev[0], cfg: cfgIn }], store), []);
  assert.deepEqual(runCode(node('Mirror Gate').parameters.jsCode, [{ event: 'tick', cfg: cfgIn }], store),
    [{ url: 'http://clock/api/v1/display/screen', topic: 'clawd/screen' }]);
  const px = new Array(256).fill(0); px[0] = 0xD97757;
  const png = runCode(node('Screen To PNG').parameters.jsCode, [{ pixels: px }], {});
  assert.equal(png.length, 1);
  assert.equal(Buffer.from(png[0].message, 'base64').subarray(1, 4).toString(), 'PNG');
  assert.deepEqual(runCode(node('Screen To PNG').parameters.jsCode, [{ error: { message: 'timeout of 2000ms exceeded' } }], {}), [], 'errors are skipped');
});
