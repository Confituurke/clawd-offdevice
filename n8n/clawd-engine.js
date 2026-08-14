// ============================================================================
// Clawd Engine — n8n port of the AWTRIX Berry script "Clawd"
// Ported 1:1 where practical: same state fields, same decay rates, same
// evolution thresholds, same menu/action semantics. Runs off-device, so the
// "out of memory" problem disappears entirely — AWTRIX just renders whatever
// draw-JSON it's pushed.
//
// This file is a readable reference copy. The importable workflow embeds the
// same functions inside three n8n Code nodes (Normalize Tick, Normalize
// Button, Clawd Engine) — see n8n_clawd_workflow.json.
// ============================================================================

// ---- CONFIG — edit these -----------------------------------------------
const PET_NAME = 'Clawd';
// One decayStep() = one "tick" of hunger/happiness/energy/cleanliness loss,
// same formulas/amounts as the original Berry script's dec10 branch (which
// fired every 10 real seconds on-device). Off-device we don't need to match
// that 1:1 - bump this to slow the whole simulation down. 60 = 6x slower
// than the original, so an unattended pet can survive a normal night's sleep
// without starving. Raise further (e.g. 120-180) if it's still too fast.
const DECAY_INTERVAL_SEC = 60;

// ---- palette (same hex values as the Berry script's self.cm) -----------
const CM = {
  o: '#D97757', O: '#E58963', q: '#A8553C', d: '#A94F38', c: '#F0906B',
  x: '#C4694D', w: '#FFFFFF', r: '#E05540', e: '#F2E3C8', s: '#C96F4A',
  y: '#FFD34D', m: '#8B5A2B', g: '#93A7C4', t: '#9AA0A6'
};

// ---- sprites (row-strings, same shapes as the original) ----------------
// Growth-stage bodies carry two frames (a/b) — mouth/limb pose alternates
// every ~1.2s so the pet isn't a frozen still image between ticks.
const SPR = {
  egg:   ['.eee.', 'eeeee', 'esees', 'eeeee', 'eseee', '.eee.'],
  b1: { a: ['c...c', '.ooo.', 'owowo', '.d.d.'],
        b: ['.....', 'coooc', 'owowo', 'd...d'] },                               // baby
  b2: { a: ['c....c', '.oooo.', 'owoowo', '.oooo.', '.d..d.'],
        b: ['......', 'cooooc', 'owoowo', '.oooo.', 'd....d'] },                 // child
  b3: { a: ['c.....c', 'c.ooo.c', '.ooooo.', 'owooowo', '.ooooo.', '.d.d.d.'],
        b: ['.......', 'c.ooo.c', 'coooooc', 'owooowo', '.ooooo.', 'd.d.d.d'] }, // teen
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

// Picks frame a or b based on wall-clock time — same 1.2s cadence as the
// original Berry script's per-draw() frame flip, just sampled once per push.
function pickFrame(pair) {
  return (Math.floor(Date.now() / 1200) % 2 === 0) ? pair.a : pair.b;
}

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

// RTTTL per cosmetic event id (same tunes/roles as the original j_* strings)
const SND = {
  1: 'm:d=16,o=5,b=200:g,p,g,p,g',            // feed / munch
  2: 'c:d=32,o=6,b=220:e,g',                  // clean / chirp
  3: 'e:d=16,o=5,b=140:c,e,g,8c6,16p,8e6',    // evolve
  4: 'h:d=16,o=6,b=180:c,e,g,c7',             // hatch
  5: 'c:d=32,o=6,b=220:e,g',                  // med / heal
  6: 'x:d=16,o=4,b=200:c',                    // refused
  7: 'c:d=32,o=6,b=220:e,g',                  // warm egg
  8: 'w:d=16,o=6,b=180:c,e,g,8c7',            // play
  9: 'd:d=4,o=4,b=70:8e,8d,c'                 // death
};

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function freshState(gen) {
  return {
    st: 0, ev: 0, va: 1,
    h: 10000, ha: 10000, en: 10000, cl: 10000, hp: 10000,
    sl: 0, slo: 0, sk: 0,
    age: 0, warm: 0, cs: 0, gen: gen || 1,
    pp: 0, pt: 0, cf: 0,
    ui: 0, mi: 0, dwell: 0, rp: 0,
    ev_k: 0, ev_t0: 0, stat_open: 0,
    lastNotify: 0, decAcc: 0, aslast: null,
    last_ts: Math.floor(Date.now() / 1000)
  };
}

function decode(rows) {
  const out = [];
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const c = CM[row[x]];
      if (c) out.push([x, y, c]);
    }
  }
  return out;
}

