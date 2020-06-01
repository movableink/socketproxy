const express = require('express');
const morgan = require('morgan');
const url = require('url');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const { v4: uuid } = require('uuid');
const EventEmitter = require('events');
const ip = require('ip');
const protobuf = require('protobufjs');
const typeis = require('type-is')
const CustomConnections = require('./src/custom-connections');

function randomId() {
  return 'i-' + uuid();
}

function connectionIdFromHost(hostname) {
  return hostname && hostname.split('.')[0];
}

const root = protobuf.loadSync(__dirname + '/schemas/proxy.proto');
const RequestMessage = root.lookupType('socketproxy.Request');
const ResponseMessage = root.lookupType('socketproxy.ResponseChunk');
const ProxyMessage = root.lookupType('socketproxy.ProxyMessage');
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
    this.customClients = new CustomConnections();

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

    app.use(morgan('combined'));

    app.use(express.text({ type: '*/*' }));

    app.get('/health', function (req, res) {
      res.statusCode = 200;
      res.end('Healthy');
    });

    app.use((req, res) => this.handleRequest(req, res));

    return app;
  }

  handleResponseChunk(message) {
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

  handleSocketMessage(message, connectionId) {
    const clients = this.customClients;

    for (const client of clients.entriesFor(connectionId)) {
      client.send(message);
    }
  }

  handleMessage(data, connectionId) {
    let message;
    try {
      message = ProxyMessage.decode(data);
    } catch (e) {
      return;
    }

    if (message.responseChunk) {
      return this.handleResponseChunk(message.responseChunk);
    }

    if (message.webSocketMessage) {
      return this.handleSocketMessage(message.webSocketMessage.data, connectionId);
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

    if (typeis.hasBody(req)) {
      reqObject.body = req.body;
    }

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

  addCustomConnection(ws, connectionId) {
    // Ensure there is actually an active connection for the provided
    // connection ID.
    if (!connectionId || !this.connections.has(connectionId)) {
      ws.close();
      return;
    }

    const clients = this.customClients;

    clients.add(connectionId, ws);

    ws.on('close', () => clients.delete(connectionId, ws));
  }

  handleConnection(ws, req) {
    const { query } = url.parse(req.url, true);
    const host = req.headers.host;

    if (query.connectionId) {
      this.addCustomConnection(ws, query.connectionId);
      return;
    }

    const connectionId = randomId();

    const message = RequestMessage.create({
      uuid: connectionId,
      connectionInfo: {
        connectionId,
        uri: `${this.proto}://${connectionId}.${host}`
      }
    });

    const payloadBuffer = RequestMessage.encode(message).finish();
    ws.send(payloadBuffer);

    this.connections.set(connectionId, ws);

    ws.on('message', (data) => this.handleMessage(data, connectionId));

    ws.on('close', () => {
      this.connections.delete(connectionId);

      const clients = this.customClients;

      for (const client of clients.entriesFor(connectionId)) {
        client.close();
      }

      clients.delete(connectionId)
    });

    // mostly for logging purposes
    this.emit('connection', req, connectionId);
  }
}

module.exports = SocketProxyServer;
