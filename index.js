const WebSocket = require('ws');
const http = require('http');
const Transform = require('stream').Transform;
const util = require('util');
const STATUS_CODES = require('http').STATUS_CODES;

const ServerResponse = http.ServerResponse;
const Socket = require('net').Socket;

class SocketProxy {
  constructor(opts) {
    this.url = opts.url;
    this.app = opts.app;
  }

  handleMessage(data) {
    const msg = JSON.parse(data);
    if(msg.type === 'request') {
      const socket = new FakeSocket(this.ws, msg.id);
      const req = new http.IncomingMessage(socket);
      Object.assign(req, msg.request);

      const res = new ServerResponse(req);
      res.assignSocket(socket);

      res.on('finish', () => {
        this.ws.send(JSON.stringify({
          type: 'finish',
          id: msg.id
        }));
      });

      this.app.handle(req, res);
    } else if(msg.type === 'status') {
      this.lastStatus = msg;
    } else {
      console.log('unknown data', msg);
    }
  }

  ping() {
    return new Promise((resolve, reject) => {
      this.ws.send(JSON.stringify({ type: 'ping' }), (err) => {
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
        return this.lastStatus;
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
        this.lastStatus = JSON.parse(data);
        resolve(this.lastStatus);
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
  constructor(ws, id) {
    super({});
    this.ws = ws;
    this.id = id;
    this.totalLength = 0;
  }

  write(chunk, encoding, callback) {
    if (typeof(chunk) === 'string') {
      chunk = Buffer.from(chunk);
    }

    this.ws.send(JSON.stringify({
      type: 'chunk',
      chunk: chunk.toString('base64'),
      encoding,
      id: this.id }));

    return true;
  }
}

module.exports = SocketProxy;
