// Unit tests for n8n/clawd-engine.js. Run with: node --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../n8n/clawd-engine.js');

// 2026-09-27 10:00 Europe/Brussels (CEST, UTC+2) = 08:00 UTC
const T0 = Date.UTC(2026, 8, 27, 8, 0, 0);
const H = 3600 * 1000;

function alivePet(nowMs, extra) {
  const s = E.freshState(1, nowMs);
  Object.assign(s, { st: 1, ev: 1 }, extra || {});
  return s;
}
function noRandom(t, fn) {
  const orig = Math.random;
  Math.random = () => 0.999;           // no sickness, fixed potty timer
  try { return fn(); } finally { Math.random = orig; }
}
const ALLOWED_KEYS = new Set(['draw', 'text', 'textColor', 'repeat', 'scroll', 'lifetimeMs', 'lifetimeExpiry']);
const SCROLL_KEYS = new Set(['mode', 'direction', 'entry', 'whenFits', 'speed', 'gap', 'holdMs']);
const CMD_ARGS = { pixel: 4, line: 6, rect: 6, rectFill: 6, circle: 5, circleFill: 5, text: 5, bitmap: 6 };
function assertValidPayload(p) {
  for (const k of Object.keys(p)) assert.ok(ALLOWED_KEYS.has(k), `unexpected payload key ${k}`);
  if ('scroll' in p) {
    assert.ok(p.scroll && typeof p.scroll === 'object' && !Array.isArray(p.scroll), 'scroll must be an object (AWTRIX NG rejects true)');
    for (const [k, v] of Object.entries(p.scroll)) {
      assert.ok(SCROLL_KEYS.has(k), `unknown scroll field ${k}`);
      if (['speed', 'gap', 'holdMs'].includes(k)) assert.ok(Number.isInteger(v) && v >= 0, `scroll.${k}`);
    }
  }
  assert.ok(JSON.stringify(p).length < 8192, 'payload over 8 KB');
  for (const c of p.draw || []) {
    assert.ok(Array.isArray(c) && typeof c[0] === 'string', 'command must be an array');
    if (c[0] === 'pixels') {
      assert.match(c[1], /^#[0-9A-F]{6}$/);
      assert.ok(c.length > 2 && (c.length - 2) % 2 === 0, 'pixels needs x,y pairs');
    } else {
      assert.ok(c[0] in CMD_ARGS, `unknown draw command ${c[0]}`);
      assert.equal(c.length, CMD_ARGS[c[0]], `${c[0]} argument count`);
    }
    for (const v of c.slice(1)) assert.ok(typeof v === 'string' || Number.isInteger(v), `non-integer argument in ${JSON.stringify(c)}`);
  }
}

test('config: defaults derive an ~45 s step for 18 h', () => {
  const cfg = E.makeConfig({});
  assert.equal(cfg.HUNGER_EMPTY_HOURS, 18);
  assert.equal(cfg.TZ, 'Europe/Brussels');
  assert.ok(Math.abs(cfg.STEP_SEC - 45.36) < 0.01);
  assert.deepEqual(cfg.warnings, []);
});

test('config: bad values fall back and are reported', () => {
  const cfg = E.makeConfig({ TZ: 'Mars/Olympus', HUNGER_EMPTY_HOURS: 'lots', MODE: 'x', SOUND: 'yes', AWTRIX_HOST: 'http://10.0.0.5/' });
  assert.equal(cfg.TZ, 'Europe/Brussels');
  assert.equal(cfg.HUNGER_EMPTY_HOURS, 18);
  assert.equal(cfg.MODE, 'push');
  assert.equal(cfg.SOUND, true);
  assert.equal(cfg.AWTRIX_HOST, '10.0.0.5');
  assert.ok(cfg.warnings.includes('TZ') && cfg.warnings.includes('HUNGER_EMPTY_HOURS') && cfg.warnings.includes('MODE'));
});

test('time zone: hours follow the configured zone, including DST', () => {
  assert.equal(E.hourIn('Europe/Brussels', Date.UTC(2026, 8, 27, 20, 30)), 22);   // summer, UTC+2
  assert.equal(E.hourIn('Europe/Brussels', Date.UTC(2026, 0, 15, 21, 30)), 22);   // winter, UTC+1
  assert.equal(E.hourIn('America/New_York', Date.UTC(2026, 0, 15, 21, 30)), 16);
  assert.equal(E.inWindow(23, 22, 8), true);
  assert.equal(E.inWindow(12, 22, 8), false);
  assert.equal(E.inWindow(9, 8, 17), true);
});

test('timing: hunger drains from full to empty in ~18 h while awake', () => {
  const cfg = E.makeConfig({ SLEEP_FROM: 0, SLEEP_TO: 0 });       // no auto-sleep
  const s = alivePet(T0);
  noRandom(null, () => {
    let t = T0, emptyAt = null;
    while (t < T0 + 24 * H) {
      t += 2000;
      E.advanceTime(s, cfg, t);
      if (s.h === 0 && emptyAt === null) emptyAt = t;
    }
    const hours = (emptyAt - T0) / H;
    assert.ok(hours > 17.8 && hours < 18.2, `hunger empty after ${hours.toFixed(2)} h`);
  });
});

test('timing: the original speed is reproduced with HUNGER_EMPTY_HOURS = 3.97', () => {
  const cfg = E.makeConfig({ HUNGER_EMPTY_HOURS: 10000 / 7 * 10 / 3600, SLEEP_FROM: 0, SLEEP_TO: 0 });
  assert.ok(Math.abs(cfg.STEP_SEC - 10) < 1e-9);
});

test('timing: catch-up after an outage runs at 30% of live speed, never faster', () => {
  const cfg = E.makeConfig({ SLEEP_FROM: 0, SLEEP_TO: 0 });
  const live = alivePet(T0), gap = alivePet(T0);
  noRandom(null, () => {
    for (let t = T0 + 2000; t <= T0 + 3 * H; t += 2000) E.advanceTime(live, cfg, t);
    E.advanceTime(gap, cfg, T0 + 3 * H);                         // one call after a 3 h gap
  });
  const liveDrop = 10000 - live.h, gapDrop = 10000 - gap.h;
  assert.ok(gapDrop > 0 && gapDrop < liveDrop, `catch-up ${gapDrop} vs live ${liveDrop}`);
  assert.ok(Math.abs(gapDrop / liveDrop - 0.3) < 0.02);
  assert.equal(gap.age, 3 * 3600);
});

test('sleep: auto-sleep uses the configured zone', () => {
  const cfg = E.makeConfig({});
  const s = alivePet(T0);
  E.advanceTime(s, cfg, T0 + 2000);                                   // 10:00 Brussels
  assert.equal(s.sl, 0);
  const late = Date.UTC(2026, 8, 27, 20, 30);                         // 22:30 Brussels
  s.last_ts = Math.floor(late / 1000) - 2;
  E.advanceTime(s, cfg, late);
  assert.equal(s.sl, 1);
  const ny = E.makeConfig({ TZ: 'America/New_York' });                // 16:30 in New York
  const s2 = alivePet(late); s2.last_ts = Math.floor(late / 1000) - 2;
  E.advanceTime(s2, ny, late);
  assert.equal(s2.sl, 0);
});

test('sleep: a manual override lasts until the next switch point', () => {
  const cfg = E.makeConfig({});
  const s = alivePet(T0);
  E.advanceTime(s, cfg, T0 + 2000);
  E.action(s, 5, cfg, T0 + 2000);                                     // put to sleep at 10:00
  assert.equal(s.sl, 1);
  E.advanceTime(s, cfg, T0 + 4000);
  assert.equal(s.sl, 1, 'override holds during the day');
  const night = Date.UTC(2026, 8, 27, 20, 1);                          // 22:01, schedule flips
  s.last_ts = Math.floor(night / 1000) - 2;
  E.advanceTime(s, cfg, night);
  assert.equal(s.slo, 0);
  assert.equal(s.sl, 1);
});

test('evolution and hatching follow the configured ages', () => {
  const cfg = E.makeConfig({ CHILD_AT_HOURS: 1, TEEN_AT_HOURS: 2, ADULT_AT_HOURS: 3, EGG_HATCH_MIN: 10 });
  const s = E.freshState(1, T0);
  E.action(s, 9, cfg, T0);                                            // warm the egg: +60 s
  assert.equal(s.warm, 60);
  E.advanceTime(s, cfg, T0 + 9 * 60 * 1000);                          // 9 min + 1 min warmth
  assert.equal(s.st, 1);
  assert.equal(s.ev, 1);
  assert.equal(s.ev_k, 4);
  s.cs = 250;
  noRandom(null, () => { for (let t = T0 + 9 * 60000; t <= T0 + 4 * H; t += 60000) E.advanceTime(s, cfg, t); });
  assert.equal(s.ev, 4);
  assert.equal(s.va, 0, 'high care score gives the happy adult');
});

test('push: buttons are ignored until Clawd is known to be on screen', () => {
  const store = {};
  let r = E.run({ event: 'button', btn: 'select', prefix: 'awtrixNG' }, store, {}, T0);
  assert.equal(r.ignore, true);
  assert.equal(store.clawd.ui, 0);
  r = E.run({ event: 'active', app: 'clawd', prefix: 'awtrixNG' }, store, {}, T0 + 100);
  assert.equal(r.push, true, 'a fresh frame is sent when Clawd comes on screen');
  store.clawd.st = 1; store.clawd.ev = 1;
  r = E.run({ event: 'button', btn: 'select', prefix: 'awtrixNG' }, store, {}, T0 + 200);
  assert.equal(r.ignore, false);
  assert.equal(store.clawd.ui, 1, 'menu opened');
  assert.equal(r.switchTo, false, 'physical buttons never switch apps');
});

test('push: left/right close the menu and never switch back to Clawd', () => {
  const store = {};
  E.run({ event: 'active', app: 'clawd' }, store, {}, T0);
  Object.assign(store.clawd, { st: 1, ev: 1 });
  E.run({ event: 'button', btn: 'select' }, store, {}, T0 + 100);
  const r = E.run({ event: 'button', btn: 'right' }, store, {}, T0 + 200);
  assert.equal(store.clawd.ui, 0);
  assert.equal(r.switchTo, false);
  const r2 = E.run({ event: 'active', app: 'Time' }, store, {}, T0 + 300);
  assert.equal(store.dev.fg, false);
  assert.equal(r2.switchTo, false);
  assert.equal(E.run({ event: 'button', btn: 'select' }, store, {}, T0 + 400).ignore, true, 'select on another app does nothing');
});

test('push: leaving the screen closes an open menu', () => {
  const store = {};
  E.run({ event: 'active', app: 'clawd' }, store, {}, T0);
  Object.assign(store.clawd, { st: 1, ev: 1 });
  E.run({ event: 'button', btn: 'select' }, store, {}, T0 + 100);
  E.run({ event: 'active', app: 'Time' }, store, {}, T0 + 500);
  assert.equal(store.clawd.ui, 0);
});

test('push: messages from another AWTRIX prefix are ignored', () => {
  const store = {};
  const r = E.run({ event: 'active', app: 'clawd', prefix: 'otherClock' }, store, {}, T0);
  assert.equal(r.ignore, true);
  assert.equal(store.dev.fg, null);
});

test('Home Assistant actions apply and bring Clawd on screen', () => {
  const store = {};
  E.run({ event: 'tick' }, store, {}, T0);
  Object.assign(store.clawd, { st: 1, ev: 1, h: 5000 });
  const r = E.run({ event: 'action', name: 'feed' }, store, {}, T0 + 1000);
  assert.equal(store.clawd.h, 9000);
  assert.equal(r.switchTo, true);
  assert.equal(E.run({ event: 'action', name: 'dance' }, store, {}, T0 + 2000).ignore, true);
});

test('push: Home Assistant commands on the command topic apply and bring Clawd on screen', () => {
  const store = {};
  E.run({ event: 'tick' }, store, {}, T0);
  Object.assign(store.clawd, { st: 1, ev: 1, h: 5000 });
  const r = E.run({ event: 'cmd', payload: 'feed' }, store, {}, T0 + 1000);
  assert.equal(r.ignore, false);
  assert.equal(store.clawd.h, 9000);
  assert.equal(r.switchTo, true);
  assert.equal(E.run({ event: 'cmd', payload: '{"a":"clean"}' }, store, {}, T0 + 2000).switchTo, true);
  assert.equal(E.run({ event: 'cmd', payload: 'dance' }, store, {}, T0 + 3000).ignore, true);
});

test('view: device commands do not switch apps (only HA and big events do)', () => {
  const store = {};
  const cfg = { MODE: 'view' };
  E.run({ event: 'tick' }, store, cfg, T0);
  Object.assign(store.clawd, { st: 1, ev: 1, h: 5000 });
  assert.equal(E.run({ event: 'cmd', payload: 'feed' }, store, cfg, T0 + 1000).switchTo, false);
});

test('push: the state line is published too, for Home Assistant', () => {
  const store = {};
  const cfg = { SLEEP_FROM: 0, SLEEP_TO: 0 };
  const first = E.run({ event: 'tick' }, store, cfg, T0);
  assert.equal(first.publish.topic, 'clawd/state');
  assert.equal(first.publish.retain, true);
  assert.ok(first.publish.message.startsWith('2,0,'), 'egg state line');
  Object.assign(store.clawd, { st: 1, ev: 1 });
  noRandom(null, () => {
    E.run({ event: 'tick' }, store, cfg, T0 + 2000);
    assert.equal(E.run({ event: 'tick' }, store, cfg, T0 + 4000).publish, null, 'nothing changed');
    assert.ok(E.run({ event: 'tick' }, store, cfg, T0 + 64000).publish, 'once a minute');
  });
  assert.ok(E.run({ event: 'cmd', payload: 'clean' }, store, cfg, T0 + 65000).publish, 'a command publishes at once');
});

test('big events switch to Clawd unless SWITCH_ON_EVENTS is off', () => {
  const store = {};
  E.run({ event: 'tick' }, store, {}, T0);
  store.clawd.warm = 900; store.clawd.age = 30 * 60;
  const r = E.run({ event: 'tick' }, store, { SWITCH_ON_EVENTS: true }, T0 + 2000);
  assert.equal(store.clawd.st, 1);
  assert.equal(r.switchTo, true, 'hatching switches');
  const store2 = {};
  E.run({ event: 'tick' }, store2, {}, T0);
  store2.clawd.warm = 900; store2.clawd.age = 30 * 60;
  assert.equal(E.run({ event: 'tick' }, store2, { SWITCH_ON_EVENTS: false }, T0 + 2000).switchTo, false);
});

test('sound and notifications are opt-in and use the right effect', () => {
  const store = {};
  E.run({ event: 'tick' }, store, {}, T0);
  Object.assign(store.clawd, { st: 1, ev: 1, h: 1000 });
  let r = E.run({ event: 'action', name: 'feed' }, store, {}, T0 + 1000);
  assert.equal(r.sound, null);
  assert.equal(r.notify, null);
  r = E.run({ event: 'action', name: 'feed' }, store, { SOUND: true }, T0 + 2000);
  assert.equal(r.sound, E.SND[1], 'a second feed plays again');
  store.clawd.h = 1000; store.clawd.lastNotify = 0;
  r = E.run({ event: 'tick' }, store, { NOTIFY: true }, T0 + 3000);
  assert.equal(r.notify.text, 'Clawd needs you!');
  r = E.run({ event: 'tick' }, store, { NOTIFY: true }, T0 + 5000);
  assert.equal(r.notify, null, '30 min cooldown');
});

test('push: every rendered payload is valid for AWTRIX NG', () => {
  const cfg = E.makeConfig({});
  const cases = [];
  const base = alivePet(T0);
  cases.push(E.freshState(1, T0));
  for (const ev of [1, 2, 3, 4]) for (const va of [0, 1, 2]) cases.push(Object.assign({}, base, { ev, va }));
  cases.push(Object.assign({}, base, { ev: 4, pp: 3, sk: 1, sl: 1, h: 100, ha: 0 }));
  cases.push(Object.assign({}, base, { st: 2 }));
  cases.push(Object.assign({}, base, { ui: 1, mi: 5, sl: 1, dwell: T0 - 1000 }));
  cases.push(Object.assign({}, base, { st: 2, ui: 5, rp: 1, dwell: T0 - 1000 }));
  cases.push(Object.assign({}, base, { ui: 3 }));
  for (let k = 1; k <= 9; k++) cases.push(Object.assign({}, base, { ev_k: k, ev_t0: T0 - 100, hits: 3 }));
  let biggest = 0;
  for (const s of cases) {
    for (const dt of [0, 450, 1300, 7000]) {
      const p = E.render(s, cfg, T0 + dt);
      assertValidPayload(p);
      biggest = Math.max(biggest, JSON.stringify(p).length);
    }
  }
  assert.ok(biggest < 3000, `largest frame ${biggest} bytes`);
});

test('push: stats scroll once and return to the pet within Clawd\'s turn', () => {
  const store = {};
  E.run({ event: 'tick' }, store, {}, T0);
  Object.assign(store.clawd, { st: 1, ev: 1 });
  const r = E.run({ event: 'action', name: 'stats' }, store, {}, T0 + 1000);
  assertValidPayload(r.payload);
  // AWTRIX ends the page, and the app's turn, when `repeat` runs out - before
  // the pet frame could replace the text. Found on a real clock.
  assert.ok(!('repeat' in r.payload), 'no repeat');
  assert.deepEqual(r.payload.scroll, { speed: 100, holdMs: E.STATS_HOLD_MS });
  E.run({ event: 'tick' }, store, {}, T0 + 1000 + store.clawd.stat_ms + 10);
  assert.equal(store.clawd.ui, 0);
});

test('push: stats close after the pass and before a second one, whatever the tick phase', () => {
  // Measured on the clock: rests holdMs, scrolls at ~23 px/s (docs: 21), then
  // rests holdMs again at the start before scrolling a second time.
  const REAL_PX_S = 23, TICK = 2000, PUSH_MS = 300;
  for (const name of ['Clawd', 'Mr Pinchy', 'AAAAAAAAAAAA']) {
    for (const age of [0, 5 * 3600, 400 * 86400]) {
      const text = E.statsText({ age, gen: 12, cs: -1234, hp: 10000 }, E.makeConfig({ PET_NAME: name }));
      const pass = (text.length * 4 - 1) / REAL_PX_S * 1000;
      const passEnd = E.STATS_HOLD_MS + pass, secondStart = passEnd + E.STATS_HOLD_MS;
      const statMs = E.statsScrollMs(text);
      for (let phase = 0; phase < TICK; phase += 250) {
        const closeTick = Math.ceil((statMs - phase) / TICK) * TICK + phase;   // first tick at/after stat_ms
        assert.ok(closeTick >= passEnd, `${name}/${age}: closes before the pass ended`);
        assert.ok(closeTick + PUSH_MS < secondStart, `${name}/${age}: second pass visible (${Math.round(closeTick + PUSH_MS - secondStart)} ms)`);
      }
    }
  }
});

test('push: off screen, plain ticks only push on change or every 30 s', () => {
  const store = {};
  E.run({ event: 'active', app: 'Time' }, store, {}, T0);
  Object.assign(store.clawd, { st: 1, ev: 1 });
  store.dev.lastPush = T0; store.dev.sig = E.signature(store.clawd, E.makeConfig({}), T0);
  noRandom(null, () => {
    assert.equal(E.run({ event: 'tick' }, store, {}, T0 + 2000).push, false);
    assert.equal(E.run({ event: 'tick' }, store, {}, T0 + 31000).push, true);
  });
  store.clawd.pp = 1;
  assert.equal(E.run({ event: 'tick' }, store, {}, T0 + 33000).push, true, 'a new poop shows at once');
});

test('push: an effect sends a burst of frames; menu presses and plain ticks do not', () => {
  const store = {};
  E.run({ event: 'active', app: 'clawd' }, store, {}, T0);
  Object.assign(store.clawd, { st: 1, ev: 1, h: 5000 });
  const menu = E.run({ event: 'button', btn: 'select' }, store, {}, T0 + 100);
  assert.equal(menu.frames.length, 0, 'no burst for the menu');
  const r = E.run({ event: 'action', name: 'clean' }, store, {}, T0 + 200);
  assert.ok(r.frames.length >= 4 && r.frames.length <= 6, `${r.frames.length} frames for a 1.2 s effect`);
  const sweep = (p) => (p.draw.find((c) => c[0] === 'line' && c[5] === '#F2E3C8') || [])[1];
  assert.ok(sweep(r.frames[r.frames.length - 2]) > sweep(r.frames[0]), 'the broom moves');
  const tick = E.run({ event: 'tick' }, store, {}, T0 + 300);
  assert.equal(tick.frames.length, 0, 'plain ticks send no burst');
  const off = E.run({ event: 'action', name: 'clean' }, store, { BURST: false }, T0 + 400);
  assert.equal(off.frames.length, 0);
});

test('push: the menu runs the highlighted item after 2 s', () => {
  const store = {};
  E.run({ event: 'active', app: 'clawd' }, store, {}, T0);
  Object.assign(store.clawd, { st: 1, ev: 1, h: 5000 });
  E.run({ event: 'button', btn: 'select' }, store, {}, T0 + 100);    // EXIT
  E.run({ event: 'button', btn: 'select' }, store, {}, T0 + 600);    // FEED
  E.run({ event: 'tick' }, store, {}, T0 + 2000);
  assert.equal(store.clawd.ui, 1, 'still waiting');
  E.run({ event: 'tick' }, store, {}, T0 + 2700);
  assert.equal(store.clawd.ui, 0);
  assert.equal(store.clawd.h, 9000);
});

test('dead pet: two presses and a 3 s hold start a new egg', () => {
  const store = {};
  E.run({ event: 'active', app: 'clawd' }, store, {}, T0);
  Object.assign(store.clawd, { st: 2, gen: 3 });
  E.run({ event: 'button', btn: 'select' }, store, {}, T0 + 100);
  E.run({ event: 'button', btn: 'select' }, store, {}, T0 + 500);
  E.run({ event: 'tick' }, store, {}, T0 + 3600);
  assert.equal(store.clawd.st, 0);
  assert.equal(store.clawd.gen, 4);
});

test('a state saved by the previous version keeps its values', () => {
  const old = { st: 1, ev: 3, va: 1, h: 4321, ha: 5000, en: 6000, cl: 7000, hp: 8000, sl: 0, slo: 0, sk: 0,
    age: 200000, warm: 900, cs: 55, gen: 2, pp: 1, pt: 100, cf: 0, ui: 0, mi: 0, dwell: 0, rp: 0,
    ev_k: 0, ev_t0: 0, stat_open: 0, lastNotify: 0, decAcc: 12, aslast: false, last_ts: Math.floor(T0 / 1000) };
  const store = { clawd: old };
  E.run({ event: 'tick' }, store, {}, T0 + 2000);
  assert.equal(store.clawd.gen, 2);
  assert.equal(store.clawd.cs, 55);
  assert.equal(store.clawd.ev, 3);
  assert.equal(store.clawd.fx, 0);
  assert.equal(store.clawd.v, 2);
});

test('view: device commands apply, including a Star Catch result', () => {
  const store = {};
  const cfg = { MODE: 'view' };
  E.run({ event: 'tick' }, store, cfg, T0);
  Object.assign(store.clawd, { st: 1, ev: 1, ha: 1000, cs: 0 });
  const r = E.run({ event: 'cmd', payload: '{"a":"play","hits":3}' }, store, cfg, T0 + 1000);
  assert.equal(store.clawd.ha, 4500);
  assert.equal(store.clawd.cs, 10);
  assert.equal(store.clawd.hits, 3);
  assert.equal(r.switchTo, false);
  assert.equal(r.publish.topic, 'clawd/state');
  assert.equal(r.publish.retain, true);
  assert.equal(r.publish.message.split(',').length, 22);
  assert.equal(E.run({ event: 'cmd', payload: '{"a":"rm -rf"}' }, store, cfg, T0 + 2000).ignore, true);
  assert.equal(E.run({ event: 'cmd', payload: 'not json {' }, store, cfg, T0 + 2000).ignore, true);
  assert.equal(E.run({ event: 'button', btn: 'select' }, store, cfg, T0 + 2000).ignore, true, 'buttons belong to the device');
});

test('view: state is published on change and at least once a minute', () => {
  const store = {};
  const cfg = { MODE: 'view', SLEEP_FROM: 0, SLEEP_TO: 0 };
  E.run({ event: 'tick' }, store, cfg, T0);
  Object.assign(store.clawd, { st: 1, ev: 1 });
  noRandom(null, () => {
    E.run({ event: 'tick' }, store, cfg, T0 + 2000);
    assert.equal(E.run({ event: 'tick' }, store, cfg, T0 + 4000).publish, null);
    assert.ok(E.run({ event: 'tick' }, store, cfg, T0 + 64000).publish);
  });
  const r = E.run({ event: 'cmd', payload: 'clean' }, store, cfg, T0 + 65000);
  assert.ok(r.publish, 'a command publishes at once');
});

test('view: new egg only works on a dead pet', () => {
  const store = {};
  const cfg = { MODE: 'view' };
  E.run({ event: 'tick' }, store, cfg, T0);
  Object.assign(store.clawd, { st: 1, ev: 2 });
  E.run({ event: 'cmd', payload: 'newegg' }, store, cfg, T0 + 1000);
  assert.equal(store.clawd.st, 1);
  store.clawd.st = 2;
  E.run({ event: 'cmd', payload: 'newegg' }, store, cfg, T0 + 2000);
  assert.equal(store.clawd.st, 0);
  assert.equal(store.clawd.gen, 2);
});

test('n8n: plain ticks that change nothing do not rewrite the stored state', () => {
  const cfg = { SLEEP_FROM: 0, SLEEP_TO: 0 };
  const sd = {};
  E.runN8n({ event: 'tick' }, sd, cfg, T0);
  Object.assign(sd.clawd, { st: 1, ev: 1 });
  E.runN8n({ event: 'active', app: 'clawd' }, sd, cfg, T0 + 100);
  const ref = sd.clawd;
  noRandom(null, () => {
    const r = E.runN8n({ event: 'tick' }, sd, cfg, T0 + 2000);
    assert.equal(r.commit, false);
    assert.equal(r.push, true, 'still pushes a frame');
    assert.equal(sd.clawd, ref, 'stored object untouched');
    // time keeps counting from the last saved timestamp
    let committed = 0;
    for (let t = T0 + 4000; t <= T0 + 120000; t += 2000) if (E.runN8n({ event: 'tick' }, sd, cfg, t).commit) committed++;
    assert.ok(committed >= 2 && committed <= 5, `${committed} saves in 2 minutes`);
    assert.ok(sd.clawd.h < 10000, 'decay steps were saved');
  });
  const r = E.runN8n({ event: 'button', btn: 'select' }, sd, cfg, T0 + 121000);
  assert.equal(r.commit, true);
  assert.equal(sd.clawd.ui, 1);
});

test('review fixes: egg outage capped, view stats, monotonic effects, clamp warnings', () => {
  const cfg = E.makeConfig({});
  const egg = E.freshState(1, T0);
  E.advanceTime(egg, cfg, T0 + 3 * 24 * H);                 // n8n down for 3 days
  assert.equal(egg.age, 43200, 'an outage counts 12 h at most');
  assert.equal(egg.ev, 1, 'hatched once, no instant evolutions');

  const store = {};
  E.run({ event: 'tick' }, store, { MODE: 'view' }, T0);
  Object.assign(store.clawd, { st: 1, ev: 1 });
  const r = E.run({ event: 'action', name: 'stats' }, store, { MODE: 'view' }, T0 + 1000);
  assert.equal(store.clawd.ui, 0, 'view mode keeps no UI state');
  assert.equal(r.publish.message.split(',')[16], '10', 'device is told to show the stats');
  assert.equal(r.switchTo, true);

  const d = {};
  E.run({ event: 'tick' }, d, {}, T0);
  Object.assign(d.clawd, { st: 2, fx: 41 });
  E.run({ event: 'action', name: 'reset' }, d, {}, T0 + 1000);
  assert.equal(d.clawd.fx, 42, 'effect counter keeps counting after a new egg');

  const w = E.makeConfig({ SLEEP_FROM: 25, HUNGER_EMPTY_HOURS: 0 }).warnings;
  assert.ok(w.includes('SLEEP_FROM') && w.includes('HUNGER_EMPTY_HOURS'), 'clamped values are reported');
});