function blit(draw, spriteRows, ox, oy, overrideColor) {
  for (const [x, y, c] of decode(spriteRows)) {
    draw.push(['pixel', ox + x, oy + y, overrideColor || c]);
  }
}

// Like blit(), but swaps the 'w' (eye) pixels for a skin tone when blinking -
// gives the pet a closed-eye frame every few seconds instead of a fixed stare.
function blitBlink(draw, spriteRows, ox, oy, skinColor, blinking) {
  for (let y = 0; y < spriteRows.length; y++) {
    const row = spriteRows[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      let color = CM[ch];
      if (!color) continue;
      if (blinking && ch === 'w') color = skinColor;
      draw.push(['pixel', ox + x, oy + y, color]);
    }
  }
}

// Fixed sky positions (x,y), twinkling on/off in a rotating pattern - same
// idea as the original's stpos flicker, simplified to a handful of points.
const STARS = [[3, 0], [8, 1], [13, 0], [1, 2], [15, 2]];

// ---- offline catch-up: 30% rate, capped at 12h, same as _catchup() -----
function applyCatchup(s, dtSec) {
  const el = Math.min(dtSec, 43200);
  s.age += el;
  if (s.st === 1) {
    const d = el * 3 / 10;
    s.h = clamp(s.h - d * 7 / 10, 0, 10000);
    s.ha = clamp(s.ha - d / 2, 0, 10000);
    s.en = clamp(s.en + d / 4, 0, 10000);
    s.cl = clamp(s.cl - d / 5, 0, 10000);
    if (s.pt > 0) {
      s.pt -= d;
      if (s.pt <= 0) { s.pt = 0; s.pp = Math.min(s.pp + 1, 3); s.cl = clamp(s.cl - 1500, 0, 10000); }
    }
  }
}

// ---- one decay step (fires every DECAY_INTERVAL_SEC), same formulas as ----
// ---- the original Berry script's dec10 branch --------------------------
function decayStep(s) {
  if (s.st !== 1) return; // already dead - don't keep mutating a corpse
  // if multiple steps batch into one call (large dt) and this step kills the
  // pet, later steps in the same batch must not keep decaying it further
  const sl = s.sl === 1;
  const xtra = (s.pp >= 2 || s.sk === 1) ? 5 : 0;
  s.h  = clamp(s.h  - (sl ? 3 : 7), 0, 10000);
  s.ha = clamp(s.ha - (sl ? 0 : 5) - xtra, 0, 10000);
  s.en = clamp(s.en + (sl ? 12 : -4), 0, 10000);
  s.cl = clamp(s.cl - 2 - 4 * s.pp, 0, 10000);

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
  if (dmg > 0) s.hp = clamp(s.hp - dmg, 0, 10000);
  else s.hp = clamp(s.hp + 5, 0, 10000);

  if (s.hp <= 0) {
    s.st = 2; s.ev_k = 9; s.ev_t0 = Date.now(); s.ui = 0;
  }
}

function evolve(s, stage) {
  s.ev = stage;
  if (stage === 1) { s.st = 1; s.ev_k = 4; }
  else {
    if (stage === 4) {
      s.va = s.cs >= 200 ? 0 : (s.cs <= -100 ? 2 : 1);
    }
    s.ev_k = 3;
  }
  s.ev_t0 = Date.now();
}

function checkEvolution(s) {
  if (s.st !== 1) return;
  if (s.ev === 1 && s.age >= 43200) evolve(s, 2);
  else if (s.ev === 2 && s.age >= 129600) evolve(s, 3);
  else if (s.ev === 3 && s.age >= 259200) evolve(s, 4);
}

