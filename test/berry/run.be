# Runs the on-device Clawd scripts in the mock runtime. test/berry.test.js
# joins awtrix_mock.be and this file into one program and runs it as
#   berry all.be <repo root> <dir with clawdcore.be> <state lines file>
import sys

var root = _argv[1]
sys.path().push(_argv[2])
var lines = string.split(read_file(_argv[3]), "\n")   # state lines made by the JS engine
def sline(tag)
  for l : lines
    var p = string.split(l, "=")
    if p[0] == tag return p[1] end
  end
  raise "value_error", "no state line " + tag
end
var VIEW = _argv[4]                                   # awtrix/clawd-view.ax or dist/clawd.ax

def last_pub()
  return size(mqtt.pub) > 0 ? mqtt.pub[-1][1] : nil
end
def press(app)
  return app.on_button_event("select", "press")
end
def frame(app, ms)
  advance(ms)
  app.draw()
end

# ---- n8n brain --------------------------------------------------------------------
print("view script, n8n brain")
reset_services()
var app = load_app(VIEW, nil)
app.setup()
check(mqtt.subs.find("clawd/state") != nil, "subscribes to the state topic")
app.draw()
check(size(texts) == 1 && texts[0][2] == "CLAWD", "placeholder before the first state")
check(press(app) == true, "select is captured even before data")

mqtt.deliver("clawd/state", sline("alive"))
check(app.s != nil && app.s[1] == 1, "state parsed")
frame(app, 20)
check(lit() > 20, "scene drawn")
check(px(18, 0) != 0 && px(18, 2) != 0 && px(18, 4) != 0 && px(18, 6) != 0, "four stat bars")
check(app.on_button_event("select", "release") == true, "later events ignored quietly")

# menu: open, move to FEED, wait 2 s
check(press(app) == true && app.u == 1 && rotation.paused, "menu opens and pauses the rotation")
frame(app, 300)
rotation.paused = false                            # AWTRIX clears a pause on every press
press(app)
check(app.m == 1 && rotation.paused, "menu moved to FEED and the rotation is paused again")
frame(app, 1000)
check(px(10, 7) == 0xD97757 && px(20, 7) == 0x1A1A1A, "progress bar half full after 1 s")
frame(app, 1100)
check(last_pub() == '{"a":"feed"}', "FEED published: " + str(last_pub()))
check(app.u == 0 && !rotation.paused, "menu closed, rotation resumed")

# left/right close the menu and keep their job
press(app)
check(app.on_button_event("right", "press") == false && app.u == 0, "right closes the menu and is not captured")

# a new effect arrives: food on screen, sound only when enabled
mqtt.deliver("clawd/state", sline("fed"))
check(app.fk == 1, "feed effect started")
frame(app, 100)
check(size(sound.played) == 0, "sound off by default")

# STATS scrolls once, then returns
press(app)
for i : 1 .. 6 press(app) end
check(app.m == 6, "menu at STATS")
frame(app, 2100)
check(app.u == 3 && string.find(app.b, "Clawd  AGE") == 0, "stats text: " + str(app.b))
frame(app, 20)
scroll_runs = 1
frame(app, 20)
check(app.u == 0, "stats close after one run")
scroll_runs = 0

# PLAY: Star Catch, three rounds, hits sent to n8n
press(app)
press(app)
press(app)
check(app.m == 2, "menu at PLAY")
frame(app, 2100)
check(app.u == 2, "Star Catch started")
var hits = 0
while app.u == 2
  # wait until the star is over the crab (x 3..8), then press
  var p = 1500 - app.ga * 250
  var cy = (now_ms() - app.gt) % (2 * p)
  var x = (cy < p ? cy * 28 / p : (2 * p - cy) * 28 / p) + 2
  if app.gp == 0 && x >= 4 && x <= 7
    press(app)
    hits += 1
  end
  frame(app, 25)
end
check(last_pub() == '{"a":"play","hits":3}', "PLAY result published: " + str(last_pub()))

# refused PLAY while asleep shows the X locally and sends nothing
mqtt.deliver("clawd/state", sline("asleep"))
var n = size(mqtt.pub)
press(app)
press(app)
press(app)
frame(app, 2100)
check(app.fk == 6 && size(mqtt.pub) == n, "PLAY refused while asleep")
frame(app, 20)
check(size(texts) > 0 && texts[0][2] == "z", "sleeping z")

# egg: select warms it
mqtt.deliver("clawd/state", sline("egg"))
press(app)
check(last_pub() == '{"a":"warm"}', "egg warmed")

# dead: NEW EGG needs two presses and a 3 s hold
mqtt.deliver("clawd/state", sline("dead"))
frame(app, 20)
press(app)
check(app.u == 5, "NEW EGG? shown")
press(app)
frame(app, 1500)
check(last_pub() != '{"a":"newegg"}', "not yet")
frame(app, 1600)
check(last_pub() == '{"a":"newegg"}', "new egg requested")

# silence from n8n for 10 minutes
mqtt.deliver("clawd/state", sline("alive"))
frame(app, 601000)
var off = false
for t : texts if t[2] == "OFF" off = true end end
check(off, "shows OFF when n8n has gone quiet")

