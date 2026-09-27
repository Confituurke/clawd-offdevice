// ============================================================================
// Clawd Engine — the pet's rules, shared by the n8n workflows and the tests.
//
// A port of Blueforcer's AWTRIX Berry script "Clawd" (v1.1). The same state
// fields, formulas and thresholds as the original, with the timing driven by
// one setting (HUNGER_EMPTY_HOURS) instead of a fixed 10-second step.
//
// This file is the single source of truth. `node scripts/build.js`
// embeds it into the n8n Code nodes, so never edit the copies inside the
// workflow JSON by hand. It has no dependencies and runs in Node >= 18 and in
// n8n's Code node alike.
//
// Two modes:
//   push - n8n renders every frame and pushes it to AWTRIX as a pushed app.
//   view - the on-device script awtrix/clawd-view.ax draws and handles the
//          buttons; n8n only keeps the rules and publishes the pet's state
//          over MQTT.
// ============================================================================

const ENGINE_VERSION = '2.0.0';

// ---- settings --------------------------------------------------------------
// Every value can be overridden from the workflow's "Settings" node.
const DEFAULTS = {
  MODE: 'push',               // 'push' | 'view'
  AWTRIX_HOST: '192.168.1.50',// IP or host name of the clock, no http://
  MQTT_PREFIX: 'awtrixNG',    // AWTRIX NG's MQTT prefix
  APP_NAME: 'clawd',          // pushed app name (push) / script name (view)
  PET_NAME: 'Clawd',
  TZ: 'Europe/Brussels',      // any IANA time zone
  HUNGER_EMPTY_HOURS: 18,     // awake, full -> empty. The original was ~4 h.
  EGG_HATCH_MIN: 30,
  CHILD_AT_HOURS: 12,
  TEEN_AT_HOURS: 36,
  ADULT_AT_HOURS: 72,
  SLEEP_FROM: 22, SLEEP_TO: 8,   // auto-sleep window, local hours
  NIGHT_FROM: 20, NIGHT_TO: 6,   // night scenery window, local hours
  SOUND: false,               // play RTTTL effects (off by default, like the original)
  NOTIFY: false,              // "<name> needs you!" notifications
  SWITCH_ON_EVENTS: true,     // bring Clawd on screen when it hatches, evolves, falls ill or dies
  STATE_TOPIC: 'clawd/state', // n8n -> device (view) and Home Assistant (both modes)
  CMD_TOPIC: 'clawd/cmd',     // device (view) and Home Assistant (both modes) -> n8n
  OFFSCREEN_REFRESH_SEC: 30,  // push mode: refresh the frame this often while Clawd is not shown
  STALE_AFTER_SEC: 90,        // push mode: AWTRIX draws a red frame if no update arrives in time
  BURST: true,                // push mode: extra frames while an effect plays
  MIRROR: false,              // push mode: also publish each frame as a PNG (e.g. an HA camera)
  MIRROR_TOPIC: 'clawd/screen'
};

// ---- palette and sprites (same as the original) -----------------------------
const CM = {
  o: '#D97757', O: '#E58963', q: '#A8553C', d: '#A94F38', c: '#F0906B',
  x: '#C4694D', w: '#FFFFFF', r: '#E05540', e: '#F2E3C8', s: '#C96F4A',
  y: '#FFD34D', m: '#8B5A2B', g: '#93A7C4', t: '#9AA0A6'
};

const SPR = {
  egg:   ['.eee.', 'eeeee', 'esees', 'eeeee', 'eseee', '.eee.'],
  b1: { a: ['c...c', '.ooo.', 'owowo', '.d.d.'],
        b: ['.....', 'coooc', 'owowo', 'd...d'] },                                   // baby
  b2: { a: ['c....c', '.oooo.', 'owoowo', '.oooo.', '.d..d.'],
        b: ['......', 'cooooc', 'owoowo', '.oooo.', 'd....d'] },                     // child
  b3: { a: ['c.....c', 'c.ooo.c', '.ooooo.', 'owooowo', '.ooooo.', '.d.d.d.'],
        b: ['.......', 'c.ooo.c', 'coooooc', 'owooowo', '.ooooo.', 'd.d.d.d'] },     // teen
  a0: { a: ['.y.yy.y.', 'c.OOOO.c', '.OOOOOO.', 'OOwOOwOO', '.OOOOOO.', '..OOOO..', '.d.d.d.d'],
        b: ['..y..y..', 'ccOOOOcc', '.OOOOOO.', 'OOwOOwOO', '.OOOOOO.', '..OOOO..', 'd.d.d.d.'] }, // adult, happy
  a1: { a: ['cc....cc', 'c.oooo.c', '.oooooo.', 'oowoowoo', '.oooooo.', '..oooo..', '.d.d.d.d'],
        b: ['........', 'ccoooocc', '.oooooo.', 'oowoowoo', '.oooooo.', '..oooo..', 'd.d.d.d.'] }, // adult, normal
  a2: { a: ['xx....xx', 'x.qqqq.x', '.qqqqqq.', 'qqrqqrqq', '.qqqqqq.', '..dddd..', '.d.d.d.d'],
        b: ['........', 'xxqqqqxx', '.qqqqqq.', 'qqrqqrqq', '.qqqqqq.', '..dddd..', 'd.d.d.d.'] }, // adult, grumpy
  ghost: ['.gggg.', 'gwggwg', 'gggggg', 'gggggg', 'g.g.g.'],
  tomb:  ['.ttt.', 'ttttt', 'tt.tt', 'tt.tt', 'ttttt', 'ttttt'],
  poop:  ['.m.', 'mmm'],
  food:  ['.yy.', 'mmmm', '.ee.'],
  heart: ['r.r', 'rrr', '.r.']
};

