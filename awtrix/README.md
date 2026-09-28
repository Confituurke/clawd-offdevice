# On-device scripts

| File | What it is | Install as |
|---|---|---|
| `clawd-view.ax` | The Clawd app: draws the pet at 40 fps, handles the buttons, runs the menu and Star Catch | script named **`clawd`** |
| `clawdcore.ax` | Optional module with the pet's rules, for running without n8n | module (its name comes from its header) |

Install the files from [`dist/`](../dist), not these: `dist/` holds the same
code without comments and indentation (`npm run build`). AWTRIX needs free
memory of roughly the source size to compile a script, so every byte counts.

The app must be installed as `clawd` (or whatever `APP_NAME` says in n8n),
because that is the app n8n switches to.

## Settings

Clawd app (Apps tab, gear button):

| Setting | Default | |
|---|---|---|
| Brain | `n8n` | `n8n`: the rules run in n8n's view-mode workflow. `device`: the rules run on the clock in `clawdcore` |
| Pet name | Clawd | shown in STATS. n8n brain: kept in step with n8n's `PET_NAME`, both ways |
| Sound | off | effect tunes on the buzzer. n8n brain: kept in step with n8n's `SOUND`, both ways |
| State topic | `clawd/state` | n8n brain: where n8n publishes the state |
| Command topic | `clawd/cmd` | n8n brain: where button actions go (Home Assistant uses n8n's `HA_TOPIC`, `clawd/ha`, instead). Device brain: where Home Assistant sends commands |

With the n8n brain the app reports its sound and name as `{"a":"cfg","sound":false,"name":"Clawd"}`
on the command topic when the first state line arrives after it starts (saving a setting
restarts it) and when n8n comes back after 10 minutes of silence; n8n takes a change made here
and sends its own changes back through the app's settings.

`clawdcore` module (Modules card, gear button): **Difficulty** (easy, normal,
hard - the same presets as in n8n, see [docs/REFERENCE.md](../docs/REFERENCE.md#difficulty)),
or `custom` to use its own values: hours until hungry (12), egg hatch minutes
(30), child/teen/adult/elder ages (12/36/72/168 h), elder lifespan (96 h),
legend after (48 h), sickness chance (2%), care for a happy/grumpy adult
(200/-100). Also the sleep window (22-8), night window (20-6) and
notifications (off). The clock's own time zone applies.

## How the pieces talk

With the n8n brain, n8n publishes one retained CSV line to the state topic
whenever something visible changes, and at least once a minute:

| # | Field | | # | Field |
|---|---|---|---|---|
| 0 | protocol version (2) | | 11 | asleep (0/1) |
| 1 | stage: 0 egg, 1 alive, 2 dead | | 12 | night scenery (0/1) |
| 2 | evolution: 0 egg, 1 baby, 2 child, 3 teen, 4 adult, 5 elder, 6 legend | | 13 | generation |
| 3 | adult (and elder) look: 0 happy, 1 normal, 2 grumpy | | 14 | care score |
| 4-7 | hunger, happiness, energy, cleanliness (0-10000) | | 15 | age in seconds |
| 8 | health (0-10000) | | 16 | last effect id (1 feed ... 9 death, 10 show stats, 11 passed away of old age) |
| 9 | poops (0-3) | | 17 | effect counter (changes = play the effect) |
| 10 | sick (0/1) | | 18 | Star Catch hits of the last PLAY |
| | | | 19 | n8n's clock (epoch seconds) |
| | | | 20, 21 | egg warmth and hatch time (seconds) |
| | | | 22 | passed away of old age (0/1); newer than the rest - an app reading 22 fields treats it as 0 |

The app sends actions to the command topic as `{"a":"feed"}`: `feed`, `play`
(with `"hits":0-3` after Star Catch), `clean`, `med`, `sleep`, `wake`, `warm`
(egg), `newegg` (after death). n8n answers with a new state line.

With the device brain the app calls `clawdcore` directly and nothing goes over
MQTT, except commands from Home Assistant: a plain word (`feed`) or
`{"a":"feed"}` on the command topic. Those also bring Clawd on screen.

## Buttons

While Clawd is on screen the app takes the select button, so a quick double
press moves through the menu instead of switching the display off, and select
no longer dismisses notifications there. Left and right close any open menu
and still change apps. On any other app, Clawd ignores the buttons.

## Memory

Heap once running, measured in the desktop test harness. That is 64-bit
Berry, where values are about twice their ESP32 size, so compare the rows
with each other rather than with the 96 KB budget:

| Setup | Heap (desktop) | vs. original |
|---|---|---|
| Original Clawd v1.1 | ~35.0 KB | - |
| `clawd` view, n8n brain | ~31.6 KB | about 10% less |
| `clawd` view + `clawdcore`, device brain | ~45.4 KB | about 30% more |
| push mode (no script) | 0 | nothing on the clock |

Compiling costs extra on top, only during install: roughly 8 KB plus the
source size must be free, with the source size in one piece.
`dist/clawd.ax` is about 11 KB (the original is 11.4 KB) and
`dist/clawdcore.ax` about 6 KB, compiled separately. If an install is refused,
reboot the clock (it defragments the heap) and install Clawd first. The device
brain suits an ESP32-S3 with PSRAM, or a TC001 with few other scripts.
