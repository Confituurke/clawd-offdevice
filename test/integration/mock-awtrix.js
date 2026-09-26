// Fake AWTRIX NG: logs every request as one JSON line, answers {"ok":true}.
const http = require('http');
const fs = require('fs');
const log = process.argv[2] || require('path').join(__dirname, 'tmp', 'awtrix.log');
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    fs.appendFileSync(log, JSON.stringify({ t: Date.now(), m: req.method, u: req.url, ct: req.headers['content-type'], b: body }) + '\n');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
}).listen(8099, '127.0.0.1', () => console.log('mock awtrix on 8099'));
