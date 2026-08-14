# 🦀 Clawd — Off-Device Edition

*A tiny crab. A cry for help. A shortage of RAM.*

Clawd is a virtual pet that lives on your [AWTRIX](https://blueforcer.github.io/awtrix-ng/) matrix display —
hatch it from an egg, feed it, play with it, keep it clean, watch it grow through
four whole life stages, and (if you neglect it, you monster) bury it.

The original [Clawd script](https://flows.blueforcer.de/) by **Blueforcer** runs entirely
on the AWTRIX device itself, in [Berry](https://berry-lang.github.io/). Great idea. One
problem: on a plain ESP32 (no PSRAM — looking at you, standard Ulanzi TC001), it's just
*too much crab* for the heap, and you get greeted with:

```
ERR:Clawd - out of memory
```

This repo is the fix that involves exactly zero soldering irons and zero firmware hacks:
**move the entire brain off the device.** Clawd's whole simulation — hunger, happiness,
energy, cleanliness, evolution, sickness, death, the works — now runs in an
[n8n](https://n8n.io/) workflow. Your AWTRIX doesn't think anymore. It just draws
whatever pixels it's told to, over plain HTTP. No interpreter, no heap pressure, no
`ERR:` in angry red letters.

Turns out offloading the thinking to somewhere with more RAM than a 1990s calculator
works pretty well. Who knew.

---

## How it actually works

```
                     ┌──────────────────────┐
    physical button  │                      │  PUT /apps/pushed/clawd
    on the Ulanzi ───┤   n8n workflow       ├───────────────────────►  AWTRIX
      (via MQTT)     │   (the actual brain) │        draw commands
                     │                      │
   HA dashboard  ───►│  - decay/aging tick  │
   button (webhook)  │  - menu / actions    │
                     │  - sprite rendering  │
   every 2s     ─────┤  - sound + notify    │
   (schedule)        └──────────────────────┘
```

- AWTRIX becomes a **dumb screen**: it just renders `pixel`/`rect`/`text` draw
  commands it's pushed over HTTP. That's it. That's the whole job now.
- **n8n is the brain**: a scheduled tick ages the pet every 2 seconds, button
  presses (via MQTT — that's the only way AWTRIX exposes them) and/or Home
  Assistant buttons (via webhook) trigger feeding/playing/cleaning/etc.
- State (hunger, happiness, generation, care score, …) lives in n8n's
  **workflow static data** — no external database needed.
- When something actually happens (you fed it, it evolved, it died — RIP), n8n
  also force-switches the AWTRIX display to Clawd immediately, instead of
  waiting for the app rotation to get around to it.

## What you get vs. the original

| | On-device Berry script | This (off-device) |
|---|---|---|
| Runs on plain ESP32 (no PSRAM) | 😬 often not | ✅ yes, AWTRIX barely notices |
| Feed / Play / Clean / Med / Sleep / Stats | ✅ | ✅ |
| Evolution (egg → 4 stages), sickness, death | ✅ | ✅ |
| Sound + notifications | Often the first thing cut for RAM | ✅ back in, RAM isn't a concern anymore |
| Idle animation (frame flip, blink, wobble) | ✅ (40fps, it's *on* the device) | ✅ (sampled every 2s, less silky, still alive) |
| PLAY minigame (real-time star catching) | ✅ | ❌ simplified to an instant effect — a push-based model can't really do a reflex minigame |
| Home Assistant dashboard buttons | ❌ | ✅ bonus feature the original never had |
| Requires an always-on server | ❌ | ✅ (you need n8n running anyway, which — if you're reading this — you probably already have) |

## Requirements

- A running **n8n** instance (self-hosted or cloud)
- An **MQTT broker** — AWTRIX NG only publishes button-press events over MQTT,
  there's no HTTP equivalent, so this one's non-negotiable if you want the
  physical buttons to do anything
- *Optional:* **Home Assistant**, if you want dashboard buttons in addition to
  (or instead of) the physical ones

## Setup

### 1. AWTRIX NG

Enable MQTT under device settings:

```
mqttEnabled: true
mqttHost: <your broker>
mqttPrefix: awtrixNG   # or whatever you like — just keep it consistent below
```

Delete any on-device Clawd script if you had one installed — it's not needed
and it's the whole thing we're trying to avoid.

### 2. n8n

1. Import [`n8n/clawd-workflow.json`](n8n/clawd-workflow.json).
2. In the **"Button Events (MQTT)"** node: set the topic to match your prefix
   (`<prefix>/state/buttons/+`) and attach your MQTT broker credential.
3. In the three `http-*` nodes (**Push Draw**, **Play Sound**, **Send Notify**,
   and if you added it, **Switch To Clawd**): replace `<AWTRIX_IP>` with your
   device's real IP.
4. Optionally rename the pet at the top of the **Clawd Engine** node
   (`const PET_NAME = 'Clawd';`), or tune how fast the pet's stats decay
   (`const DECAY_INTERVAL_SEC = 60;` — higher = slower decay, e.g. `120` for
   half speed again).
5. **Activate/publish the workflow.** This step is easy to forget and the
   symptom is "nothing happens" — ask me how I know.

[`n8n/clawd-engine.js`](n8n/clawd-engine.js) is a plain, readable copy of the
same brain code, useful if you just want to read through the game logic
without wading through JSON escaping.

### 3. Home Assistant (optional — dashboard buttons)

The workflow exposes a webhook at `POST /webhook/clawd-action` with a body
like `{"action":"feed"}` (valid actions: `feed`, `play`, `clean`, `med`,
`sleep`, `stats`, `wake`, `reset`).

`wake` force-wakes the pet regardless of the auto-sleep schedule (`sleep`
stays a toggle, mirroring the on-device menu item). `reset` only does
anything while the pet is dead — it skips the on-device two-press confirm
dance and immediately hatches a new egg, since a deliberate dashboard tap
doesn't need the same misclick protection a single physical button does.

Add the REST command definitions — **restart HA fully after this, `rest_command`
does not hot-reload**:

```yaml
# configuration.yaml
rest_command: !include homeassistant/rest_command.yaml
```

→ [`homeassistant/rest_command.yaml`](homeassistant/rest_command.yaml)
(replace `<N8N_HOST>` with your real n8n address in all six entries)

Then add the scripts — these show up automatically as `script.clawd_feed`
etc., runnable from a dashboard or voice via Assist:

→ [`homeassistant/scripts.yaml`](homeassistant/scripts.yaml)
(merge into your existing `scripts.yaml`, don't create a second
`script:` key in `configuration.yaml`)

And if you want a ready-made dashboard card with all six buttons:

→ [`homeassistant/lovelace-card.yaml`](homeassistant/lovelace-card.yaml)

> **Gotcha that cost us a genuinely embarrassing amount of debugging:**
> `!include` paths resolve relative to whatever file contains the `!include`
> line — so `configs/rest_command.yaml` *should* just work the same way your
> other `configs/*.yaml` includes do. If it stubbornly doesn't, on some setups
> the fix really is just moving the file next to `configuration.yaml` itself.
> No, we don't fully know why either. If it works, it works.

## Known limitations

- **Not real-time.** Frames get pushed roughly every 2 seconds (plus
  immediately on button presses / actions), not 40 frames per second like the
  on-device version. The pet blinks, wobbles, and flips between two poses —
  it's *alive*, just not buttery smooth.
- **No offline pet.** If n8n or your network goes down, Clawd's last pushed
  frame just sits there frozen. Time still "passes" in n8n's model once it's
  back — there's a catch-up mechanic for that, same as the original — but the
  screen itself won't update while it's down.
- **PLAY is simplified.** No real-time star-catching minigame; it's an instant
  stat boost instead.

## Credits

All game design, sprite art, and the original brilliant idea: **Blueforcer**'s
[Clawd](https://flows.blueforcer.de/) for AWTRIX NG. This repo is *just* an
alternative runtime for the same pet — same crab, same stats, same tiny
pixelated tombstone if you forget about him for three days straight.

Built with an unreasonable amount of debugging assistance from Claude. 🤖