const GLY = [
  ['.r....r.', '..r..r..', '...rr...', '...rr...', '..r..r..', '.r....r.'],   // 0 EXIT
  ['........', '..yyyy..', '.yyyyyy.', '.mmmmmm.', '.rrrrrr.', '.eeeeee.'],   // 1 FEED
  ['...y....', '..yyy...', 'yyyyyyy.', '.yyyyy..', '..y.y...', '.y...y..'],   // 2 PLAY
  ['......ee', '.....ee.', '....ee..', '.yee....', 'yyy.....', 'yy......'],   // 3 CLEAN
  ['...rr...', '...rr...', '.rrrrrr.', '.rrrrrr.', '...rr...', '...rr...'],   // 4 MED
  ['..eee...', '.ee.....', '.ee.....', '.ee.....', '.ee.....', '..eee...'],   // 5 SLEEP
  ['......w.', '......w.', '...w..w.', '...w..w.', 'w..w..w.', 'w..w..w.'],   // 6 STATS
  ['.y.y.y..', '..yyy...', 'yyyyyyy.', '..yyy...', '.y.y.y..']                // 7 WAKE
];
const MLAB = ['EXIT', 'FEED', 'PLAY', 'CLEAN', 'MED', 'SLEEP', 'STATS'];
const STARS = [[3, 0], [8, 1], [13, 0], [1, 2], [15, 2]];
const BAR_COLORS = ['#D97757', '#E8C33F', '#3FB4E8', '#4FC96F'];

// Effect ids (ev_k) and how long each one shows, in ms (the original's self.T).
// 1 feed, 2 clean, 3 evolve, 4 hatch, 5 medicine, 6 refused, 7 egg warmed / new
// egg, 8 play result, 9 death, 10 show stats (view mode only).
const FX_MS = [0, 1500, 1200, 2200, 2200, 900, 700, 600, 1500, 1500, 0];

// RTTTL per effect id, the same tunes as the original.
const SND = {
  1: 'm:d=16,o=5,b=200:g,p,g,p,g',
  2: 'c:d=32,o=6,b=220:e,g',
  3: 'e:d=16,o=5,b=140:c,e,g,8c6,16p,8e6',
  4: 'h:d=16,o=6,b=180:c,e,g,c7',
  5: 'c:d=32,o=6,b=220:e,g',
  6: 'x:d=16,o=4,b=200:c',
  7: 'c:d=32,o=6,b=220:e,g',
  8: 'w:d=16,o=6,b=180:c,e,g,8c7',
  9: 'd:d=4,o=4,b=70:8e,8d,c'
};
const SND_SICK = 's:d=8,o=5,b=160:e,p,e';

// Home Assistant / device command words -> action ids.
const ACTIONS = { exit: 0, feed: 1, play: 2, clean: 3, med: 4, sleep: 5, stats: 6, reset: 7, wake: 8, warm: 9, newegg: 10 };

// ---- helpers -----------------------------------------------------------------
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function c10k(v) { return clamp(v, 0, 10000); }

function toBool(v, dflt) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(t)) return true;
    if (['false', '0', 'no', 'off', ''].includes(t)) return false;
  }
  return dflt;
}
function toNum(v, dflt, lo, hi) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (!Number.isFinite(n)) return dflt;
  return clamp(n, lo, hi);
}
function inRange(v, lo, hi) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) && n >= lo && n <= hi;
}
function validTz(tz) {
  try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); return true; } catch (e) { return false; }
}

// Normalise whatever the Settings node hands us. Unknown or broken values fall
// back to the defaults, and every fallback is reported in cfg.warnings.
function makeConfig(raw) {
  raw = raw || {};
  const cfg = Object.assign({}, DEFAULTS);
  const warnings = [];
  const pick = (k) => (raw[k] !== undefined && raw[k] !== null && raw[k] !== '' ? raw[k] : undefined);

  for (const k of ['AWTRIX_HOST', 'MQTT_PREFIX', 'APP_NAME', 'PET_NAME', 'STATE_TOPIC', 'CMD_TOPIC', 'MIRROR_TOPIC']) {
    if (pick(k) !== undefined) cfg[k] = String(pick(k)).trim();
  }
  cfg.AWTRIX_HOST = cfg.AWTRIX_HOST.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  cfg.PET_NAME = cfg.PET_NAME.slice(0, 12);
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(cfg.APP_NAME)) { warnings.push('APP_NAME'); cfg.APP_NAME = DEFAULTS.APP_NAME; }

  const mode = String(pick('MODE') || DEFAULTS.MODE).toLowerCase();
  if (mode === 'push' || mode === 'view') cfg.MODE = mode; else warnings.push('MODE');

  if (pick('TZ') !== undefined) {
    const tz = String(pick('TZ')).trim();
    if (validTz(tz)) cfg.TZ = tz; else warnings.push('TZ');
  }

  const nums = {
    HUNGER_EMPTY_HOURS: [0.5, 24 * 30], EGG_HATCH_MIN: [1, 24 * 60],
    CHILD_AT_HOURS: [0, 24 * 365], TEEN_AT_HOURS: [0, 24 * 365], ADULT_AT_HOURS: [0, 24 * 365],
    SLEEP_FROM: [0, 23], SLEEP_TO: [0, 23], NIGHT_FROM: [0, 23], NIGHT_TO: [0, 23],
    OFFSCREEN_REFRESH_SEC: [5, 3600], STALE_AFTER_SEC: [0, 86400]
  };
  for (const [k, [lo, hi]] of Object.entries(nums)) {
    if (pick(k) === undefined) continue;
    const n = toNum(pick(k), NaN, lo, hi);
    if (Number.isFinite(n)) cfg[k] = n;
    if (!inRange(pick(k), lo, hi)) warnings.push(k);          // unusable, or clamped into range
  }
  for (const k of ['SLEEP_FROM', 'SLEEP_TO', 'NIGHT_FROM', 'NIGHT_TO']) cfg[k] = Math.floor(cfg[k]);
  if (!(cfg.CHILD_AT_HOURS <= cfg.TEEN_AT_HOURS && cfg.TEEN_AT_HOURS <= cfg.ADULT_AT_HOURS)) {
    warnings.push('CHILD/TEEN/ADULT_AT_HOURS');
    cfg.CHILD_AT_HOURS = DEFAULTS.CHILD_AT_HOURS; cfg.TEEN_AT_HOURS = DEFAULTS.TEEN_AT_HOURS; cfg.ADULT_AT_HOURS = DEFAULTS.ADULT_AT_HOURS;
  }
  for (const k of ['SOUND', 'NOTIFY', 'SWITCH_ON_EVENTS', 'BURST', 'MIRROR']) {
    if (pick(k) !== undefined) cfg[k] = toBool(pick(k), DEFAULTS[k]);
  }

  // Derived timing. The original ran one decay step every 10 s and took
  // 10000 / 7 steps (~3.97 h) to empty hunger. Everything that was measured in
  // steps or in "original seconds" is stretched by the same factor.
  cfg.STEP_SEC = cfg.HUNGER_EMPTY_HOURS * 3600 * 7 / 10000;
  cfg.SCALE = cfg.STEP_SEC / 10;
  cfg.warnings = warnings;
  return cfg;
}

