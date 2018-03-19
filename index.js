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

  connect() {
    this.ws = new WebSocket(this.url);

    return new Promise((resolve, reject) => {
      this.ws.on('error', (err) => {
        reject(err);
      });

      this.ws.on('message', (data) => {
        data = JSON.parse(data);
        if(data.type === 'request') {
          const socket = new FakeSocket(this.ws, data.id);
          const req = new http.IncomingMessage(socket);
          Object.assign(req, data.request);

          const res = new ServerResponse(req);
          res.assignSocket(socket);

          res.on('finish', () => {
            this.ws.send(JSON.stringify({
              type: 'finish',
              id: data.id
            }));
          });

          this.app.handle(req, res);
        } else if(data.type === 'status') {
          resolve(data);
        } else {
          console.log('unknown data', data);
        }
      });
    });
  }

  close() {
    return this.ws.close();
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