// ---- time advance: called every invocation, tick or button -------------
function advanceTime(s) {
  const now = Math.floor(Date.now() / 1000);
  const dt = Math.max(0, now - (s.last_ts || now));
  s.last_ts = now;

  if (s.st === 0) {
    s.age += dt;
    if (s.age + s.warm >= 1800) evolve(s, 1);
    return;
  }
  if (s.st !== 1) return; // dead: nothing decays

  if (dt > 60) { applyCatchup(s, dt); checkEvolution(s); return; }

  s.age += dt;

  // Auto-sleep 22-08. A manual override (slo != 0) lasts only until the next
  // switch point - when `auto` flips relative to the last time we checked,
  // the override is cleared and the schedule takes back control. Without
  // this, one SLEEP/WAKE button press would stick forever and the schedule
  // would never engage again.
  const hr = new Date().getHours();
  const auto = hr >= 22 || hr < 8;
  if (s.aslast === null || s.aslast === undefined) {
    s.aslast = auto;
  } else if (auto !== s.aslast) {
    s.aslast = auto;
    s.slo = 0;
  }
  if (s.slo === 0) s.sl = auto ? 1 : 0;

  if (s.pt > 0 && s.sl !== 1) {
    s.pt -= dt;
    if (s.pt <= 0) { s.pt = 0; s.pp = Math.min(s.pp + 1, 3); s.cl = clamp(s.cl - 1500, 0, 10000); }
  }

  // Accumulate real seconds across calls (each tick only contributes ~2s) and
  // fire a decay step every time it crosses a DECAY_INTERVAL_SEC boundary -
  // carrying the remainder forward instead of resetting it. Fixes: with a
  // per-call Math.floor(dt/N), a steady 2s-interval tick never reached N in a
  // single call and decay silently never fired.
  s.decAcc = (s.decAcc || 0) + dt;
  const capSteps = Math.ceil(3600 / DECAY_INTERVAL_SEC); // cap: 1h worth per call
  const steps = Math.min(capSteps, Math.floor(s.decAcc / DECAY_INTERVAL_SEC));
  s.decAcc -= steps * DECAY_INTERVAL_SEC;
  for (let i = 0; i < steps; i++) decayStep(s);

  checkEvolution(s);
}

// ---- menu / reset dwell timers, checked every invocation ---------------
function checkDwell(s) {
  const now = Date.now();
  if (s.ui === 1 && now - s.dwell >= 2000) {
    action(s, s.mi);
  } else if (s.ui === 5) {
    if (s.rp === 0 && now - s.dwell >= 6000) {
      s.ui = 0;
    } else if (s.rp === 1 && now - s.dwell >= 3000) {
      const gen = s.gen;
      Object.assign(s, freshState(gen + 1));
      s.ev_k = 7; s.ev_t0 = now;
    }
  } else if (s.ui === 3 && now - s.stat_open >= 8000) {
    s.ui = 0;
  }
}

// ---- FEED / PLAY / CLEAN / MED / SLEEP / STATS, same semantics ---------
function action(s, id) {
  s.ui = 0;
  if (id === 1) {
    if (s.sl === 1 || s.st !== 1) { s.ev_k = 6; }
    else {
      if (s.h > 9000) s.ha = clamp(s.ha - 500, 0, 10000);
      else if (s.h < 7000) s.cs += 10;
      s.h = clamp(s.h + 4000, 0, 10000);
      s.pt = 2700 + Math.floor(Math.random() * 2700);
      s.ev_k = 1;
    }
  } else if (id === 2) { // PLAY — instant, no minigame (see note in README)
    if (s.sl === 1 || s.st !== 1 || s.en < 1500) { s.ev_k = 6; }
    else {
      s.ha = clamp(s.ha + 1500, 0, 10000);
      s.en = clamp(s.en - 800, 0, 10000);
      s.cs += 5;
      s.ev_k = 8;
    }
  } else if (id === 3) {
    if (s.sl === 1) { s.ev_k = 6; }
    else {
      if (s.pp > 0) s.cs += 10;
      s.pp = 0; s.cl = 10000; s.ev_k = 2;
    }
  } else if (id === 4) {
    if (s.sk === 1) { s.sk = 0; s.cs += 10; s.ha = clamp(s.ha - 500, 0, 10000); s.ev_k = 5; }
    else { s.ev_k = 6; }
  } else if (id === 5) {
    if (s.sl === 1) { s.slo = 1; s.sl = 0; } else { s.slo = 2; s.sl = 1; }
  } else if (id === 6) {
    s.ui = 3; s.stat_open = Date.now();
  } else if (id === 7) { // RESET - only takes effect while dead, skips the
    // on-device two-press confirm dance since a dashboard button already
    // requires a deliberate tap
    if (s.st === 2) {
      const gen = s.gen;
      Object.assign(s, freshState(gen + 1));
      s.ev_k = 7;
    }
  } else if (id === 8) { // WAKE - force awake; no-op if already awake
    if (s.sl === 1) { s.slo = 1; s.sl = 0; }
  }
  s.ev_t0 = Date.now();
}

