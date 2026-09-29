# Installing and running Clawd - every way

The [README](../README.md) has the quick path. This page has all of it: every mode, every way to
install it, the optional parts, upgrading without losing your pet, and switching modes.

- [What each mode needs](#what-each-mode-needs)
- [1. The clock](#1-the-clock)
- [2. n8n (view and push mode)](#2-n8n-view-and-push-mode)
- [3. View mode](#3-view-mode)
- [4. Push mode](#4-push-mode)
- [5. Device mode](#5-device-mode)
- [6. Home Assistant](#6-home-assistant)
- [7. Seeing the pet in Home Assistant](#7-seeing-the-pet-in-home-assistant)
- [8. Changing settings](#8-changing-settings)
- [9. Without Home Assistant, without MQTT, without n8n](#9-without-home-assistant-without-mqtt-without-n8n)
- [10. Upgrading without losing your pet](#10-upgrading-without-losing-your-pet)
- [11. Switching modes](#11-switching-modes)
- [12. Clocks short on memory](#12-clocks-short-on-memory)
- [13. Removing Clawd](#13-removing-clawd)

## What each mode needs

| | View ⭐ | Push | Device |
|---|---|---|---|
| Where the rules run | n8n | n8n | the clock (`clawdcore` module) |
| Who draws Clawd | the clock (`clawd` app) | n8n, sent as pictures | the clock (`clawd` app) |
| On the clock | the `clawd` app (~12.5 KB) | nothing | the `clawd` app + the `clawdcore` module |
| n8n | ✅ [`clawd-workflow-view.json`](../n8n/clawd-workflow-view.json) | ✅ [`clawd-workflow.json`](../n8n/clawd-workflow.json) | - |
| MQTT broker | ✅ | ✅ (buttons, Home Assistant) | only for Home Assistant |
| Home Assistant | optional | optional | optional (buttons only) |
| Star Catch, smooth animation | ✅ | - (updates every 2 s) | ✅ |
| Clock memory used | medium | none | most |

Run one mode at a time: each keeps its own pet.

## 1. The clock

1. Update to the latest [AWTRIX NG](https://github.com/Blueforcer/awtrix-ng).
2. If the original Clawd is installed, delete it (web UI → Apps). Its pet can't be carried over
   to n8n, only to device mode (below).
3. View and push mode: in the clock's settings turn MQTT on (broker address, port, user,
   password) and note the **prefix**, for example `awtrixNG`.

## 2. n8n (view and push mode)

**MQTT credential:** in n8n, **Credentials → Create → MQTT**: your broker's address, port, user
and password. The workflows use it to listen to the clock and to talk to Home Assistant.

**Import the workflow - in the n8n editor:** **Workflows → ⋮ → Import from file**, pick the file
for your mode. Then open every node with a warning triangle (the MQTT ones) and choose your MQTT
credential, fill in the **Settings** node (below), and **Publish** (activate) it. The pet only
keeps its state in a published workflow: test runs from the editor start from scratch.

**Import the workflow - with the n8n API** (n8n → Settings → n8n API → create an API key):

```bash
# create it (the file's credential ids are placeholders: fix them in the editor afterwards)
curl -X POST "$N8N/api/v1/workflows" -H "X-N8N-API-KEY: $KEY" -H "Content-Type: application/json" \
  --data @<(jq '{name, nodes, connections, settings}' n8n/clawd-workflow-view.json)
# after choosing the credential and filling in Settings: publish it
curl -X POST "$N8N/api/v1/workflows/<id>/activate" -H "X-N8N-API-KEY: $KEY"
```

**Settings node:** `AWTRIX_HOST` (the clock's IP) always; `MQTT_PREFIX` for push mode (your
clock's prefix). Everything else has a default; the full list is in
[REFERENCE.md](REFERENCE.md#settings). `TZ` empty means n8n's own time zone (n8n → Settings →
Timezone), so set that right once.

## 3. View mode

1. Import [`n8n/clawd-workflow-view.json`](../n8n/clawd-workflow-view.json) as above, set
   `AWTRIX_HOST`, publish.
2. Install the Clawd app on the clock, as a **script named `clawd`**:
   - **Web UI:** Scripts → New script → name `clawd` → paste [`dist/clawd.ax`](../dist/clawd.ax)
     → Save.
   - **HTTP:** `curl -X PUT "http://<clock>/api/v1/apps/script/clawd" -H "Content-Type: text/plain" --data-binary @dist/clawd.ax`
3. Leave the app's **Brain** setting on `n8n`. Its State and Command topics must match the Settings
   node's `STATE_TOPIC` and `CMD_TOPIC` (the defaults do).

Within a minute the pet appears; the first egg hatches after the difficulty's egg time. If the clock
answers "out of memory" or "heap too fragmented", see [Clocks short on memory](#12-clocks-short-on-memory).

## 4. Push mode

1. Import [`n8n/clawd-workflow.json`](../n8n/clawd-workflow.json), set `AWTRIX_HOST` and
   `MQTT_PREFIX`, publish. Nothing is installed on the clock: Clawd appears as an app on its own.
2. The MQTT trigger listens to `+/state/buttons/+` and `+/state/apps/active` (`+` is any prefix;
   if your prefix contains a `/`, put it there instead).

Push mode has no Star Catch (PLAY is an instant +1500 happiness) and AWTRIX still toggles the
display on a quick double press of select, because a pushed app can't take the button.

## 5. Device mode

No n8n: the rules run on the clock.

1. Install [`dist/clawdcore.ax`](../dist/clawdcore.ax) as a **module** (web UI → Modules → New, or
   `PUT /api/v1/apps/script/clawdcore` like above).
2. Install [`dist/clawd.ax`](../dist/clawd.ax) as the script **`clawd`** (as in view mode).
3. Apps → Clawd → gear: set **Brain** to `device`. The rules' settings, including the
   **Difficulty** (`icanwin`, `easy`, `medium`, `hard`, `nightmare`, or `custom` to use the
   module's own values), are on the module's gear in the Modules card.

A pet from the original Clawd v1.1 carries over into device mode. Device mode needs the most
memory on the clock; there is no n8n to send Home Assistant the pet's state or settings.

## 6. Home Assistant

Optional, for view and push mode. Needs HA's MQTT integration connected to the same broker.

1. **The Clawd device:** publish [`homeassistant/clawd-discovery.json`](../homeassistant/clawd-discovery.json),
   retained, to `homeassistant/device/clawd/config`:
   - **In Home Assistant:** Developer tools → Actions → **MQTT: Publish**: topic
     `homeassistant/device/clawd/config`, payload = the whole file, **Retain** on.
   - **From a terminal:** `mosquitto_pub -h <broker> -u <user> -P <password> -r -t homeassistant/device/clawd/config -f homeassistant/clawd-discovery.json`

   It creates a **Clawd** device: stage, next stage and when, food, happiness, energy, hygiene,
   health, poop, age, care, generation, asleep, sick; buttons for every action; the screen camera;
   and a control for every setting. The buttons publish to `clawd/ha`: n8n does the action and
   brings Clawd on screen.
2. **The dashboard:** Settings → Dashboards → Add dashboard → New dashboard from scratch → open it
   → pencil → ⋮ → Raw configuration editor → paste [`homeassistant/dashboard.yaml`](../homeassistant/dashboard.yaml).
   Two pages: **Clawd** (the pet, its stats, care buttons) and **Settings** (*Settings* and
   *Advanced Settings*).
3. To remove the device, publish an empty retained message to the same topic.

Other ways to connect Home Assistant:

- **Webhook** (push or view): `POST <n8n>/webhook/clawd-action` with `{"action":"feed"}` (`feed`,
  `play`, `clean`, `med`, `sleep`, `wake`, `stats`, `reset`) or `{"config":{...}}`.
  [`rest_command.yaml`](../homeassistant/rest_command.yaml) + [`scripts.yaml`](../homeassistant/scripts.yaml)
  wire it up (needs an HA restart), [`lovelace-card.yaml`](../homeassistant/lovelace-card.yaml) is
  a button grid for them.
- **Plain MQTT:** publish an action word (`feed`) or `{"a":"feed"}` to `clawd/ha`, settings JSON
  to `clawd/config/set`; read `clawd/state` (retained, [fields](../awtrix/README.md#how-the-pieces-talk))
  and `clawd/config` (retained JSON).
- **Device mode:** [`scripts-device.yaml`](../homeassistant/scripts-device.yaml) publishes actions
  to the clock app's command topic. No sensors (there is no n8n to publish the state).

## 7. Seeing the pet in Home Assistant

The **Screen** camera shows the clock while **Screen mirror** is on (Settings page, or `MIRROR`).

- **Push mode:** nothing else to install; every frame n8n sends is also published as a PNG.
- **View mode:** also import [`n8n/clawd-workflow-mirror.json`](../n8n/clawd-workflow-mirror.json),
  give it the MQTT credential and the same `AWTRIX_HOST`, `MQTT_PREFIX` and `APP_NAME`, publish.
  While Clawd is on screen it reads the clock's screen every 10 s. Each read is a request the clock
  has to answer: on a clock short on memory, leave the mirror off.

## 8. Changing settings

The Settings node gives the defaults. While Clawd runs you can change them from:

- **Home Assistant:** the Settings page of the dashboard.
- **MQTT:** JSON to `clawd/config/set`, e.g. `{"DIFFICULTY":"Hard"}` or `{"SOUND":true}`;
  `{"SOUND":null}` goes back to the Settings node, `{"reset":true}` for all of them.
- **The webhook:** `{"config":{...}}`.
- **The clock** (view mode): the Clawd app's *Sound* and *Pet name* in its web UI. n8n takes the
  change (saving there restarts the app for a moment).

The settings in use are published, retained, on `clawd/config`. Details and every setting:
[REFERENCE.md](REFERENCE.md#changing-settings-while-it-runs).

## 9. Without Home Assistant, without MQTT, without n8n

| | View | Push | Device |
|---|---|---|---|
| Without Home Assistant | ✅ | ✅ | ✅ |
| Without MQTT | ❌ the app and n8n talk over MQTT | ⚠️ works through the webhook only; the clock's buttons don't (n8n hears them over MQTT), and you remove the MQTT nodes yourself | ✅ |
| Without n8n | ❌ | ❌ | ✅ |

## 10. Upgrading without losing your pet

The pet lives in the n8n workflow's static data (or, in device mode, in the clock app's store).

- **n8n - keep the workflow, replace its code:** importing a new workflow file makes a new
  workflow and a new egg. To keep the pet, update the existing workflow instead: with the n8n API,
  deactivate it, `GET` it, swap in the new file's `nodes` and `connections` (keeping your
  credential and Settings values and its `staticData`), `PUT` it back (without `settings.binaryMode`,
  which n8n returns but refuses), activate. The engine upgrades older saved pets by itself.
- **The clock app:** install the new [`dist/clawd.ax`](../dist/clawd.ax) over the old one (same
  name `clawd`); its settings stay. See the next section if the clock is short on memory.
- **Home Assistant:** publish the new `clawd-discovery.json` again; entities keep their ids.

## 11. Switching modes

- **View ⇄ push:** different workflows, so each has its own pet. To move a pet, copy the source
  workflow's static data (`clawd`, `dev`, `cfg`) into the other one with the API (deactivate both
  first), then activate only the new one. Push needs no clock app; view needs the Clawd app.
- **To device mode:** the pet can't be carried over from n8n; device mode starts from its own
  store (or from an original Clawd v1.1 pet).

## 12. Clocks short on memory

A plain ESP32 clock (no PSRAM, e.g. the Ulanzi TC001) with several scripts runs close to its
limit. What helps:

- **Install right after a reboot:** reboot the clock and save the script the moment its web UI
  answers - before other scripts start their HTTPS fetches. A refusal ("heap too fragmented to
  compile") means the clock's largest free block was smaller than the script.
- **Then reboot once more:** a script installed while the clock runs may run out of memory later;
  compiled at boot it starts with the most room.
- **Settings:** saving an app's settings restarts it. On a tight clock, reboot afterwards. n8n never
  changes the Clawd app's own settings for this reason: it sends sound and name in the state line.
- **Watch it:** the clock publishes free memory on `<prefix>/state/device` every 10 s
  (`freeHeapBytes`, `minFreeHeapBytes`, `largestFreeBlockBytes`).
- **If it stays tight:** leave the screen mirror off, move weather/crypto-style fetches off the
  clock, or use push mode (nothing on the clock).

## 13. Removing Clawd

Delete the `clawd` script (and `clawdcore` module) on the clock, the workflow(s) in n8n, and
publish an empty retained message to `homeassistant/device/clawd/config` for Home Assistant.
