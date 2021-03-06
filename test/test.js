const express = require('express');
const url = require('url');
const path = require('path');
const SocketProxyServer = require('../server.js');
const SocketProxy = require('../index.js');
const request = require('request-promise-native');
const { expect } = require('chai');

describe('SocketProxy integration', function() {
  describe('simple response', function() {
    beforeEach(async function() {
      this.proxyServer = new SocketProxyServer();

      await this.proxyServer.listen(8080);

      this.app = express();

      this.proxy = new SocketProxy({url: 'ws://localhost:8080', app: this.app});
    });

    afterEach(async function() {
      await this.proxy.close();
      await this.proxyServer.close();
    });

    it('proxies the response', async function() {
      const { uri } = await this.proxy.connect();
      const { hostname } = url.parse(uri);

      this.app.use((_, res) => res.send("GOT IT"));

      const data = await request({
        uri: 'http://localhost:8080',
        headers: { host: hostname },
        resolveWithFullResponse: true
      });

      expect(data.body).to.equal("GOT IT");
    });

    it('has a health check', async function() {
      const data = await request({
        url: 'http://localhost:8080/health',
        resolveWithFullResponse: true
      });

      expect(data.body).to.equal('Healthy');
      expect(data.statusCode).to.equal(200);
    });

    it('supports POST body', async function() {
      const { uri } = await this.proxy.connect();
      const { hostname } = url.parse(uri);

      this.app.post('/foo', (req, res) => {
        const body = JSON.parse(req.body);
        res.send(JSON.stringify(body));
      });

      const data = await request({
        method: 'POST',
        body: JSON.stringify({ foo: true }),
        uri: 'http://localhost:8080/foo',
        headers: { host: hostname, 'content-type': 'application/json' },
        resolveWithFullResponse: true
      });

      expect(JSON.parse(data.body)).to.deep.equal({ foo: true });
    });
  });

  describe('app sends image', function() {
    beforeEach(async function() {
      this.proxyServer = new SocketProxyServer();

      await this.proxyServer.listen(8080);

      this.app = express();

      this.app.use(function(req, res) {
        const file = path.resolve(__dirname, 'data/img.jpg');
        res.sendFile(file);
      });

      this.proxy = new SocketProxy({url: 'ws://localhost:8080', app: this.app});
    });

    afterEach(async function() {
      await this.proxy.close();
      await this.proxyServer.close();
    });

    it('proxies the image response', async function() {
      const { uri } = await this.proxy.connect();
      const { hostname } = url.parse(uri);

      const data = await request({
        uri: 'http://localhost:8080',
        encoding: null,
        headers: {
          host: hostname
        },
        resolveWithFullResponse: true
      });

      expect(data.headers['content-type']).to.equal('image/jpeg');
      expect(data.body.length).to.equal(94322);
    });
  });

  describe('simultaneous requests', function() {
    before(async function() {
      this.proxyServer = new SocketProxyServer();

      await this.proxyServer.listen(8080);

      this.app = express();

      this.app.use(function(req, res) {
        setTimeout(function() {
          if(req.url === '/first') {
            res.send('this is first');
          } else {
            res.send('this is second');
          }
        }, 50);
      });

      this.proxy = new SocketProxy({url: 'ws://localhost:8080', app: this.app});
    });

    after(async function() {
      await this.proxy.close();
      await this.proxyServer.close();
    });

    it('proxies the respective requests', async function() {
      const { uri } = await this.proxy.connect();
      const { hostname } = url.parse(uri);

      return Promise.all([
        request({
          uri: 'http://localhost:8080/first',
          headers: {
            host: hostname
          },
          resolveWithFullResponse: true
        }).then((data) => {
          expect(data.body).to.equal('this is first');
        }),

        request({
          uri: 'http://localhost:8080/second',
          headers: {
            host: hostname
          },
          resolveWithFullResponse: true
        }).then((data) => {
          expect(data.body).to.equal('this is second');
        })
      ]);
    });
  });
});
