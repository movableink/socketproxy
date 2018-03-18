const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const Transform = require('stream').Transform;
const util = require('util');
const STATUS_CODES = require('http').STATUS_CODES;

const ServerResponse = http.ServerResponse;

const ws = new WebSocket('ws://localhost:8080');

const app = express();

class FakeResponse extends ServerResponse {
  constructor(attrs, ws, id) {
    super(attrs);

    this.ws = ws;
    this.id = id;
    this.socket = new FakeSocket();
    this.fake = true;

    this._onPendingData = () => {};

    this.writeHead = function(statusCode, reason, headers) {
	    if (arguments.length == 2 && typeof arguments[1] !== 'string') {
		    headers = reason;
		    reason = undefined;
	    }
	    this.statusCode = statusCode;
	    this.statusMessage = reason || STATUS_CODES[statusCode] || 'unknown';
	    if (headers) {
		    for (var name in headers) {
			    this.setHeader(name, headers[name]);
		    }
	    }

      this.ws.send(JSON.stringify({
        type: 'head',
        statusCode: this.statusCode,
        headers: this._headers,
        id: this.id
      }));
    };

    this._implicitHeader = function() {
      this.writeHead(this.statusCode);
    };

    this.end = function(chunk, encoding, callback) {
      if (typeof chunk === 'function') {
        callback = chunk;
        chunk = null;
      } else if (typeof encoding === 'function') {
        callback = encoding;
        encoding = null;
      }

      if (this.finished) {
        return false;
      }

      if(!this._header) {
        this._contentLength = 0;
        this._implicitHeader();
      }

      this.ws.send(JSON.stringify({
        type: 'end',
        chunk: chunk.toString(encoding),
        encoding,
        id: this.id
      }));

      this.finished = true;

      if (typeof callback === 'function') {
        callback();
      }
    };

    this._writeRaw = function(chunk, encoding, callback) {
      if (typeof encoding === 'function') {
        callback = encoding;
        encoding = null;
      }

      this.ws.send(JSON.stringify({
        type: 'chunk',
        chunk: chunk.toString(encoding),
        encoding,
        id: this.id }));

      if (typeof callback === 'function') {
        callback();
      }
    };
  }
}

class FakeRequest extends Transform {
  constructor(opts) {
    super();

    this.socket = new FakeSocket();

    Object.keys(opts).forEach(opt => {
      this[opt] = opts[opt];
    });
  }

  resume() {
  }

  createConnection() {
  }
}

class FakeSocket {
  destroy() {}
}

app.use(function(req, res) {
  res.send("GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT GOT IT ");
});

ws.on('message', function incoming(data) {
  data = JSON.parse(data);
  if(data.type === 'request') {
    const req = new FakeRequest(data.request);
    const res = new FakeResponse({ req }, ws, data.id);
    req.res = res;
    res.req = req;

    app(req, res);
  } else {
    console.log(data);
  }
});