function onButton(s, btn) {
  const now = Date.now();
  if (btn !== 'select') {
    if (s.ui !== 0) s.ui = 0;
    return;
  }
  if (s.st === 0) { // warm the egg
    s.warm = Math.min(s.warm + 60, 900);
    s.ev_k = 7; s.ev_t0 = now;
  } else if (s.st === 2) { // dead: two-step restart
    if (s.ui === 5) {
      if (s.rp === 0) { s.rp = 1; s.dwell = now; }
      else { s.ui = 0; }
    } else { s.ui = 5; s.rp = 0; s.dwell = now; }
  } else if (s.ui === 0) {
    s.ui = 1; s.mi = 0; s.dwell = now;
  } else if (s.ui === 1) {
    s.mi = (s.mi + 1) % 7;
    s.dwell = now;
  } else if (s.ui === 3) {
    s.ui = 0;
  }
}

// ---- render current state to an AWTRIX draw-payload --------------------
function renderPayload(s) {
  if (s.ui === 3) {
    const a = s.age;
    const days = Math.floor(a / 86400), hrs = Math.floor((a % 86400) / 3600);
    return {
      text: `${PET_NAME}  AGE ${days}d${hrs}h  GEN ${s.gen}  CARE ${s.cs}  HP ${Math.floor(s.hp / 100)}%`,
      textColor: '#F0E6D8', scroll: true
    };
  }

  const draw = [['rectFill', 0, 0, 32, 8, '#000000']];

  if (s.ui === 1) {
    let lab = MLAB[s.mi], glyph = GLY[s.mi];
    if (s.mi === 5 && s.sl === 1) { lab = 'WAKE'; glyph = GLY[7]; }
    blit(draw, glyph, 0, 1);
    draw.push(['text', 11, 1, lab, '#F0E6D8']);
    draw.push(['rectFill', 0, 7, 32, 1, '#1A1A1A']);
    const fw = clamp(Math.floor((Date.now() - s.dwell) * 32 / 2000), 0, 32);
    if (fw > 0) draw.push(['rectFill', 0, 7, fw, 1, '#D97757']);
    return { draw };
  }

  if (s.ui === 5) {
    draw.push(['rectFill', 0, 7, 32, 1, '#1A1A1A']);
    if (s.rp === 0) {
      draw.push(['text', 7, 1, 'NEW EGG?', '#8A8178']);
    } else {
      draw.push(['text', 7, 1, 'NEW EGG?', '#F0E6D8']);
      const fw = clamp(Math.floor((Date.now() - s.dwell) * 32 / 3000), 0, 32);
      if (fw > 0) draw.push(['rectFill', 0, 7, fw, 1, '#D97757']);
    }
    return { draw };
  }

  if (s.st === 2) {
    draw.push(['line', 0, 7, 16, 7, '#1E2430']);
    blit(draw, SPR.tomb, 4, 1);
    blit(draw, SPR.ghost, 11, (Math.floor(Date.now() / 800) % 2 === 0) ? 1 : 2);
    return { draw };
  }

  const hr = new Date().getHours();
  const night = s.sl === 1 || hr >= 20 || hr < 6;
  draw.push(['line', 0, 7, 16, 7, night ? '#14203A' : '#1E4D1E']);
  draw.push(['rectFill', 1, 0, 2, 2, night ? '#8C8655' : '#9A8430']);

  if (night) {
    // one star "goes dark" per 400ms tick, rotating through the set
    const off = Math.floor(Date.now() / 400) % STARS.length;
    STARS.forEach(([sx, sy], i) => {
      if (i !== off) draw.push(['pixel', sx, sy, '#3A3A3A']);
    });
  }

  // eyes close for ~150ms every 4s
  const blinking = (Date.now() % 4000) < 150;

  if (s.st === 0) {
    const wob = Math.floor(Date.now() / 700) % 2; // 1px side-to-side wobble
    blit(draw, SPR.egg, 5 + wob, 1);
    const pr = clamp(Math.floor((s.age + s.warm) * 17 / 1800), 0, 17);
    if (pr > 0) draw.push(['rectFill', 0, 7, pr, 1, '#D97757']);
  } else {
    let pair, w, h, skin;
    if (s.ev === 1) { pair = SPR.b1; w = 5; h = 4; skin = CM.o; }
    else if (s.ev === 2) { pair = SPR.b2; w = 6; h = 5; skin = CM.o; }
    else if (s.ev === 3) { pair = SPR.b3; w = 7; h = 6; skin = CM.o; }
    else if (s.va === 0) { pair = SPR.a0; w = 8; h = 7; skin = CM.O; }
    else if (s.va === 2) { pair = SPR.a2; w = 8; h = 7; skin = CM.q; }
    else { pair = SPR.a1; w = 8; h = 7; skin = CM.o; }
    const asleep = s.sl === 1;
    // no mouth/limb flip while asleep - one still frame, same as the
    // original's f0-only sleeping pose (no f1 alternation)
    const frame = asleep ? pair.a : pickFrame(pair);
    const ox = Math.floor((17 - w) / 2), oy = 7 - h;

    for (let i = 0; i < s.pp; i++) blit(draw, SPR.poop, 12 + i, 5 - i);
    // eyes stay shut for the whole nap, not just a quick blink
    blitBlink(draw, frame, ox, oy, skin, asleep || blinking);
    if (asleep) draw.push(['text', ox + w + 1, 3, 'z', '#5C7FBF']);
    if (s.sk === 1) { draw.push(['pixel', 0, 0, '#35C24A']); draw.push(['pixel', 0, 1, '#35C24A']); }

    const ed = Date.now() - s.ev_t0;
    if ((s.ev_k === 1 || s.ev_k === 8) && ed < 900) blit(draw, SPR.heart, 7, 0);
    else if (s.ev_k === 2 && ed < 1200) {
      const bx = Math.floor(ed * 17 / 1200);
      draw.push(['line', bx, 2, bx, 6, '#F2E3C8']);
    } else if (s.ev_k === 5 && ed < 700) {
      draw.push(['line', 7, 1, 9, 1, '#35C24A']); draw.push(['line', 8, 0, 8, 2, '#35C24A']);
    } else if (s.ev_k === 6 && ed < 700) {
      draw.push(['line', 6, 1, 10, 5, '#E05540']); draw.push(['line', 10, 1, 6, 5, '#E05540']);
    }
  }

  // Bars pulse when critical (<2500) instead of sitting there lit - a
  // silent-but-visible warning, same threshold/cadence as the original.
  const barBlink = (Math.floor(Date.now() / 300) % 2) === 0;
  const bars = [s.h, s.ha, s.en, s.cl];
  const bcol = ['#D97757', '#E8C33F', '#3FB4E8', '#4FC96F'];
  for (let i = 0; i < 4; i++) {
    draw.push(['rectFill', 18, i * 2, 14, 1, '#202020']);
    let w = Math.floor(bars[i] * 14 / 10000);
    if (w < 1 && bars[i] > 0) w = 1;
    if (w > 0 && (bars[i] >= 2500 || barBlink)) {
      draw.push(['rectFill', 18, i * 2, w, 1, bcol[i]]);
    }
  }
  return { draw };
}

