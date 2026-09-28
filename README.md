# 🦀 Clawd — Off-Device Edition

*A tiny crab. A cry for help. A shortage of RAM.*

Clawd is a virtual pet for your [AWTRIX NG](https://github.com/Blueforcer/awtrix-ng) clock: hatch
it from an egg, feed it, play with it, keep it clean, watch it grow through four life stages, and
(if you neglect it, you monster) bury it.

The pet is **Blueforcer**'s original [Clawd](https://awtrix.de/flow/wg0GspJj3sl7), which runs
entirely on the clock. On a clock without extra memory (hello, Ulanzi TC001) it often won't fit
next to your other apps (`ERR:Clawd - out of memory`), so **Moepchi** moved its brain off the
clock into [n8n](https://n8n.io). This version builds on both: the same pet, and you choose how
much of it runs on the clock.

## Pick a mode

| Mode | What runs where | You need | Good to know |
|---|---|---|---|
| **View** ⭐ | the clock draws Clawd, n8n runs the rules | n8n + an MQTT broker | the best experience: smooth animation and the Star Catch mini-game. Uses some memory on the clock |
| **Push** | n8n draws everything and sends pictures to the clock | n8n + an MQTT broker | nothing installed on the clock, so it always fits. Updates every 2 s, no mini-game |
| **Device** | everything on the clock | nothing else | no n8n, no Home Assistant. Needs the most memory on the clock |

Not sure? Try **view mode**. If the clock says "out of memory", use **push mode**.

Home Assistant is optional in every mode.

## Install

### 1. Prepare the clock (all modes)

- Update to the latest AWTRIX NG.
- If you had the original Clawd installed, delete it (web UI → Apps).
- **View and push mode:** turn on MQTT in the clock's settings (broker address, user, password)
  and note the **prefix** (for example `awtrixNG`).

### 2. Install your mode

**View mode**

1. In n8n: **Create credential → MQTT**, and enter your broker's address, user and password.
2. In n8n: **Import from file** → [`n8n/clawd-workflow-view.json`](n8n/clawd-workflow-view.json).
3. Open every MQTT node (they have a warning triangle) and pick your MQTT credential.
4. Open the **Settings** node and set `AWTRIX_HOST` to your clock's IP address.
5. **Publish** (activate) the workflow.
6. On the clock's web UI: **Scripts → New script**, name it **`clawd`**, paste the contents of
   [`dist/clawd.ax`](dist/clawd.ax) and save.

**Push mode**

1. In n8n: **Create credential → MQTT**, and enter your broker's address, user and password.
2. In n8n: **Import from file** → [`n8n/clawd-workflow.json`](n8n/clawd-workflow.json).
3. Open every MQTT node and pick your MQTT credential.
4. Open the **Settings** node: set `AWTRIX_HOST` to your clock's IP address and `MQTT_PREFIX` to
   your clock's MQTT prefix.
5. **Publish** (activate) the workflow. Clawd shows up as an app within a few seconds.

**Device mode**

1. On the clock's web UI, add [`dist/clawdcore.ax`](dist/clawdcore.ax) as a **module**.
2. Add [`dist/clawd.ax`](dist/clawd.ax) as a **script** named **`clawd`**.
3. Apps → Clawd → gear button: set **Brain** to `device`.

Only run one mode at a time. Settings in n8n only stick once the workflow is published: test runs
from the editor don't keep the pet.

## Play

When Clawd is on screen:

- **Egg:** it hatches after 30 minutes; every press of **select** warms it and brings that a
  minute closer.
- **Menu:** press **select** to open it, press again to go to the next item, and wait 2 seconds to
  do it: feed, play, clean, medicine, sleep/wake, stats. Keep the bars at the right full.
- **Play** (view and device mode): a star bounces across the top; press **select** when it's
  right above Clawd. Three tries.
- **Left / right** change apps as usual. Buttons never do anything to Clawd while another app is
  on screen.
- **Dead:** press **select**, press it again for "NEW EGG?", and wait 3 seconds.

Clawd sleeps from 22:00 to 08:00, grows up after 12, 36 and 72 hours, and needs about four meals
a day.

## Home Assistant (optional, view and push mode)

1. **Add the Clawd device.** In Home Assistant: **Developer tools → Actions**, pick
   **MQTT: Publish** and fill in:
   - **Topic:** `homeassistant/device/clawd/config`
   - **Payload:** the whole contents of
     [`homeassistant/clawd-discovery.json`](homeassistant/clawd-discovery.json)
   - **Retain:** on

   Press **Perform action**. A **Clawd** device appears (Settings → Devices) with its stats,
   buttons (feed, play, clean...) and settings.
2. **Add the dashboard.** **Settings → Dashboards → Add dashboard → New dashboard from scratch**,
   open it, **pencil → ⋮ → Raw configuration editor**, and replace everything with
   [`homeassistant/dashboard.yaml`](homeassistant/dashboard.yaml).
3. **Optional, see the pet:** turn on **Screen mirror** in the dashboard's settings. In view
   mode, also import [`n8n/clawd-workflow-mirror.json`](n8n/clawd-workflow-mirror.json) and fill
   in its MQTT credential and Settings like before.

## Settings

Change them in n8n's **Settings** node, or while Clawd runs from the dashboard's **Settings**
section: name, sound, notifications, how fast Clawd gets hungry, growing-up ages, sleep and night
hours, time zone. The time zone is n8n's own unless you set one. In view mode, Clawd's name and
sound can also be changed on the clock (Apps → Clawd → gear button).

All settings, and how to change them over MQTT: [docs/REFERENCE.md](docs/REFERENCE.md).

## Troubleshooting

- **Nothing happens:** is the workflow published? Are the MQTT credential and `AWTRIX_HOST`
  right? In n8n, the workflow's **Executions** show errors.
- **Buttons don't work (push mode):** `MQTT_PREFIX` must match the clock's MQTT prefix.
- **"out of memory" when saving the script:** restart the clock and save it again right away. If
  it still fails, use push mode.
- **`OFF` on the clock (view mode) or a red frame (push mode):** n8n hasn't sent anything for a
  while. Check that n8n is running and the workflow is published.

## More

- [docs/REFERENCE.md](docs/REFERENCE.md): every setting, live settings over MQTT, other Home
  Assistant options, the screen mirror, how it works, what differs from the original, development.
- [awtrix/README.md](awtrix/README.md): the clock app, its settings and memory use.

## Credits

The pet — game design, sprite art and the brilliant idea — is **Blueforcer**'s
[Clawd](https://awtrix.de/flow/wg0GspJj3sl7) for AWTRIX NG. **Moepchi** trimmed it down and moved
it off the device into n8n ([clawd-offdevice](https://github.com/Moepchi/clawd-offdevice)). This
version combines the two into a hybrid: the same crab, the same stats, the same tiny pixelated
tombstone if you forget about him, now in whichever mode fits your clock.

Built with an unreasonable amount of debugging assistance from Claude. 🤖
