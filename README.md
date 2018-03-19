# SocketProxy

Expose a local node http server via a remote URL.

Motivation: you run a local http-based node app that you want to expose to the world, and you also have the ability to run a public node app elsewhere.

SocketProxy comes in two parts:

* The SocketProxy client connects to the SocketProxy server via websockets and receives a public subdomain URL.
* The SocketProxy server listens on an http/https port, maps the request subdomain to a SocketProxy client, and then proxies the http/https request to the SocketProxy client over websockets.

## Usage

The server works out of the box, the client will need to be customized for your app. Starting the server:

```bash
bin/server --port=8080
```

See `bin/server --help` for all options.

An example client can be found at `bin/example-client`.

```javascript
const SocketProxy = require('socketproxy');

const app = express();
app.use(...)

const proxy = new SocketProxy({
  url: 'ws://socketproxy-server:8080',
  app: app
});

proxy.connect().then((p) => {
  console.log("Connected", p.uri);
});
```

Replace `socketproxy-server` above with the hostname of your SocketProxy server.

## Alternatives

`localtunnel` is a popular alternative for some similar use cases. Notable differences are that it is actually a full TCP tunnel while the SocketProxy client connects directly to an express/connect handler, so doesn't generate any extra connections on the client machine. SocketProxy was developed because `localtunnel` isn't able to encrypt TCP traffic, and requires the use of all of the server's ports. For high-throughput uses, `localtunnel` is likely quite a bit faster since it will use many TCP connections rather than a single multiplexed-via-json websockets connection.

## License

See LICENSE.txt
