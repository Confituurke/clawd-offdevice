// Balance: whole lives played with the real engine, one per difficulty level.
// A simulated player checks in every `every` minutes while Clawd is awake (and
// once at 21:50 with `bedtime`): cleans, gives medicine when ill, feeds, plays
// Star Catch (2 of 3 hits) and puts a tired pet down for a nap (`nap`). No values
// are touched - only the actions a person has. Randomness (sickness, the potty
// timer) is seeded, so every run is the same.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../n8n/clawd-engine.js');

function life(level, pl, days) {
  const cfg = E.makeConfig({ TZ: 'Europe/Berlin', DIFFICULTY: level });
  const t0 = Date.parse('2026-10-01T08:00:00+02:00');
  const s = E.freshState(1, t0);
  const out = { adult: null, legendAt: null, died: null, old: 0 };
  const random = Math.random;
  let seed = 11;
  Math.random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  try {
    for (let t = t0 + 60000; t < t0 + days * 86400000; t += 60000) {
      E.advanceTime(s, cfg, t);
      if (s.st === 2) { out.died = s.age / 3600; out.old = s.old; break; }
      if (s.st !== 1) continue;
      const d = new Date(t), h = d.getHours(), m = d.getMinutes();
      const due = (t - t0) % (pl.every * 60000) === 0;
      if (h >= cfg.SLEEP_FROM || h < cfg.SLEEP_TO) {
        // Night: a night feed wakes it, feeds it (twice if needed) and puts it back to bed.
        if (pl.nightFeed && pl.nightFeed.includes(h) && m === 0 && s.h < 5000) {
          E.action(s, 8, cfg, t);
          if (s.sk === 1) E.action(s, 4, cfg, t);
          E.action(s, 1, cfg, t);
          if (s.h < 7000) E.action(s, 1, cfg, t);
          if (s.pp > 0) E.action(s, 3, cfg, t);
          E.action(s, 5, cfg, t);
        }
        continue;
      }
      const bedtime = pl.bedtime && h === cfg.SLEEP_FROM - 1 && m === 50;
      if (s.sl === 1 && s.slo === 2 && due && s.en > 9000) E.action(s, 8, cfg, t);   // wake from a nap
      if (s.sl !== 1 && (due || bedtime)) {
        if (s.pp > 0 || s.cl < pl.cleanBelow) E.action(s, 3, cfg, t);
        if (s.sk === 1) E.action(s, 4, cfg, t);
        if (s.h < pl.feedBelow || (bedtime && s.h < 9000)) E.action(s, 1, cfg, t);
        if (s.h < 3000) E.action(s, 1, cfg, t);
        if (s.ha < pl.play && s.en >= 1500) E.action(s, 2, cfg, t, { hits: 2 });
        if (pl.nap && !bedtime && s.en < 2500) E.action(s, 5, cfg, t);
      }
      if (s.ev === 4 && out.adult === null) out.adult = ['happy', 'normal', 'grumpy'][s.va];
      if (s.ev === 6 && out.legendAt === null) out.legendAt = s.age / 3600;
    }
  } finally {
    Math.random = random;
  }
  return out;
}

// A caring player: checks in every 2 h (hourly on Nightmare), and at night gives a feed at
// 01:00 and 04:00 when food is below half - which only Nightmare's pace really needs.
const CARING = { every: 120, feedBelow: 7000, cleanBelow: 6000, play: 8000, bedtime: true, nap: true, nightFeed: [1, 4] };
const caring = (lv) => lv === 'Nightmare' ? Object.assign({}, CARING, { every: 60 }) : CARING;
const LEVELS = Object.keys(E.PRESETS);

test('balance: on every level a caring player raises a happy adult, then a legend, which dies of old age', () => {
  for (const lv of LEVELS) {
    const r = life(lv, caring(lv), 30);
    assert.equal(r.adult, 'happy', lv);
    assert.ok(r.legendAt !== null, `${lv}: becomes a legend`);
    assert.equal(r.old, 1, `${lv}: passes away of old age`);
    assert.ok(r.died > r.legendAt, `${lv}: lives on as a legend`);
  }
});

// Players found by searching the space of play styles (every/feed/clean/play):
// each one reaches that kind of adult on that level and keeps it alive for at
// least a day after it grows up.
const REACHABLE = {
  'I Can Win': { normal: { every: 60, feedBelow: 2500, cleanBelow: 1000, play: 4000 }, grumpy: { every: 60, feedBelow: 2500, cleanBelow: 1000, play: 0 } },
  'Easy':      { normal: { every: 60, feedBelow: 2500, cleanBelow: 1000, play: 4000 }, grumpy: { every: 60, feedBelow: 2500, cleanBelow: 1000, play: 0 } },
  'Medium':    { normal: { every: 60, feedBelow: 2500, cleanBelow: 1000, play: 4000 }, grumpy: { every: 240, feedBelow: 2500, cleanBelow: 1000, play: 4000, nightFeed: [1, 4] } },
  'Hard':      { normal: { every: 60, feedBelow: 2500, cleanBelow: 1000, play: 4000 }, grumpy: { every: 120, feedBelow: 2500, cleanBelow: 1000, play: 4000, nightFeed: [1, 4] } },
  // Nightmare: without night feeds even a player in every half hour stays below a happy adult
  'Nightmare': { normal: { every: 30, feedBelow: 7000, cleanBelow: 2000, play: 4000 }, grumpy: { every: 30, feedBelow: 5500, cleanBelow: 1000, play: 4000 } }
};

test('balance: on every level a normal and a grumpy adult are reachable without the pet dying', () => {
  for (const lv of LEVELS) {
    for (const kind of ['normal', 'grumpy']) {
      const pl = Object.assign({ bedtime: true, nap: true }, REACHABLE[lv][kind]);
      const days = E.PRESETS[lv].ADULT_AT_HOURS / 24 + 1.5;
      const r = life(lv, pl, days);
      assert.equal(r.adult, kind, `${lv}: ${kind}`);
      assert.ok(r.died === null || r.died > E.PRESETS[lv].ADULT_AT_HOURS + 24, `${lv}: the ${kind} adult lives on`);
    }
  }
});

test('balance: a legend always fits in a happy elder\'s life, with less room on harder levels', () => {
  let room = Infinity;
  for (const lv of LEVELS) {
    const p = E.PRESETS[lv];
    const left = p.ELDER_LIFE_HOURS * 1.5 - p.LEGEND_AFTER_HOURS;
    assert.ok(left > 0, `${lv}: ${p.LEGEND_AFTER_HOURS} h to legend within ${p.ELDER_LIFE_HOURS * 1.5} h`);
    assert.ok(left < room, `${lv}: tighter than the level before`);
    room = left;
  }
});

test('balance: on Nightmare only a player who also feeds at night raises a happy adult', () => {
  const days = E.PRESETS.Nightmare.ADULT_AT_HOURS / 24 + 1;
  const noNights = life('Nightmare', Object.assign({}, CARING, { every: 45, nightFeed: null }), days);
  assert.ok(noNights.adult && noNights.adult !== 'happy', `in every 45 min, no night feeds: ${noNights.adult}`);
  assert.equal(life('Nightmare', caring('Nightmare'), days).adult, 'happy', 'hourly plus night feeds: happy');
  const slow = life('Nightmare', Object.assign({}, CARING, { every: 90 }), days);
  assert.ok(slow.died !== null && slow.died < 72, `in only every 90 min, it doesn't survive: died at ${Math.round(slow.died)} h`);
});
