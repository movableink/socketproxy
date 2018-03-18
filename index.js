const express = require('express');
const http = require('http');
const url = require('url');
const WebSocket = require('ws');
const crypto = require('crypto');

const app = express();

function randomId(length=10) {
  return 'a' + crypto.randomBytes(Math.ceil(length / 2))
    .toString('hex')
    .slice(0, length);
}

const reqKeys = ['headers', 'rawHeaders', 'readable', 'domain', 'trailers', 'rawTrailers', 'url', 'method', 'upgrade', 'baseUrl', 'originalUrl', 'params', 'query'];

app.use(function (req, res) {
  const connId = url.parse(req.url).path.slice(1);
  const id = randomId(50);

  const reqObject = {};
  reqKeys.forEach((key) => {
    reqObject[key] = req[key];
  });

  const wsConn = connections[connId];
  if(wsConn) {
    wsConn.send(JSON.stringify({
      type: 'request',
      connId,
      id,
      request: reqObject}));

    wsConn.on('message', function(msg) {
      msg = JSON.parse(msg);
      console.log('app response');

      if(msg.id !== id) { return; }

      if(msg.type === 'end') {
        res.end(msg.chunk);
      } else if(msg.type === 'head') {
        res.writeHead(msg.statusCode, msg.headers);
      } else if(msg.type === 'chunk') {
        res.write(msg.chunk);
      } else {
        console.log('do not understand', msg);
      }
    });
  } else {
    res.end(`no connection for ${connId}`);
  }
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const connections = {};

wss.on('connection', function connection(ws, req) {

  const location = url.parse(req.url, true);
  ws.on('message', function incoming(message) {
    console.log('received: %s', message);
  });

  const connId = randomId(5);
  const isConnected = JSON.stringify({status: "connected", id: connId});

  connections[connId] = ws;

  ws.send(isConnected);
});

server.listen(8080, function listening() {
  console.log('Listening on %d', server.address().port);
});
