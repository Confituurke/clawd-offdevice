// The caretaker skill (agent/skills/clawd-caretaker/SKILL.md) played for real:
// its decision table, written out below, drives whole lives through the real
// engine at every difficulty, seeing only what `clawd status` shows and using
// only what `clawd do` sends. If the skill's advice changes, change it here too.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../n8n/clawd-engine.js');
const { decode, ACTIONS } = require('../agent/clawd.js');

// How often the skill checks in, per difficulty (minutes).
const EVERY = { 'I Can Win': 120, 'Easy': 120, 'Medium': 120, 'Hard': 90, 'Nightmare': 45 };

// The skill's decision table: what to do, given the status and the local hour.
function decide(st, hour) {
  const r = st.rules;
  if (st.dead) return ['newegg'];
  if (st.egg) return ['warm'];
  const acts = [];
  if (st.sick) acts.push('med');
  const bedSoon = (r.sleepsFrom - hour + 24) % 24 <= 1;          // the last check-in before bed
  const nightTime = r.sleepsFrom > r.sleepsUntil ? (hour >= r.sleepsFrom || hour < r.sleepsUntil) : (hour >= r.sleepsFrom && hour < r.sleepsUntil);
  if (st.asleep) {
    if (!nightTime && st.energy >= 90) acts.push('wake');           // a nap is over
    return acts;
  }
  if (st.poops > 0 || st.hygiene < 60) acts.push('clean');
  if (st.food < 70 || (bedSoon && st.food < 90)) acts.push('feed');
  if (st.food < 30) acts.push('feed');                              // one meal is +40%
  if (st.happiness < 90 && st.energy >= 15) acts.push('play');
  if (st.energy < 25 && !bedSoon) acts.push('sleep');               // a nap
  return acts;
}

// Run a life: the engine plays the world, the skill checks in every EVERY minutes
// while awake, once more just before bed, and once when the pet wakes up.
function life(level, days, seed = 23) {
  const cfg = E.makeConfig({ TZ: 'Europe/Berlin', DIFFICULTY: level });
  const config = JSON.parse(E.settingsMessage(cfg));
  const id = { feed: 1, play: 2, clean: 3, med: 4, sleep: 5, wake: 8, warm: 9, newegg: 10 };
  const t0 = Date.parse('2026-10-01T08:00:00+02:00');
  const s = E.freshState(1, t0);
  const out = { adult: null, legend: false, died: null, old: 0, refused: 0 };
  const random = Math.random;
  Math.random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  try {
    let wasAsleep = false;
    for (let t = t0 + 60000; t < t0 + days * 86400000; t += 60000) {
      E.advanceTime(s, cfg, t);
      if (s.st === 2) { out.died = s.age / 3600; out.old = s.old; break; }
      const d = new Date(t);
      const bedtime = d.getHours() === cfg.SLEEP_FROM - 1 && d.getMinutes() === 30;
      const wokeUp = wasAsleep && s.sl !== 1;
      wasAsleep = s.sl === 1;
      const st = decode(E.stateLine(s, cfg, t), config, t / 1000);
      // In the last 6 hours before it grows up, check in twice as often: the adult type is set then.
      const every = st.next === 'Adult' && st.nextInHours <= 6 ? EVERY[level] / 2 : EVERY[level];
      if ((t - t0) % (every * 60000) !== 0 && !bedtime && !wokeUp) continue;
      for (const a of decide(st, d.getHours())) {
        assert.ok(ACTIONS.includes(a), a);
        const fx = s.fx;
        E.action(s, id[a], cfg, t);                                  // what `clawd do` sends: no Star Catch hits
        if (s.fx !== fx && s.ev_k === 6) out.refused++;
      }
      if (s.ev === 4 && out.adult === null) out.adult = ['happy', 'normal', 'grumpy'][s.va];
      if (s.ev === 6) out.legend = true;
    }
  } finally { Math.random = random; }
  return out;
}

test('agent: the caretaker skill gives every pet a long life - old age, not neglect - and nearly always a legend', () => {
  for (const level of Object.keys(E.PRESETS)) {
    let legends = 0;
    for (const seed of [23, 101, 977, 4242, 31337]) {          // five different lives per level
      const r = life(level, 30, seed);
      assert.equal(r.old, 1, `${level} (seed ${seed}): passes away of old age, not of neglect`);
      assert.notEqual(r.adult, 'grumpy', `${level} (seed ${seed}): never a neglected adult`);
      if (r.legend) legends++;
    }
    assert.ok(legends >= 4, `${level}: a legend in ${legends} of 5 lives`);
  }
});

test('agent: the command-line tool only knows the actions a person has', () => {
  assert.deepEqual([...ACTIONS].sort(), ['clean', 'feed', 'med', 'newegg', 'play', 'sleep', 'wake', 'warm']);
  const src = require('fs').readFileSync(require.resolve('../agent/clawd.js'), 'utf8');
  assert.doesNotMatch(src, /config\/set|CONFIG_SET|\/webhook|staticData|api\/v1/, 'no settings, no workflow data, no clock API');
});

test('agent: status decodes the state line the way Home Assistant does', () => {
  const cfg = E.makeConfig({ TZ: 'Europe/Berlin' });
  const T = Date.parse('2026-10-01T12:00:00+02:00');
  const s = Object.assign(E.freshState(3, T), { st: 1, ev: 5, va: 0, h: 6400, ha: 5000, en: 2000, cl: 9000, hp: 8800, pp: 1, sk: 1, cs: 420, age: 180 * 3600, eld: 168 * 3600, lgh: 3600 });
  const st = decode(E.stateLine(s, cfg, T), JSON.parse(E.settingsMessage(cfg)), T / 1000 + 5);
  assert.deepEqual([st.stage, st.type, st.food, st.happiness, st.energy, st.hygiene, st.health, st.poops, st.sick, st.care, st.generation, st.ageHours],
    ['Elder', 'happy', 64, 50, 20, 90, 88, 1, true, 420, 3, 180]);
  assert.equal(st.next, 'Legend'); assert.equal(st.nextInHours, 47);
  assert.equal(st.difficulty, 'Medium'); assert.equal(st.rules.careForLegend, 400);
  assert.equal(st.brainRunning, true); assert.equal(st.publishedSecondsAgo, 5);
  assert.equal(decode('garbage', null, 0), null);
});
