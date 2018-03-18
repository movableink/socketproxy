const express = require('express');
const http = require('http');
const url = require('url');
const WebSocket = require('ws');
const uuid = require('uuid/v4');

function randomId() {
  return 'i-' + uuid();
}

// Things to serialize from the http IncomingMessage object
const reqKeys = ['headers', 'rawHeaders', 'readable', 'domain', 'trailers', 'rawTrailers', 'url', 'method', 'upgrade', 'baseUrl', 'originalUrl', 'params', 'query'];

class SocketProxyServer {
  constructor(opts={}) {
    this.connections = {};

    this.app = this.buildApp();
    this.server = http.createServer(this.app);
    this.wss = this.buildWebSockets(this.server);
  }

  buildApp() {
    const app = express();

    app.use((req, res) => {
      this.handleRequest(req, res);
    });

    return app;
  }

  handleRequest(req, res) {
    const connId = url.parse(req.url).path.slice(1);
    const id = randomId();

    const reqObject = {};
    reqKeys.forEach((key) => {
      reqObject[key] = req[key];
    });

    const wsConn = this.connections[connId];
    if(wsConn) {
      wsConn.send(JSON.stringify({
        type: 'request',
        connId,
        id,
        request: reqObject}));

      wsConn.on('message', function(msg) {
        msg = JSON.parse(msg);

        if(msg.id !== id) { return; }

        if(msg.type === 'finish') {
          res.end();
        } else if(msg.type === 'chunk') {
          res.connection.write(msg.chunk);
        } else {
          console.log('do not understand', msg);
        }
      });
    } else {
      res.writeHead(502, {});
      res.end(`no server present for ${connId}`);
    }
  }

  listen() {
    return this.server.listen(...arguments);
  }

  close() {
    return this.server.close();
  }

  address() {
    return this.server.address();
  }

  buildWebSockets(server) {
    const wss = new WebSocket.Server({ server });
    wss.on('connection', (ws, req) => {

      const location = url.parse(req.url, true);
      const host = req.headers.host;
      //ws.on('message', function incoming(message) {
      //  console.log('received: %s', message);
      //});

      const connId = randomId();
      const isConnected = JSON.stringify({
        type: "status",
        status: "connected",
        uri: `http://${host}/${connId}`
      });

      this.connections[connId] = ws;

      ws.send(isConnected);
    });

    return wss;
  }
}

module.exports = SocketProxyServer;
