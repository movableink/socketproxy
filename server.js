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
    this.connections = new Map();

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
    const hostname = req.headers.host;
    const connectionId = hostname.split('.')[0];

    const requestId = randomId();

    const reqObject = {};
    reqKeys.forEach((key) => {
      reqObject[key] = req[key];
    });

    const wsConn = this.connections.get(connectionId);

    if (wsConn) {
      wsConn.send(JSON.stringify({
        type: 'request',
        connectionId,
        id: requestId,
        request: reqObject}));

      const handleMessage = (msg) => {
        msg = JSON.parse(msg);

        if(msg.id !== requestId) { return; }

        if(msg.type === 'finish') {
          res.end();
          wsConn.removeListener('message', handleMessage);
        } else if(msg.type === 'chunk') {
          const buffer = Buffer.from(msg.chunk, 'base64');
          res.connection.write(buffer, msg.encoding);
        } else {
          console.log('do not understand', msg);
        }
      };

      wsConn.on('message', handleMessage);
    } else {
      res.writeHead(502, {});
      res.end(`no server present for ${connectionId}`);
    }
  }

  listen(port, callback) {
    return new Promise((resolve, reject) => {
      return this.server.listen(port, (err) => {
        if(callback) { callback(err); }

        if(err) {
          reject(err);
        } else {
          resolve(this.server);
        }
      });
    });
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

      const connectionId = randomId();
      const isConnected = JSON.stringify({
        type: "status",
        status: "connected",
        uri: `http://${connectionId}.${host}`
      });

      this.connections.set(connectionId, ws);

      ws.on('close', () => {
        this.connections.delete(connectionId);
      });

      ws.send(isConnected);
    });

    return wss;
  }
}

module.exports = SocketProxyServer;
