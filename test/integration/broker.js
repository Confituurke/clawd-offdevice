// Local MQTT broker for the integration tests (npm i aedes).
const aedes = require('aedes')();
const server = require('net').createServer(aedes.handle);
server.listen(1883, '127.0.0.1', () => console.log('broker on 1883'));
aedes.on('publish', (p, c) => { if (c && !p.topic.startsWith('$SYS')) require('fs').appendFileSync(require('path').join(__dirname, 'tmp', 'mqtt.log'), JSON.stringify({ t: Date.now(), topic: p.topic, msg: p.payload.toString(), retain: p.retain }) + '\n'); });