function checkNotify(s) {
  if (s.st !== 1 || s.sl === 1) return null;
  const now = Date.now();
  if (now - (s.lastNotify || 0) < 1800000) return null;
  if (s.h < 1500 || s.ha < 1500 || s.cl < 1500 || s.sk === 1) {
    s.lastNotify = now;
    return { text: `${PET_NAME} needs you!`, textColor: '#D97757' };
  }
  return null;
}

// ---- entry point ---------------------------------------------------------
// input: { event: 'tick' } | { event: 'button', btn: 'select'|'left'|'right' }
// staticData: n8n's persistent workflow static data object
function run(input, staticData) {
  if (!staticData.clawd) staticData.clawd = freshState(1);
  const s = staticData.clawd;

  const prevEvK = s.ev_k;
  const prevSt = s.st;
  const prevEv = s.ev;
  const prevSk = s.sk;

  advanceTime(s);
  checkDwell(s);
  if (input.event === 'button') onButton(s, input.btn);
  else if (input.event === 'action') action(s, input.id);

  const payload = renderPayload(s);
  const sound = (s.ev_k !== prevEvK && s.ev_k > 0) ? SND[s.ev_k] : null;
  const notify = checkNotify(s);

  // Force the panel onto Clawd for anything the user actually did, or for a
  // state change worth interrupting the rotation for (died / evolved / fell
  // ill) - but never for a plain background tick, or you'd hijack the screen
  // every couple of seconds.
  const diedNow = prevSt !== 2 && s.st === 2;
  const evolvedNow = prevEv !== s.ev;
  const gotSickNow = prevSk !== 1 && s.sk === 1;
  const switchTo = input.event !== 'tick' || diedNow || evolvedNow || gotSickNow;

  return { payload, sound, notify, switchTo };
}

module.exports = { run, freshState };
