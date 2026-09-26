// Make lab copies of the workflows: local fake AWTRIX, lab MQTT credential, fixed ids.
const fs = require('fs');
const path = require('path');
const repo = path.join(__dirname, '..', '..');
const out = (f) => path.join(__dirname, 'tmp', f);
fs.mkdirSync(path.join(__dirname, 'tmp'), { recursive: true });
function prep(file, id, overrides) {
  const wf = JSON.parse(fs.readFileSync(`${repo}/${file}`, 'utf8'));
  wf.id = id;
  for (const n of wf.nodes) {
    if (n.credentials && n.credentials.mqtt) n.credentials.mqtt = { id: 'mqttLabCred00001', name: 'AWTRIX broker' };
    if (n.name === 'Settings') {
      for (const a of n.parameters.assignments.assignments) {
        const k = a.name.replace('cfg.', '');
        if (k in overrides) a.value = overrides[k];
      }
    }
  }
  return wf;
}
fs.writeFileSync(out('wf-push.json'), JSON.stringify(prep('n8n/clawd-workflow.json', 'clawdPushLab0001', { AWTRIX_HOST: '127.0.0.1:8099', SOUND: true, NOTIFY: true })));
fs.writeFileSync(out('wf-view.json'), JSON.stringify(prep('n8n/clawd-workflow-view.json', 'clawdViewLab0001', { AWTRIX_HOST: '127.0.0.1:8099' })));
fs.writeFileSync(out('creds.json'), JSON.stringify([{ id: 'mqttLabCred00001', name: 'AWTRIX broker', type: 'mqtt',
  data: { protocol: 'mqtt', host: '127.0.0.1', port: 1883, username: '', password: '', clean: true, clientId: '', ssl: false } }]));
console.log('prepared');
