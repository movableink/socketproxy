const { IncomingMessage, ServerResponse } = require('http');
const { Transform } = require('stream');
const WebSocket = require('ws');
const protobuf = require('protobufjs');

const root = protobuf.loadSync(__dirname + '/schemas/proxy.proto');
const RequestMessage = root.lookupType('socketproxy.Request');
const ResponseChunk = root.lookupType('socketproxy.ResponseChunk');
const WebSocketMessage = root.lookupType('socketproxy.WebSocketMessage');
const ProxyMessage = root.lookupType('socketproxy.ProxyMessage');
const ResponseType = ResponseChunk.lookup('MessageType').values;

class SocketProxy {
  constructor(opts) {
    this.url = opts.url;
    this.app = opts.app;
  }

  handleMessage(data) {
    const message = RequestMessage.decode(data);

    if(message.httpRequest) {
      const socket = new FakeSocket(this.ws, message.uuid);
      const req = new IncomingMessage(socket);
      Object.assign(req, message.httpRequest);

      const res = new ServerResponse(req);
      res.assignSocket(socket);

      res.on('finish', () => this.finishResponse(message.uuid));

      this.app.handle(req, res);
    } else if(message.connectionInfo) {
      this.lastUri = message.connectionInfo.uri;
    } else {
      console.log('unknown data', message);
    }
  }

  _sendProxyMessage(data, cb) {
    const message = ProxyMessage.fromObject(data);
    const payload = ProxyMessage.encode(message).finish();
    this.ws.send(payload, cb);
  }

  finishResponse(uuid) {
    const responseChunk = ResponseChunk.create({
      uuid,
      type: ResponseType.FINISH
    });
    this._sendProxyMessage({ responseChunk });
  }

  sendJSON(message) {
    this.send(JSON.stringify(message));
  }

  send(data) {
    const webSocketMessage = WebSocketMessage.fromObject({ data });
    this._sendProxyMessage({ webSocketMessage });
  }

  ping() {
    return new Promise((resolve, reject) => {
      const responseMessage = ResponseChunk.create({
        type: ResponseType.PING
      });
      const responseChunk = ResponseChunk.encode(responseMessage).finish();

      this._sendProxyMessage({ responseChunk }, (err) => {
        if(err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  connect() {
    if(this.ws) {
      // we have an existing socket session, see if it is active
      return this.ping().then(() => {
        return { uri: this.savedUri };
      }).catch((e) => {
        // ping failed, reset socket and try reconnecting
        this.ws = null;
        return this.connect();
      });
    }

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      this.ws.on('error', (err) => {
        this.ws = null; // try reconnecting next time
        reject(err);
      });

      // First message on connection will be a status message
      this.ws.once('message', (data) => resolve(this.handleStatus(data)));
      this.ws.on('message', (data) => this.handleMessage(data));
    });
  }

  handleStatus(data) {
    const message = RequestMessage.decode(data);
    if(!message.connectionInfo) { return {}; }
    this.savedUri = message.connectionInfo.uri;

    const connectionId = message.connectionInfo.connectionId;
    this.connectionId = connectionId;

    return { uri: this.savedUri, connectionId };
  }

  close() {
    if (this.ws) this.ws.close();
    this.ws = null;
  }
}

class FakeSocket extends Transform {
  constructor(ws, uuid) {
    super({});
    this.ws = ws;
    this.uuid = uuid;
    this.totalLength = 0;
  }

  write(chunk, encoding, callback) {
    if (typeof(chunk) === 'string') {
      chunk = Buffer.from(chunk);
    }

    const responseChunk = ResponseChunk.create({
      uuid: this.uuid,
      type: ResponseType.CHUNK,
      encoding,
      data: chunk
    });

    const message = ProxyMessage.fromObject({ responseChunk });
    const payload = ProxyMessage.encode(message).finish();
    this.ws.send(payload);

    return true;
  }
}

module.exports = SocketProxy;
