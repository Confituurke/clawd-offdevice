# 🦀 Clawd — Off-Device Edition

*A tiny crab. A cry for help. A shortage of RAM.*

Clawd is a virtual pet that lives on your [AWTRIX NG](https://github.com/Blueforcer/awtrix-ng)
matrix display — hatch it from an egg, feed it, play with it, keep it clean, watch it grow through
four whole life stages, and (if you neglect it, you monster) bury it.

The original [Clawd script](https://awtrix.de/flow/wg0GspJj3sl7) by **Blueforcer** runs entirely
on the clock in [Berry](https://berry-lang.github.io/). On a plain ESP32 without PSRAM (hello,
Ulanzi TC001) it often won't fit next to your other scripts:

```
ERR:Clawd - out of memory
```

This repo gives Clawd a brain somewhere else. Pick how much of it lives on the clock:

| Mode | On the clock | Brain | Feels like the original? | Needs |
|---|---|---|---|---|
| **push** | nothing | n8n renders every frame | mostly: a frame every 2 s, no Star Catch | n8n, MQTT broker |
| **view** | the `clawd` app (drawing + buttons) | n8n | yes: 40 fps, Star Catch, proper buttons | n8n, MQTT broker |
| **device** | `clawd` app + `clawdcore` module | the clock | yes, and no n8n at all | enough free script memory |

Push mode costs the clock no script memory. View mode uses about 10% less
than the original, device mode about 30% more (details in
[awtrix/README.md](awtrix/README.md#memory)).

## What changed in 2.0

- **Sound works.** It was sent to `/api/v1/sounds/play`, which AWTRIX NG does not have; it now
  uses `/api/v1/audio/play`. Sound and notifications are opt-in, like the original.
- **Buttons only act while Clawd is on screen.** A press on the clock or any other app no longer
  opens Clawd's menu, and physical buttons never switch apps (left/right used to be yanked back
  to Clawd). Home Assistant buttons do still bring Clawd on screen.
- **Stats show up.** The payload used `"scroll": true`, which AWTRIX NG rejects.
- **One speed setting.** `HUNGER_EMPTY_HOURS` (default **18 h**, the original is ~4 h) drives
  decay, the potty timer and the offline catch-up, which now always runs slower than live play.
  Growing up still takes 12 / 36 / 72 h, each its own setting.
- **Your time zone.** Sleep and night use `TZ` (default `Europe/Brussels`, any IANA zone), not
  the n8n server's clock.
- **No lost presses.** n8n loads a workflow's saved state when a run starts and writes it back
  when it ends, so overlapping runs could undo each other. Plain ticks now only save when
  something changed, and all HTTP calls run in a background sub-workflow, so a run that owns the
  state lasts milliseconds.
- **Frozen frames are visible.** If n8n stops, AWTRIX draws a red frame around Clawd after
  90 s (`lifetimeExpiry: mark`), and the view app shows `OFF`.
- **Missing effects are back:** food, the evolve/hatch flash, the warm-egg heart, one heart per
  Star Catch hit, the drifting cloud, the bobbing "z".
- **Less traffic:** successful executions are not stored, and off screen the frame is only
  refreshed when it changes or every 30 s.
- **Tests:** engine unit tests, workflow checks, the on-device scripts in a simulated AWTRIX, and
  an integration test against a real n8n.

## Setup

### 1. AWTRIX NG

Enable MQTT (`mqttEnabled`, `mqttHost`, and a `mqttPrefix` such as `awtrixNG`). If you had the
original Clawd script installed, delete it.

### 2a. Push mode (n8n draws)

1. In n8n, import [`n8n/clawd-workflow.json`](n8n/clawd-workflow.json).
2. **AWTRIX MQTT** node: pick your MQTT credential. Its topics use `+` for the prefix; if your
   prefix contains a `/`, put the prefix there instead.
3. **Settings** node: set `AWTRIX_HOST` (the clock's IP) and `MQTT_PREFIX`, plus anything from
   the table below.
4. **Publish/activate the workflow.** Static data only persists for an active workflow, so test
   runs from the editor do not keep the pet's state.

### 2b. View mode (the clock draws, n8n thinks)

1. In n8n, import [`n8n/clawd-workflow-view.json`](n8n/clawd-workflow-view.json), set its MQTT
   credential (two nodes) and the **Settings** node, and publish it. Only one of the two
   workflows may be active: both use the webhook path `clawd-action`.
2. On the clock (web UI, Scripts): create a script named **`clawd`** and paste
   [`dist/clawd.ax`](dist/clawd.ax). Leave "Brain" on `n8n`.

### 2c. Device mode (no n8n)

1. On the clock, install [`dist/clawdcore.ax`](dist/clawdcore.ax) as a module, then
   [`dist/clawd.ax`](dist/clawd.ax) as the script **`clawd`**.
2. In the Apps tab, set Clawd's "Brain" to `device`. The module's own settings (hunger hours,
   sleep window, ...) are on its gear button in the Modules card.

### 3. Home Assistant (optional)

- **n8n brain (push or view):** add [`homeassistant/rest_command.yaml`](homeassistant/rest_command.yaml)
  (`rest_command: !include homeassistant/rest_command.yaml`, replace `<N8N_HOST>`, restart HA
  fully) and merge [`homeassistant/scripts.yaml`](homeassistant/scripts.yaml) into yours.
- **Device brain:** merge [`homeassistant/scripts-device.yaml`](homeassistant/scripts-device.yaml)
  instead; it publishes straight to MQTT.
- Either way, [`homeassistant/lovelace-card.yaml`](homeassistant/lovelace-card.yaml) gives you a
  button grid.

The webhook takes `POST /webhook/clawd-action` with `{"action":"feed"}`: `feed`, `play`,
`clean`, `med`, `sleep` (toggle), `wake`, `stats`, `reset` (only while dead).

## Settings (n8n "Settings" node)

| Setting | Default | |
|---|---|---|
| `AWTRIX_HOST` | `192.168.1.50` | the clock's IP or host name |
| `MQTT_PREFIX` | `awtrixNG` | AWTRIX NG's MQTT prefix (push mode) |
| `APP_NAME` | `clawd` | pushed app name, or the name of the view script |
| `PET_NAME` | `Clawd` | up to 12 characters |
| `TZ` | `Europe/Brussels` | any IANA zone, e.g. `America/New_York` |
| `HUNGER_EMPTY_HOURS` | `18` | awake, full to empty; `3.97` is the original speed |
| `EGG_HATCH_MIN` | `30` | |
| `CHILD_AT_HOURS` / `TEEN_AT_HOURS` / `ADULT_AT_HOURS` | `12` / `36` / `72` | |
| `SLEEP_FROM` / `SLEEP_TO` | `22` / `8` | auto-sleep, local hours |
| `NIGHT_FROM` / `NIGHT_TO` | `20` / `6` | night scenery |
| `SOUND` | `false` | effect tunes on the buzzer |
| `NOTIFY` | `false` | "Clawd needs you!", at most every 30 min |
| `SWITCH_ON_EVENTS` | `true` | bring Clawd on screen when it hatches, evolves, falls ill or dies |
| `BURST` | `true` | push mode: extra frames every 250 ms while an effect plays |
| `OFFSCREEN_REFRESH_SEC` | `30` | push mode: refresh interval while another app is shown |
| `STALE_AFTER_SEC` | `90` | push mode: red frame after this long without updates (0 = off) |
| `STATE_TOPIC` / `CMD_TOPIC` | `clawd/state` / `clawd/cmd` | view mode; must match the app's settings |

A value n8n can't use falls back to its default; the engine's output lists it under `warnings`.

## How it works

```
                     ┌──────────────────────┐   background sub-workflow
  schedule tick ────►│  Settings → Engine   ├──► PUT  /api/v1/apps/pushed/clawd   (push)
  MQTT buttons  ────►│  (rules, state in    ├──► PUT  /api/v1/apps/active         (HA, events)
  + app on screen    │   workflow static    ├──► POST /api/v1/audio/play          (SOUND)
  HA webhook    ────►│   data)              ├──► POST /api/v1/notifications       (NOTIFY)
  device commands ──►│                      ├──► MQTT clawd/state (retained)      (view)
                     └──────────────────────┘
```

[`n8n/clawd-engine.js`](n8n/clawd-engine.js) holds all the rules and is the only place to change
them; [`scripts/build.js`](scripts/build.js) pastes it into the workflows and builds `dist/`.
[`awtrix/clawd-view.ax`](awtrix/clawd-view.ax) and [`awtrix/clawdcore.ax`](awtrix/clawdcore.ax)
are the readable sources of the clock-side scripts.

## Development

```bash
npm run build   # regenerate n8n/*.json and dist/*.ax after editing a source
npm test        # engine, workflows, and (with BERRY=/path/to/berry) the Berry scripts
```

The Berry tests need a [Berry](https://github.com/berry-lang/berry) interpreter (`make` in its
repo); without one they are skipped. [`test/integration`](test/integration) runs the workflows in
a real n8n against a fake clock.

## Known limitations

- **Push mode is not real-time.** One frame every 2 s plus bursts during effects; the menu's
  progress bar jumps. View mode fixes this.
- **Push mode has no Star Catch.** PLAY there is an instant +1500 happiness.
- **Double press.** In push mode AWTRIX still toggles the display on a quick double press of
  select, because a pushed app cannot take the button. View mode takes it.
- **Overlapping runs.** The save window is now milliseconds wide, not gone: n8n has no
  per-workflow lock.
- Needs n8n (push/view) or enough free script memory (device).

## Credits

All game design, sprite art, and the original brilliant idea: **Blueforcer**'s
[Clawd](https://awtrix.de/flow/wg0GspJj3sl7) for AWTRIX NG. This repo is an alternative runtime for
the same pet — same crab, same stats, same tiny pixelated tombstone if you forget about him.

Built with an unreasonable amount of debugging assistance from Claude. 🤖