// Local hour of `ms` in the configured zone (0-23).
function hourIn(tz, ms) {
  try {
    const f = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: tz });
    const h = parseInt(f.format(new Date(ms)), 10);
    if (Number.isFinite(h)) return h % 24;
  } catch (e) { /* fall through */ }
  return new Date(ms).getHours();
}
function inWindow(h, from, to) {
  if (from === to) return false;
  return from < to ? (h >= from && h < to) : (h >= from || h < to);
}

// ---- state -------------------------------------------------------------------
function freshState(gen, nowMs) {
  return {
    st: 0, ev: 0, va: 1,                    // stage (0 egg, 1 alive, 2 dead), evolution 0-4, adult variant
    h: 10000, ha: 10000, en: 10000, cl: 10000, hp: 10000,
    sl: 0, slo: 0, sk: 0,                   // asleep, manual sleep override, sick
    age: 0, warm: 0, cs: 0, gen: gen || 1,  // age (s), egg warmth (s), care score, generation
    pp: 0, pt: 0, cf: 0,                    // poops, potty timer (s), "stat hit zero" flags
    ui: 0, mi: 0, dwell: 0, rp: 0,          // push-mode UI: 0 scene, 1 menu, 3 stats, 5 new-egg confirm
    ev_k: 0, ev_t0: 0, fx: 0, hits: 1,      // last effect id, its start (ms), effect counter, play hits
    stat_open: 0, stat_ms: 8000,
    lastNotify: 0, decAcc: 0, aslast: null,
    last_ts: Math.floor((nowMs || Date.now()) / 1000),
    saved: 0, v: 2
  };
}

// Fill in fields a state saved by an older version is missing, so a running
// pet survives the upgrade.
function upgradeState(s, nowMs) {
  const f = freshState(s && s.gen, nowMs);
  for (const k of Object.keys(f)) if (s[k] === undefined) s[k] = f[k];
  s.v = 2;
  return s;
}

function fx(s, k, nowMs) { s.ev_k = k; s.ev_t0 = nowMs; s.fx = (s.fx || 0) + 1; }

// ---- time --------------------------------------------------------------------
// Offline catch-up, same shape as the original's boot catch-up: the missed time
// (capped at 12 h) runs at 30% of the live awake rate.
function applyCatchup(s, dtSec, cfg) {
  const el = Math.min(dtSec, 43200);
  s.age += el;
  if (s.st !== 1) return;
  const k = el * 0.3 / cfg.STEP_SEC;        // equivalent decay steps
  s.h = c10k(s.h - 7 * k);
  s.ha = c10k(s.ha - 5 * k);
  s.en = c10k(s.en + 2.5 * k);
  s.cl = c10k(s.cl - 2 * k);
  if (s.pt > 0) {
    s.pt -= el * 0.3;
    if (s.pt <= 0) { s.pt = 0; s.pp = Math.min(s.pp + 1, 3); s.cl = c10k(s.cl - 1500); }
  }
}

// One decay step: the original's 10-second branch, formula for formula.
function decayStep(s, nowMs) {
  if (s.st !== 1) return;
  const sl = s.sl === 1;
  const xtra = (s.pp >= 2 || s.sk === 1) ? 5 : 0;
  s.h = c10k(s.h - (sl ? 3 : 7));
  s.ha = c10k(s.ha - (sl ? 0 : 5) - xtra);
  s.en = c10k(s.en + (sl ? 12 : -4));
  s.cl = c10k(s.cl - 2 - 4 * s.pp);

  const vals = [s.h, s.ha, s.en, s.cl];
  let cf = s.cf;
  for (let i = 0; i < 4; i++) {
    const bit = 1 << i;
    if (vals[i] === 0) {
      if ((cf & bit) === 0) { s.cs -= 25; cf ^= bit; }
    } else if (vals[i] > 3000 && (cf & bit) !== 0) {
      cf ^= bit;
    }
  }
  s.cf = cf;

  if (s.sk === 0 && !sl) {
    if ((s.h < 2000 || s.ha < 2000 || s.cl < 2000 || s.pp >= 2) && Math.random() < 0.02) {
      s.sk = 1; s.cs -= 25;
    }
  }

  let dmg = 0;
  if (s.h === 0) dmg += 12;
  if (s.cl === 0) dmg += 6;
  if (s.sk === 1) dmg += 8;
  s.hp = c10k(dmg > 0 ? s.hp - dmg : s.hp + 5);

  if (s.hp <= 0) { s.st = 2; s.ui = 0; fx(s, 9, nowMs); }
}

