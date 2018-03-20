const express = require('express');
const morgan = require('morgan');
const url = require('url');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const uuid = require('uuid/v4');
const EventEmitter = require('events');
const ip = require('ip');
const protobuf = require('protobufjs');

function randomId() {
  return 'i-' + uuid();
}

function connectionIdFromHost(hostname) {
  return hostname && hostname.split('.')[0];
}

const root = protobuf.loadSync(__dirname + '/schemas/proxy.proto');
const RequestMessage = root.lookupType('socketproxy.Request');
const ResponseMessage = root.lookupType('socketproxy.ResponseChunk');
const ResponseType = ResponseMessage.lookup('MessageType').values;

// Things to serialize from the http IncomingMessage object
const reqKeys = ['headers', 'rawHeaders', 'readable', 'domain',
                 'trailers', 'rawTrailers', 'url', 'method', 'upgrade',
                 'baseUrl', 'originalUrl', 'params', 'query'];

class SocketProxyServer extends EventEmitter {
  constructor(opts={}) {
    super();

    this.opts = opts;
    this.useCert = !!(opts.sslCert || opts.sslKey);
    this.secure = opts.secure || this.useCert;
    this.proto = this.secure ? 'https' : 'http';
    this.wsProto = this.secure ? 'wss' : 'ws';

    this.connections = new Map();
    this.responses = new Map();
    this.app = this.buildApp();

    if(this.useCert) {
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

    app.use(morgan('combined', {immediate: true}));

    app.use((req, res) => this.handleRequest(req, res));

    return app;
  }

  handleMessage(data) {
    const message = ResponseMessage.decode(data);

    if(message.type === ResponseType.PING) { return; }

    const res = this.responses.get(message.uuid);
    if(!res) { return; }

    if(message.type === ResponseType.FINISH) {
      res.end();
    } else if(message.type === ResponseType.CHUNK) {
      res.connection.write(message.data, message.encoding);
    } else {
      console.log('do not understand', message);
    }
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

    this.responses.set(requestId, res);
    res.on('finish', () => this.responses.delete(requestId));

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

    const requestMessage = RequestMessage.create({
      uuid: requestId,
      httpRequest: reqObject
    });
    const payload = RequestMessage.encode(requestMessage).finish();
    wsConn.send(payload);
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
    wss.on('connection', (ws, req) => this.handleConnection(ws, req));

    return wss;
  }

  handleConnection(ws, req) {
    const location = url.parse(req.url, true);
    const host = req.headers.host;

    const connectionId = randomId();

    const message = RequestMessage.create({
      uuid: connectionId,
      connectionInfo: {
        uri: `${this.proto}://${connectionId}.${host}`
      }
    });

    const payloadBuffer = RequestMessage.encode(message).finish();
    ws.send(payloadBuffer);

    this.connections.set(connectionId, ws);

    ws.on('message', (data) => this.handleMessage(data));

    ws.on('close', () => this.connections.delete(connectionId));

    // mostly for logging purposes
    this.emit('connection', req, connectionId);
  }
}

module.exports = SocketProxyServer;
