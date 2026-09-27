// Runs the on-device scripts (awtrix/*.ax) in a mock AWTRIX runtime under a
// desktop Berry interpreter. Needs a `berry` binary: set BERRY=/path/to/berry
// or put it on PATH (https://github.com/berry-lang/berry, `make`). Skipped
// when none is found.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const E = require('../n8n/clawd-engine.js');

const ROOT = path.join(__dirname, '..');
function findBerry() {
  const cands = [process.env.BERRY, 'berry'].filter(Boolean);
  for (const c of cands) {
    const r = spawnSync(c, ['-v'], { encoding: 'utf8' });
    if (r.status === 0) return c;
  }
  return null;
}

// State lines for each situation, made by the real engine so both sides of the
// protocol are tested together.
function stateLines() {
  const cfg = E.makeConfig({});
  const T = Date.UTC(2026, 8, 27, 8, 0, 0);          // 10:00 in Brussels
  const base = Object.assign(E.freshState(1, T), { st: 1, ev: 2, h: 7000, ha: 6000, en: 8000, cl: 9000, age: 50000, gen: 1, cs: 20 });
  const mk = (extra) => E.stateLine(Object.assign({}, base, extra), cfg, T);
  return {
    alive: mk({ fx: 5 }),
    fed: mk({ fx: 6, ev_k: 1 }),
    asleep: mk({ fx: 7, sl: 1 }),
    sick: mk({ fx: 7, sk: 1 }),
    egg: E.stateLine(Object.assign(E.freshState(1, T), { age: 600, fx: 8 }), cfg, T),
    dead: mk({ st: 2, fx: 9, ev_k: 9 }),
    baby: mk({ ev: 1 }), child: mk({ ev: 2 }), teen: mk({ ev: 3 }),
    adult0: mk({ ev: 4, va: 0 }), adult1: mk({ ev: 4, va: 1 }), adult2: mk({ ev: 4, va: 2 })
  };
}

// Clawd takes the clock's global app time like every other app; a duration()
// hook would override it (it used to cut Clawd's turn to 15 s).
test('the view app does not override the global app time', () => {
  for (const f of ['awtrix/clawd-view.ax', 'dist/clawd.ax']) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), 'utf8'), /def\s+duration\s*\(/, f);
  }
});

const berry = findBerry();
for (const [label, view, core] of [
  ['sources', 'awtrix/clawd-view.ax', 'awtrix/clawdcore.ax'],
  ['installable dist files', 'dist/clawd.ax', 'dist/clawdcore.ax']
]) {
  test(`on-device scripts pass in the mock AWTRIX runtime (${label})`, { skip: berry ? false : 'no berry interpreter found (set BERRY)' }, () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clawd-berry-'));
    fs.copyFileSync(path.join(ROOT, core), path.join(tmp, 'clawdcore.be'));
    const lines = Object.entries(stateLines()).map(([k, v]) => `${k}=${v}`).join('\n');
    fs.writeFileSync(path.join(tmp, 'lines.txt'), lines);
    // Berry resolves global names at compile time, so the mock and the tests
    // are compiled as one program.
    const prog = path.join(tmp, 'all.be');
    fs.writeFileSync(prog, ['awtrix_mock.be', 'run.be'].map((f) => fs.readFileSync(path.join(ROOT, 'test', 'berry', f), 'utf8')).join('\n'));
    let out;
    try {
      out = execFileSync(berry, [prog, ROOT, tmp, path.join(tmp, 'lines.txt'), path.join(ROOT, view)], { encoding: 'utf8' });
    } catch (e) {
      assert.fail(`berry failed:\n${e.stdout || ''}\n${e.stderr || ''}`);
    }
    if (process.env.VERBOSE) console.log(out);
    assert.match(out, /ALL OK/, out);
  });
}