function evolve(s, stage, nowMs) {
  s.ev = stage;
  if (stage === 1) { s.st = 1; fx(s, 4, nowMs); return; }
  if (stage === 4) s.va = s.cs >= 200 ? 0 : (s.cs <= -100 ? 2 : 1);
  fx(s, 3, nowMs);
}

function checkEvolution(s, cfg, nowMs) {
  if (s.st !== 1) return;
  if (s.ev === 1 && s.age >= cfg.CHILD_AT_HOURS * 3600) evolve(s, 2, nowMs);
  else if (s.ev === 2 && s.age >= cfg.TEEN_AT_HOURS * 3600) evolve(s, 3, nowMs);
  else if (s.ev === 3 && s.age >= cfg.ADULT_AT_HOURS * 3600) evolve(s, 4, nowMs);
}

function isNight(s, cfg, nowMs) {
  return s.sl === 1 || inWindow(hourIn(cfg.TZ, nowMs), cfg.NIGHT_FROM, cfg.NIGHT_TO);
}

// Called on every invocation, whatever triggered it.
function advanceTime(s, cfg, nowMs) {
  const now = Math.floor(nowMs / 1000);
  const dt = Math.max(0, now - (s.last_ts || now));
  s.last_ts = now;

  if (s.st === 0) {
    s.age += dt > 120 ? Math.min(dt, 43200) : dt;         // outages count 12 h at most
    if (s.age + s.warm >= cfg.EGG_HATCH_MIN * 60) evolve(s, 1, nowMs);
    return;
  }
  if (s.st !== 1) return;

  if (dt > 120) { applyCatchup(s, dt, cfg); checkEvolution(s, cfg, nowMs); return; }

  s.age += dt;

  // Auto-sleep. A manual SLEEP/WAKE lasts until the schedule's next switch
  // point, then the schedule takes over again (same as the original).
  const auto = inWindow(hourIn(cfg.TZ, nowMs), cfg.SLEEP_FROM, cfg.SLEEP_TO);
  if (s.aslast === null || s.aslast === undefined) s.aslast = auto;
  else if (auto !== s.aslast) { s.aslast = auto; s.slo = 0; }
  if (s.slo === 0) s.sl = auto ? 1 : 0;

  if (s.pt > 0 && s.sl !== 1) {
    s.pt -= dt;
    if (s.pt <= 0) { s.pt = 0; s.pp = Math.min(s.pp + 1, 3); s.cl = c10k(s.cl - 1500); }
  }

  // Accumulate real seconds across calls and fire a step each time the total
  // crosses STEP_SEC, carrying the remainder forward.
  s.decAcc = (s.decAcc || 0) + dt;
  const steps = Math.min(Math.ceil(3600 / cfg.STEP_SEC), Math.floor(s.decAcc / cfg.STEP_SEC));
  s.decAcc -= steps * cfg.STEP_SEC;
  for (let i = 0; i < steps; i++) decayStep(s, nowMs);

  checkEvolution(s, cfg, nowMs);
}

// ---- actions -----------------------------------------------------------------
// Push-mode STATS: the text rests this long at the start, scrolls through once,
// and returns to the start for another rest; the engine switches back to the
// pet during that second rest. Measured on an AWTRIX NG 1.1.2 TC001: the docs'
// 21 px/s at speed 100 is really ~23 px/s, so the pass is timed at 21 px/s (it
// has surely ended) and the rest is long enough to cover that gap, the 2 s tick
// and the push. No `repeat`: AWTRIX ends a page, and so the app's whole turn,
// once its repeats are done, before the pet frame could arrive.
// Without `repeat` the page no longer holds the turn open, and one pass takes
// ~11 s against AWTRIX's default 7 s app time, so the page also asks for a
// `durationMs` long enough for the pass plus a few seconds of the pet after.
// `mode: "wrap"` is set explicitly so a different global scroll mode (bounce,
// loop) cannot change the timing measured above.
const STATS_HOLD_MS = 3500;
const STATS_AFTER_MS = 4000;
function statsScrollMs(text) { return STATS_HOLD_MS + Math.ceil((text.length * 4 - 1) / 21 * 1000); }

function statsText(s, cfg) {
  const a = s.age;
  return `${cfg.PET_NAME}  AGE ${Math.floor(a / 86400)}d${Math.floor((a % 86400) / 3600)}h  GEN ${s.gen}  CARE ${s.cs}  HP ${Math.floor(s.hp / 100)}%`;
}

