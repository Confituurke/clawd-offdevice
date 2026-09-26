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
    { topic: 'awtrixNG/state/device', message: '{}' }
  ], {});
  assert.deepEqual(out, [
    { event: 'button', btn: 'select', prefix: 'awtrixNG' },
    { event: 'active', app: 'clawd', prefix: 'home/clock' }
  ]);
});

test('push workflow: burst frames are split and sent 250 ms apart', () => {
  const wf = load(FILES[0]);
  const split = allNodes(wf).find((n) => n.name === 'Split Frames');
  const out = runCode(split.parameters.jsCode, [{ base: 'http://x', app: 'clawd', frames: [{ draw: [] }, { draw: [] }] }], {});
  assert.equal(out.length, 2);
  const push = allNodes(wf).find((n) => n.name === 'Push Burst Frame');
  assert.deepEqual(push.parameters.options.batching, { batch: { batchSize: 1, batchInterval: 250 } });
});
