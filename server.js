const express = require('express');
const url = require('url');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const uuid = require('uuid/v4');
const EventEmitter = require('events');
const ip = require('ip');

function randomId() {
  return 'i-' + uuid();
}

function connectionIdFromHost(hostname) {
  return hostname && hostname.split('.')[0];
}

// Things to serialize from the http IncomingMessage object
const reqKeys = ['headers', 'rawHeaders', 'readable', 'domain', 'trailers', 'rawTrailers', 'url', 'method', 'upgrade', 'baseUrl', 'originalUrl', 'params', 'query'];

class SocketProxyServer extends EventEmitter {
  constructor(opts={}) {
    super();

    this.opts = opts;
    this.secure = !!(opts.sslCert || opts.sslKey);
    this.proto = this.secure ? 'https' : 'http';
    this.wsProto = this.secure ? 'ws' : 'wss';

    this.connections = new Map();
    this.app = this.buildApp();

    if(this.secure) {
      this.server = https.createServer({
        key: opts.sslKey,
        cert: opts.sslCert
      }, this.app);
    } else {
      this.server = http.createServer(this.app);
    }

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
    if (!hostname) {
      res.statusCode = 400;
      res.end('Host header is required');
      return;
    }

    const remoteIp = req.socket.remoteAddress;
    const allowed = this.opts.allowHttpSubnet;

    if (allowed && !ip.cidrSubnet(allowed).contains(remoteIp)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }

    const connectionId = connectionIdFromHost(hostname);

    const requestId = randomId();

    const reqObject = {};
    reqKeys.forEach((key) => {
      reqObject[key] = req[key];
    });

    const wsConn = this.connections.get(connectionId);

    if (!wsConn) {
      res.writeHead(502, {});
      res.end(`no server present for ${connectionId}`);
      return;
    }

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
  }

  listen(port, bind, callback) {
    if(typeof(bind) === 'function') {
      callback = bind;
      bind = '0.0.0.0';
    }

    return new Promise((resolve, reject) => {
      return this.server.listen(port, bind, (err) => {
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
      this.emit('connection', req, connectionId);
    });

    return wss;
  }
}

module.exports = SocketProxyServer;