// Apply one action. `opt.hits` (0-3) is a Star Catch result from the device;
// without it PLAY is the push mode's instant version.
function action(s, id, cfg, nowMs, opt) {
  opt = opt || {};
  s.ui = 0;
  if (id === 1) {                                        // FEED
    if (s.sl === 1 || s.st !== 1) fx(s, 6, nowMs);
    else {
      if (s.h > 9000) s.ha = c10k(s.ha - 500);
      else if (s.h < 7000) s.cs += 10;
      s.h = c10k(s.h + 4000);
      s.pt = (2700 + Math.floor(Math.random() * 2700)) * cfg.SCALE;
      fx(s, 1, nowMs);
    }
  } else if (id === 2) {                                 // PLAY
    if (s.sl === 1 || s.st !== 1 || s.en < 1500) fx(s, 6, nowMs);
    else if (Number.isInteger(opt.hits)) {
      const h = clamp(opt.hits, 0, 3);
      s.ha = c10k(s.ha + 1000 * h + (h === 3 ? 500 : 0));
      s.en = c10k(s.en - 800);
      if (h >= 2) s.cs += 10;
      s.hits = h;
      fx(s, 8, nowMs);
    } else {
      s.ha = c10k(s.ha + 1500);
      s.en = c10k(s.en - 800);
      s.cs += 5;
      s.hits = 1;
      fx(s, 8, nowMs);
    }
  } else if (id === 3) {                                 // CLEAN
    if (s.sl === 1 || s.st !== 1) fx(s, 6, nowMs);
    else { if (s.pp > 0) s.cs += 10; s.pp = 0; s.cl = 10000; fx(s, 2, nowMs); }
  } else if (id === 4) {                                 // MED
    if (s.sk === 1 && s.st === 1) { s.sk = 0; s.cs += 10; s.ha = c10k(s.ha - 500); fx(s, 5, nowMs); }
    else fx(s, 6, nowMs);
  } else if (id === 5) {                                 // SLEEP toggle
    if (s.st !== 1) return;
    if (s.sl === 1) { s.slo = 1; s.sl = 0; } else { s.slo = 2; s.sl = 1; }
  } else if (id === 6) {                                 // STATS
    if (cfg.MODE === 'view') { fx(s, 10, nowMs); return; } // the device shows them
    s.ui = 3; s.stat_open = nowMs;
    s.stat_ms = statsScrollMs(statsText(s, cfg));
  } else if (id === 7 || id === 10) {                    // RESET / NEW EGG - only while dead
    if (s.st === 2) {
      const gen = s.gen, n = s.fx;
      Object.assign(s, freshState(gen + 1, nowMs));
      s.fx = n;                                          // keep the effect counter moving
      fx(s, 7, nowMs);
    }
  } else if (id === 8) {                                 // WAKE
    if (s.st === 1 && s.sl === 1) { s.slo = 1; s.sl = 0; }
  } else if (id === 9) {                                 // WARM the egg
    if (s.st === 0) { s.warm = Math.min(s.warm + 60, 900); fx(s, 7, nowMs); }
  }
}

// Menu and "new egg" timers, checked on every invocation (push mode UI).
function checkDwell(s, cfg, nowMs) {
  if (s.ui === 1 && nowMs - s.dwell >= 2000) {
    action(s, s.mi, cfg, nowMs);
  } else if (s.ui === 5) {
    if (s.rp === 0 && nowMs - s.dwell >= 6000) s.ui = 0;
    else if (s.rp === 1 && nowMs - s.dwell >= 3000) action(s, 10, cfg, nowMs);
  } else if (s.ui === 3 && nowMs - s.stat_open >= (s.stat_ms || 8000)) {
    s.ui = 0;
  }
}

// A physical button press (push mode). Only called while Clawd is on screen.
function onButton(s, btn, cfg, nowMs) {
  if (btn !== 'select') { s.ui = 0; return; }
  if (s.st === 0) action(s, 9, cfg, nowMs);
  else if (s.st === 2) {
    if (s.ui === 5) {
      if (s.rp === 0) { s.rp = 1; s.dwell = nowMs; } else s.ui = 0;
    } else { s.ui = 5; s.rp = 0; s.dwell = nowMs; }
  } else if (s.ui === 0) { s.ui = 1; s.mi = 0; s.dwell = nowMs; }
  else if (s.ui === 1) { s.mi = (s.mi + 1) % 7; s.dwell = nowMs; }
  else if (s.ui === 3) s.ui = 0;
}

// ---- rendering (push mode) ------------------------------------------------------
// Sprites are sent as one "pixels" command per colour, which keeps a frame
// around 1 KB instead of 2 KB.
function Canvas() { this.cmds = []; this.px = new Map(); }
Canvas.prototype.pixel = function (x, y, c) {
  if (!this.px.has(c)) this.px.set(c, []);
  this.px.get(c).push(x, y);
};
Canvas.prototype.flush = function () {
  for (const [c, pts] of this.px) this.cmds.push(['pixels', c].concat(pts));
  this.px = new Map();
};
Canvas.prototype.cmd = function (a) { this.flush(); this.cmds.push(a); };
Canvas.prototype.sprite = function (rows, ox, oy, over, eyes) {
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      let c = CM[ch];
      if (!c) continue;
      if (eyes && ch === 'w') c = eyes;
      this.pixel(ox + x, oy + y, over || c);
    }
  }
};
Canvas.prototype.done = function () { this.flush(); return this.cmds; };

function creature(s) {
  if (s.ev === 1) return { pair: SPR.b1, w: 5, h: 4, skin: CM.o };
  if (s.ev === 2) return { pair: SPR.b2, w: 6, h: 5, skin: CM.o };
  if (s.ev === 3) return { pair: SPR.b3, w: 7, h: 6, skin: CM.o };
  if (s.va === 0) return { pair: SPR.a0, w: 8, h: 7, skin: CM.O };
  if (s.va === 2) return { pair: SPR.a2, w: 8, h: 7, skin: CM.q };
  return { pair: SPR.a1, w: 8, h: 7, skin: CM.o };
}

function withLifetime(p, cfg) {
  if (cfg.STALE_AFTER_SEC > 0) { p.lifetimeMs = Math.round(cfg.STALE_AFTER_SEC * 1000); p.lifetimeExpiry = 'mark'; }
  return p;
}

