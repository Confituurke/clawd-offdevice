# Integration tests against a real n8n

These run the generated workflows in a real n8n, with a fake AWTRIX
(`mock-awtrix.js`, logs every request) and a local MQTT broker (`broker.js`).
They are not part of `npm test` because they need n8n installed.

```bash
cd test/integration
npm install --no-save n8n aedes mqtt        # n8n needs the Node version it asks for (2.x: Node 24)
export N8N_USER_FOLDER=$PWD/tmp/n8n N8N_ENCRYPTION_KEY=test-key TZ=Europe/Brussels GENERIC_TIMEZONE=Europe/Brussels
node mock-awtrix.js & node broker.js &
node prepare.js                             # tmp/wf-push.json, tmp/wf-view.json, tmp/creds.json
npx n8n import:credentials --input=tmp/creds.json
npx n8n import:workflow --input=tmp/wf-push.json
npx n8n publish:workflow --id=clawdPushLab0001
npx n8n start &                             # wait for "Editor is now accessible"
node itest-push.js                          # prints ALL OK
```

For view mode, stop n8n, `unpublish:workflow --id=clawdPushLab0001`, import and
publish `tmp/wf-view.json` (id `clawdViewLab0001`), start n8n again and run
`node itest-view.js`. Only one of the two may be published at a time: both use
the webhook path `clawd-action`.
