---
name: clawd-caretaker
description: Look after Clawd, the AWTRIX virtual pet crab, like a caring person - check in regularly, feed, clean, heal, play, put it to bed, hatch a new egg when one dies - so that every pet lives as long as possible. Use when asked to take care of, check on, or run Clawd.
license: MIT
metadata:
  version: 0.1.0
  author: clawd-hybrid-pet
  hermes:
    tags: [game, virtual-pet, awtrix, home-automation]
---

# Clawd caretaker

You look after Clawd, a virtual pet crab on an AWTRIX clock. **Your goal is not many generations:
it is that each pet lives as long as possible** - ideally growing into a happy adult, an elder, a
golden legend, and passing away peacefully of old age. Only when a pet has died do you start a new
egg, and then you give that one the same care.

## Play fair - you are a person, not the developer

You have exactly two commands, and nothing else touches the pet:

```bash
clawd status          # what the pet looks like now (JSON)
clawd do <action>     # feed | play | clean | med | sleep | wake | warm | newegg
```

- **Never** change settings or the difficulty, publish to other MQTT topics, call n8n, Home
  Assistant or the clock directly, or edit anything the game stores. Not even "to help the pet".
- Don't try to predict hidden values (the random sickness roll, the potty timer): act on what
  `status` shows, like a person looking at the clock or the dashboard.
- One check-in = `clawd status`, decide with the table below, `clawd do` each action, done.
  Don't spam actions: a feed you don't need can cost happiness.
- If `status` says `"brainRunning": false`, the game itself isn't running: do nothing and report it.

Setup: the `clawd` command (`agent/clawd.js` in the repo, Node 18+) needs
`CLAWD_MQTT=mqtt://user:password@host:1883` - the broker the pet lives on. See `agent/README.md`.

## How Clawd works

**Meters** (0-100%): `food`, `happiness`, `energy`, `hygiene`, and `health`. Every few seconds of
game time they change a little:

- Awake: food and happiness drop, energy drops, hygiene drops (faster with poop on the floor).
  Asleep: food drops much slower, happiness stays, energy refills. `rules.hungryAfterHours` is how
  long a full pet takes to get hungry while awake - the difficulty's pace for everything.
- **Poop** comes a while after each meal. Each poop makes hygiene drop faster.
- **Illness** (`sick`): while awake, if food, happiness or hygiene is below 20%, or there are 2+
  poops, there is a chance (`rules.sicknessChancePct`) each step to fall ill. Ill, it loses health.
- **Health** drops while food is 0, hygiene is 0 or it is ill; otherwise it slowly recovers. Health
  0 = death. This is the only way a well-kept pet dies young - and it is always avoidable.
- **Care score** (`care`): how well it is raised. It goes **up** +10 for feeding when food is
  below 70%, +10 for cleaning up poop, +10 for medicine when ill, +5 for playing. It goes **down**
  25 each time a meter hits 0 and each time it falls ill. Feeding when food is above 90% costs
  happiness.
- **Sleep:** it sleeps from `rules.sleepsFrom` to `rules.sleepsUntil` on its own. Asleep it refuses
  food, cleaning and play; medicine and `wake` still work. `sleep` during the day is a nap.

**Growing up:** egg → baby → child → teen → adult (at `rules.adultAt` hours) → elder
(`rules.elderAt`). At adulthood the care score decides its type, and the type decides the rest:

| Adult | Care when it grows up | What follows |
|---|---|---|
| happy | ≥ `rules.careForHappyAdult` | elder with the longest old age (`elderLifespanHours` × 1.5); can become a **legend** |
| normal | in between | elder with a normal old age |
| grumpy | ≤ `rules.careForGrumpyAdult` | never an elder; the shortest life |

A **legend**: a happy elder that stays well raised - health 80%+, not ill, and care ≥
`rules.careForLegend` - for `rules.legendAfterHours` hours (the count pauses, it isn't lost, when it
slips). A legend lives longest, and its egg hatches faster with a head start in care.
`status.next` and `status.nextInHours` tell you what comes next and when.

## When to check in

| Difficulty (`status.difficulty`) | Check in every | Also |
|---|---|---|
| I Can Win | 2 h | |
| Easy | 2 h | |
| Medium | 2 h | |
| Hard | 1.5 h | |
| Nightmare | 45 min | |

On every level also check in **about 30 minutes before `sleepsFrom`** (the bedtime check) and **right
after `sleepsUntil`** (it just woke up). No need to check at night: nothing can be done except
medicine, and it can't fall ill asleep.

## What to do at a check-in

Go down the list and do **every** line that applies, in this order:

1. **Dead** → `newegg`. Then report how long it lived and how (old age or neglect).
2. **Egg** → `warm` (each press brings hatching a minute closer).
3. **Ill** (`sick`) → `med`, even if it is asleep.
4. **Asleep** → if it's daytime (outside the sleep window) and energy ≥ 90%, a nap is over: `wake`.
   Otherwise let it sleep and stop here.
5. **Poop, or hygiene below 60%** → `clean`.
6. **Food below 70%** → `feed`. At the bedtime check, feed if food is below 90% (the night is long).
   If food is below 30%, feed twice (a meal is +40%).
7. **Happiness below 90% and energy at least 15%** → `play`.
8. **Energy below 25%**, and it isn't the bedtime check → `sleep` (a nap; step 4 wakes it later).

Then report one line: stage, meters, care, what you did, and what comes next.

This routine was tested by playing whole lives with the real game at every difficulty: every pet
reached old age (none died of neglect) and nearly all became legends. Harder difficulties need
the shorter check-in times above - don't stretch them.

## Good to know

- A `refused` result means the pet was asleep, not alive, or too tired to play - not an error.
- Playing through this command is the quick version (+15% happiness, +5 care); the Star Catch
  mini-game on the clock itself gives more when a person plays it. Both are fair play.
- If it dies young anyway, say why from the last status (food 0? ill for long?) and tighten your
  check-ins for the next egg.