// Render the push-mode frame for time t (ms).
function render(s, cfg, t) {
  if (s.ui === 3) {
    return withLifetime({
      text: statsText(s, cfg), textColor: '#F0E6D8',
      scroll: { mode: 'wrap', speed: 100, holdMs: STATS_HOLD_MS },
      durationMs: (s.stat_ms || 8000) + STATS_AFTER_MS
    }, cfg);
  }
  const cv = new Canvas();

  if (s.ui === 1) {
    let lab = MLAB[s.mi], glyph = GLY[s.mi];
    if (s.mi === 5 && s.sl === 1) { lab = 'WAKE'; glyph = GLY[7]; }
    cv.sprite(glyph, 0, 1);
    cv.cmd(['text', 11, 1, lab, '#F0E6D8']);
    cv.cmd(['rectFill', 0, 7, 32, 1, '#1A1A1A']);
    const fw = clamp(Math.floor((t - s.dwell) * 32 / 2000), 0, 32);
    if (fw > 0) cv.cmd(['rectFill', 0, 7, fw, 1, '#D97757']);
    return withLifetime({ draw: cv.done() }, cfg);
  }

  if (s.ui === 5) {
    cv.cmd(['rectFill', 0, 7, 32, 1, '#1A1A1A']);
    cv.cmd(['text', 7, 1, 'NEW EGG?', s.rp === 0 ? '#8A8178' : '#F0E6D8']);
    if (s.rp === 1) {
      const fw = clamp(Math.floor((t - s.dwell) * 32 / 3000), 0, 32);
      if (fw > 0) cv.cmd(['rectFill', 0, 7, fw, 1, '#D97757']);
    }
    return withLifetime({ draw: cv.done() }, cfg);
  }

  if (s.st === 2) {
    cv.cmd(['line', 0, 7, 16, 7, '#1E2430']);
    cv.sprite(SPR.tomb, 4, 1);
    cv.sprite(SPR.ghost, 11, (Math.floor(t / 800) % 2 === 0) ? 1 : 2);
    return withLifetime({ draw: cv.done() }, cfg);
  }

  const night = isNight(s, cfg, t);
  cv.cmd(['line', 0, 7, 16, 7, night ? '#14203A' : '#1E4D1E']);
  cv.cmd(['rectFill', 1, 0, 2, 2, night ? '#8C8655' : '#9A8430']);
  if (night) {
    for (let i = 0; i < STARS.length; i++) {
      if ((Math.floor(t / 400) + i * 2) % 5 !== 0) cv.pixel(STARS[i][0], STARS[i][1], '#383838');
    }
  } else {
    const cx = Math.floor(t / 900) % 46 - 6;                 // drifting cloud
    if (cx >= -2 && cx <= 14) for (let i = 0; i < 3; i++) if (cx + i >= 0 && cx + i <= 14) cv.pixel(cx + i, 1, '#2A2A2A');
  }

  const ed = t - s.ev_t0;
  const active = (k) => s.ev_k === k && ed >= 0 && ed < FX_MS[k];

  if (s.st === 0) {
    cv.sprite(SPR.egg, (Math.floor(t / 700) % 2 === 0) ? 5 : 6, 1);
    const pr = clamp(Math.floor((s.age + s.warm) * 17 / (cfg.EGG_HATCH_MIN * 60)), 0, 17);
    if (pr > 0) cv.cmd(['rectFill', 0, 7, pr, 1, '#D97757']);
  } else {
    const cr = creature(s);
    const ox = Math.floor((17 - cr.w) / 2), oy = 7 - cr.h;
    for (let i = 0; i < s.pp; i++) cv.sprite(SPR.poop, 12 + i, 5 - i);
    if (s.sl === 1) {
      // asleep: one still pose, eyes shut, a "z" that bobs
      cv.sprite(cr.pair.a, ox, oy, null, cr.skin);
      const up = Math.floor(t / 900) % 2 === 0;
      cv.cmd(['text', ox + cr.w + (up ? 1 : 2), up ? -1 : 0, 'z', '#5C7FBF']);
    } else {
      const pe = (active(1) && ed < 1500) ? 160 : 1200;      // chewing flips faster
      const rows = Math.floor(t / pe) % 2 === 0 ? cr.pair.a : cr.pair.b;
      const flash = (active(3) || active(4)) && Math.floor(ed / 140) % 2 === 0 ? '#FFE9C9' : null;
      const blink = !flash && (t % 4000) < 150;
      cv.sprite(rows, ox, oy, flash, blink ? cr.skin : null);
    }
    if (s.sk === 1 && Math.floor(t / 350) % 2 === 0) { cv.pixel(0, 0, '#35C24A'); cv.pixel(0, 1, '#35C24A'); }
    if (active(1) && ed < 900) cv.sprite(SPR.food, Math.max(0, Math.floor((17 - cr.w) / 2) - 5), 3);
    else if (active(2)) { const bx = Math.floor(ed * 17 / 1200); cv.cmd(['line', bx, 2, bx, 6, '#F2E3C8']); }
    else if (active(5) && Math.floor(ed / 150) % 2 === 0) { cv.cmd(['line', 7, 1, 9, 1, '#35C24A']); cv.cmd(['line', 8, 0, 8, 2, '#35C24A']); }
    else if (active(6)) { cv.cmd(['line', 6, 1, 10, 5, '#E05540']); cv.cmd(['line', 10, 1, 6, 5, '#E05540']); }
  }
  if (active(7)) cv.sprite(SPR.heart, 7, 0);
  else if (active(8)) for (let i = 0; i < s.hits; i++) cv.sprite(SPR.heart, 3 + i * 5, 0);

  // stat bars; a bar under 25% blinks
  const blinkOn = Math.floor(t / 300) % 2 === 0;
  const bars = [s.h, s.ha, s.en, s.cl];
  for (let i = 0; i < 4; i++) {
    cv.cmd(['rectFill', 18, i * 2, 14, 1, '#202020']);
    let w = Math.floor(bars[i] * 14 / 10000);
    if (w < 1 && bars[i] > 0) w = 1;
    if (w > 0 && (bars[i] >= 2500 || blinkOn)) cv.cmd(['rectFill', 18, i * 2, w, 1, BAR_COLORS[i]]);
  }
  return withLifetime({ draw: cv.done() }, cfg);
}