# on_hide closes whatever was open
press(app)
app.on_hide()
check(app.u == 0 && !rotation.paused, "on_hide closes the menu")

# sound setting on
reset_services()
app = load_app(VIEW, {"sound": true})
app.setup()
mqtt.deliver("clawd/state", sline("alive"))
mqtt.deliver("clawd/state", sline("fed"))
check(size(sound.played) == 1 && string.find(sound.played[0], "m:") == 0, "feed tune played")
mqtt.deliver("clawd/state", sline("sick"))
check(size(sound.played) == 2, "sick tune played")
var sc = string.split(sline("alive"), ",")
sc[16] = "8"
sc[17] = "90"
sc[18] = "0"
mqtt.deliver("clawd/state", sc.concat(","))
check(sound.played[-1] == "x:d=16,o=4,b=200:c", "no hits: the fail tune")
sc[16] = "10"
sc[17] = "91"
mqtt.deliver("clawd/state", sc.concat(","))
check(app.u == 3, "n8n can open the stats (HA stats in view mode)")
app.on_hide()
reset_services()
app = load_app(VIEW, {"sound": true})
app.setup()
mqtt.deliver("clawd/state", sline("sick"))
check(size(sound.played) == 0, "an already sick pet does not alarm on restart")

# every sprite stage draws without error
for tag : ["egg", "baby", "child", "teen", "adult0", "adult1", "adult2", "dead", "asleep", "sick"]
  mqtt.deliver("clawd/state", sline(tag))
  frame(app, 37)
  check(lit() > 10, "draws " + tag)
end

# ---- device brain ------------------------------------------------------------------
print("view script + clawdcore, device brain")
reset_services()
_hour = 10
load_config(read_file(_argv[2] + "/clawdcore.be"))   # module settings, read at import
app = load_app(VIEW, {"brain": "device"})
app.setup()
check(app.core != nil, "core module loaded")
check(app.s[1] == 0, "starts as an egg")
frame(app, 20)
check(lit() > 10 && px(0, 7) != 0, "egg and hatch progress drawn")
var core = app.core
check(core.st == 12 * 2520, "12 h -> 30240 ms per step")

# hatch: 30 min of loop()
for i : 1 .. 1800 advance(1000) app.loop() end
check(app.s[1] == 1 && app.s[2] == 1, "hatched after 30 min")
check(rotation.shown >= 1, "hatching brings Clawd on screen")

# one hour awake: 119 decay steps, hunger -833
var h0 = app.s[4]
for i : 1 .. 3600 advance(1000) app.loop() end
check(h0 - app.s[4] == 119 * 7, "hunger after 1 h: " + str(h0 - app.s[4]))

# feed through the menu
press(app)
press(app)
frame(app, 2100)
check(app.s[4] == 10000 || app.s[4] > h0, "fed")
check(app.fk == 1, "feed effect")
check(core.t["t"] > 0, "potty timer running")
check(size(mqtt.pub) == 0, "nothing published in device mode")

# Home Assistant command over MQTT
var shown = rotation.shown
mqtt.deliver("clawd/cmd", '{"a":"clean"}')
check(app.fk == 2 && rotation.shown == shown + 1, "HA clean applied and shown")
mqtt.deliver("clawd/cmd", "stats")
check(app.u == 3, "HA stats opens the stats text")
app.on_hide()
shown = rotation.shown
mqtt.deliver("clawd/cmd", '{"a": "med"}')
check(app.fk == 6 && rotation.shown == shown + 1, "HA JSON with a space after the colon")
mqtt.deliver("clawd/cmd", "hello world")
check(rotation.shown == shown + 1, "unknown commands do nothing")
mqtt.deliver("clawd/cmd", "SLEEP")
check(app.s[11] == 1, "plain-word command, any case")

# auto-sleep follows the clock's hour
core.act("wake", nil)
_hour = 23
advance(1000) app.loop()
check(app.s[11] == 1, "asleep at 23:00")

# state survives a restart, with catch-up at 30% speed
_hour = 10
core.save()
var saved = store.get("clawd")
var hs = saved["h"]
advance(3 * 3600 * 1000)
reset_services()
store.set("clawd", saved)
app = load_app(VIEW, {"brain": "device"})
app.setup()
advance(1000)
app.loop()
var drop = hs - app.s[4]
check(drop > 0 && drop < 79 * 7 * 3, "3 h catch-up drop " + str(drop) + " below live " + str(79 * 7 * 3))

# a pet saved by the original Clawd v1.1 (store key "s") carries over
reset_services()
store.set("s", {"s":1,"v":3,"u":1,"h":5000,"a":5000,"e":5000,"c":5000,"x":9000,"n":4,"g":150000,"z":42})
app = load_app(VIEW, {"brain": "device"})
app.setup()
check(app.s[2] == 3 && app.s[13] == 4 && app.s[14] == 42, "original pet migrated")
core = app.core

# death and a new egg
core.t["x"] = 1
core.t["h"] = 0
for i : 1 .. 50 advance(1000) app.loop() end
check(app.s[1] == 2, "died")
press(app)
press(app)
frame(app, 3100)
check(app.s[1] == 0 && app.s[13] == 5, "next generation egg")

if failures == 0
  print("ALL OK")
else
  print(str(failures) + " FAILED")
end
