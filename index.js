const { IncomingMessage, ServerResponse } = require('http');
const { Transform } = require('stream');
const { Socket } = require('net');
const WebSocket = require('ws');
const protobuf = require('protobufjs');

const root = protobuf.loadSync(__dirname + '/schemas/proxy.proto');
const RequestMessage = root.lookupType('socketproxy.Request');
const ResponseMessage = root.lookupType('socketproxy.ResponseChunk');
const ResponseType = ResponseMessage.lookup('MessageType').values;

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

      res.on('finish', () => {
        const responseMessage = ResponseMessage.create({
          uuid: message.uuid,
          type: ResponseType.FINISH
        });
        const payload = ResponseMessage.encode(responseMessage).finish();
        this.ws.send(payload);
      });

      this.app.handle(req, res);
    } else if(message.connectionInfo) {
      this.lastUri = message.connectionInfo.uri;
    } else {
      console.log('unknown data', message);
    }
  }

  ping() {
    return new Promise((resolve, reject) => {
      const responseMessage = ResponseMessage.create({
        type: ResponseType.PING
      });
      const payload = ResponseMessage.encode(responseMessage).finish();

      this.ws.send(payload, (err) => {
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
      this.ws.once('message', (data) => {
        const message = RequestMessage.decode(data);
        if(!message.connectionInfo) { return; }
        this.savedUri = message.connectionInfo.uri;

        resolve({uri: this.savedUri});
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data);
      });
    });
  }

  close() {
    this.ws.close();
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

    const responseMessage = ResponseMessage.create({
      uuid: this.uuid,
      type: ResponseType.CHUNK,
      encoding,
      data: chunk
    });
    const payload = ResponseMessage.encode(responseMessage).finish();
    this.ws.send(payload);

    return true;
  }
}

module.exports = SocketProxy;