// What a frame shows, minus animation. When it changes while Clawd is off
// screen, the frame is refreshed right away instead of waiting.
function signature(s, cfg, nowMs) {
  const bars = [s.h, s.ha, s.en, s.cl].map((v) => Math.floor(v * 14 / 10000)).join(',');
  return [s.st, s.ev, s.va, s.pp, s.sk, s.sl, s.ui, s.mi, s.rp, bars, isNight(s, cfg, nowMs) ? 1 : 0].join('|');
}

// While an effect plays (feeding, cleaning, hatching...), push extra frames so
// it animates. Menus get no burst: a second press while an older burst is
// still being sent would flicker between the old and the new label.
function animatedUntil(s, nowMs) {
  if (s.ui !== 0 || !(s.ev_k > 0)) return 0;
  const until = s.ev_t0 + FX_MS[s.ev_k];
  return until > nowMs ? until : 0;
}

// ---- view mode ----------------------------------------------------------------
// The state the device script needs, as one short CSV line (cheap to parse in
// Berry). Field order is part of the protocol; see awtrix/README.md.
function stateLine(s, cfg, nowMs) {
  const night = isNight(s, cfg, nowMs) ? 1 : 0;
  return [
    2,                                   // protocol version
    s.st, s.ev, s.va,
    Math.round(s.h), Math.round(s.ha), Math.round(s.en), Math.round(s.cl), Math.round(s.hp),
    s.pp, s.sk, s.sl, night,
    s.gen, s.cs, Math.floor(s.age),
    s.ev_k, s.fx % 100000, s.hits,
    Math.floor(nowMs / 1000),
    Math.floor(s.warm),
    Math.floor(cfg.EGG_HATCH_MIN * 60)
  ].join(',');
}

function parseCmd(raw) {
  let o = raw;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (t.startsWith('{')) { try { o = JSON.parse(t); } catch (e) { return null; } }
    else o = { a: t };
  }
  if (!o || typeof o !== 'object') return null;
  const name = String(o.a || o.action || '').toLowerCase();
  if (!(name in ACTIONS)) return null;
  const out = { id: ACTIONS[name] };
  if (o.hits !== undefined) {
    const h = parseInt(o.hits, 10);
    if (Number.isInteger(h) && h >= 0 && h <= 3) out.hits = h;
  }
  return out;
}

// ---- notifications ------------------------------------------------------------
function checkNotify(s, cfg, nowMs) {
  if (!cfg.NOTIFY || s.st !== 1 || s.sl === 1) return null;
  if (nowMs - (s.lastNotify || 0) < 1800000) return null;
  if (s.h < 1500 || s.ha < 1500 || s.cl < 1500 || s.sk === 1) {
    s.lastNotify = nowMs;
    const n = { text: `${cfg.PET_NAME} needs you!`, textColor: '#D97757' };
    if (cfg.SOUND) n.soundRtttl = SND_SICK;
    return n;
  }
  return null;
}

