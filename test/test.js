const express = require('express');
const url = require('url');
const SocketProxyServer = require('../server.js');
const SocketProxy = require('../index.js');
const request = require('request-promise-native');
const { expect } = require('chai');

describe('SocketProxy integration', function() {
  describe('simple response', function() {
    before(async function() {
      this.proxyServer = new SocketProxyServer();

      await this.proxyServer.listen(8080);

      this.app = express();

      this.app.use(function(req, res) {
        res.send("GOT IT");
      });

      this.proxy = new SocketProxy({url: 'ws://localhost:8080', app: this.app});
    });

    after(async function() {
      await this.proxy.close();
      await this.proxyServer.close();
    });

    it('proxies the response', async function() {
      const { uri } = await this.proxy.connect();
      const { hostname } = url.parse(uri);

      const data = await request({
        uri: 'http://localhost:8080',
        headers: {
          host: hostname
        },
        resolveWithFullResponse: true
      });

      expect(data.body).to.equal("GOT IT");
    });
  });
});