// ---- entry point -----------------------------------------------------------------
// input:  { event: 'tick' }
//         { event: 'button', btn: 'left'|'select'|'right', prefix }  (press edge only)
//         { event: 'active', app, prefix }                           (<prefix>/state/apps/active)
//         { event: 'action', name }                                  (Home Assistant webhook)
//         { event: 'cmd', payload }                                  (view mode, from the device)
// store:  a persistent object (n8n workflow static data)
// Returns what the workflow should do; see README "How the workflow uses the result".
function run(input, store, rawCfg, nowMs) {
  const cfg = rawCfg && rawCfg.STEP_SEC ? rawCfg : makeConfig(rawCfg);
  nowMs = nowMs || Date.now();
  input = input || { event: 'tick' };

  if (!store.clawd) store.clawd = freshState(1, nowMs);
  const s = upgradeState(store.clawd, nowMs);
  if (!store.dev) store.dev = { fg: null, lastPush: 0, sig: '', lastPub: 0, pubSig: '' };
  const dev = store.dev;

  const out = {
    mode: cfg.MODE, ignore: false, push: false, payload: null, frames: [],
    sound: null, notify: null, switchTo: false, publish: null, mirror: null,
    base: `http://${cfg.AWTRIX_HOST}`, app: cfg.APP_NAME, warnings: cfg.warnings
  };

  // Messages meant for another device, or of no interest in this mode.
  const ev = input.event;
  if ((ev === 'button' || ev === 'active') && input.prefix !== undefined && input.prefix !== cfg.MQTT_PREFIX) {
    out.ignore = true; return out;
  }
  if (cfg.MODE === 'view' && (ev === 'button' || ev === 'active')) { out.ignore = true; return out; }

  const prev = { st: s.st, ev: s.ev, sk: s.sk, fx: s.fx };
  const before = significant(s, dev);
  let userAct = false;

  advanceTime(s, cfg, nowMs);
  if (cfg.MODE === 'push') checkDwell(s, cfg, nowMs);

  if (ev === 'active') {
    const wasFg = dev.fg;
    dev.fg = String(input.app || '') === cfg.APP_NAME;
    if (!dev.fg && s.ui !== 0) s.ui = 0;                  // Clawd left the screen: close menus
    if (dev.fg && wasFg !== true) userAct = true;          // came on screen: send a fresh frame
  } else if (ev === 'button') {
    if (dev.fg !== true) { out.ignore = true; return out; } // only while Clawd is on screen
    onButton(s, input.btn, cfg, nowMs);
    userAct = true;
  } else if (ev === 'action') {
    const id = ACTIONS[String(input.name || '').toLowerCase()];
    if (id === undefined) { out.ignore = true; return out; }
    action(s, id, cfg, nowMs);
    out.switchTo = true;                                  // HA buttons bring Clawd on screen
    userAct = true;
  } else if (ev === 'cmd') {
    const c = parseCmd(input.payload);
    if (!c) { out.ignore = true; return out; }
    action(s, c.id, cfg, nowMs, c);
    // In push mode nothing on the clock sends commands, so they come from
    // Home Assistant (or similar) and, like the webhook, bring Clawd on screen.
    if (cfg.MODE === 'push') out.switchTo = true;
    userAct = true;
  }

  const diedNow = prev.st !== 2 && s.st === 2;
  const evolvedNow = prev.ev !== s.ev;
  const gotSickNow = prev.sk !== 1 && s.sk === 1;
  if (cfg.SWITCH_ON_EVENTS && (diedNow || evolvedNow || gotSickNow)) out.switchTo = true;

  if (cfg.SOUND && cfg.MODE === 'push') {
    if (s.fx !== prev.fx && SND[s.ev_k]) out.sound = SND[s.ev_k];
    else if (gotSickNow) out.sound = SND_SICK;
  }
  out.notify = checkNotify(s, cfg, nowMs);

  if (cfg.MODE === 'push') {
    const sig = signature(s, cfg, nowMs);
    const onScreen = dev.fg !== false;                     // unknown counts as on screen
    out.push = userAct || out.switchTo || onScreen || sig !== dev.sig || s.fx !== prev.fx ||
      nowMs - (dev.lastPush || 0) >= cfg.OFFSCREEN_REFRESH_SEC * 1000;
    if (out.push) {
      out.payload = render(s, cfg, nowMs);
      dev.lastPush = nowMs; dev.sig = sig;
      if (cfg.MIRROR) out.mirror = cfg.MIRROR_TOPIC;
      // Extra frames every 250 ms while something animates, sent only right
      // after an event (not on plain ticks) and only while Clawd is shown.
      const until = animatedUntil(s, nowMs);
      if (cfg.BURST && until && (onScreen || out.switchTo) && (userAct || s.fx !== prev.fx)) {
        // n8n sends the first one at once and the rest 250 ms apart, so frame k
        // goes out ~100 ms + k x 250 ms from now.
        for (let t = nowMs + 100; t <= Math.min(until, nowMs + 3000); t += 250) out.frames.push(render(s, cfg, t));
      }
    }
  }

  // The state line: the view app draws from it, and Home Assistant reads it in
  // both modes. Published when anything visible changed, and at least once a
  // minute so a restarted device or HA gets fresh data quickly.
  {
    const line = stateLine(s, cfg, nowMs);
    const f = line.split(',');
    const psig = f.slice(0, 15).concat(f.slice(16, 19), f.slice(20)).join(',');  // all but age and clock
    if (psig !== dev.pubSig || nowMs - (dev.lastPub || 0) >= 60000 || userAct) {
      out.publish = { topic: cfg.STATE_TOPIC, message: line, retain: true };
      dev.pubSig = psig; dev.lastPub = nowMs;
    }
  }

  // Should this run's state be saved? Every event and every visible change
  // is; a plain tick that only moved the clock forward is not, at most once a
  // minute. See runN8n() for why that matters.
  out.commit = ev !== 'tick' || significant(s, dev) !== before || nowMs - (s.saved || 0) >= 60000;
  if (out.commit) s.saved = nowMs;
  return out;
}

// Everything in the state except the counters that only move with the clock.
function significant(s, dev) {
  const o = Object.assign({}, s);
  delete o.last_ts; delete o.decAcc; delete o.age; delete o.pt; delete o.saved;
  return JSON.stringify(o) + '|' + dev.fg + '|' + dev.sig + '|' + dev.pubSig + '|' +
    (dev.fg === false ? dev.lastPush : 0) + '|' + dev.lastPub;
}

// The n8n entry point. n8n loads the workflow's static data when a run starts
// and writes all of it back when the run ends, so two runs that overlap (a
// tick and a button press) can undo each other's changes. Two things keep
// that window small: the engine works on a copy and only writes it back when
// run() says so (most ticks change nothing worth saving), and the workflow
// hands every HTTP call to a separate background run, so a run that owns the
// state lasts a few milliseconds.
function runN8n(input, staticData, rawCfg, nowMs) {
  const work = {
    clawd: staticData.clawd ? JSON.parse(JSON.stringify(staticData.clawd)) : undefined,
    dev: staticData.dev ? JSON.parse(JSON.stringify(staticData.dev)) : undefined
  };
  const r = run(input, work, rawCfg, nowMs);
  if (r.commit) { staticData.clawd = work.clawd; staticData.dev = work.dev; }
  return r;
}

const ClawdEngine = {
  ENGINE_VERSION, DEFAULTS, ACTIONS, FX_MS, SND, STATS_HOLD_MS, STATS_AFTER_MS, statsScrollMs,
  makeConfig, hourIn, inWindow, freshState, upgradeState, applyCatchup, decayStep, advanceTime,
  checkEvolution, action, onButton, checkDwell, render, signature, animatedUntil,
  stateLine, parseCmd, checkNotify, statsText, significant, run, runN8n
};
if (typeof module !== 'undefined' && module.exports) module.exports = ClawdEngine;
