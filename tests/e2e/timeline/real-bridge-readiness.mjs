import { createServer, request as httpRequest } from 'node:http';

export const BRIDGE_PROTOCOL_HEADER = 'X-Astrid-Bridge-Version';
export const BRIDGE_PROTOCOL_VERSION = 'v1';

function assertPort(value, label) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${label} must be a valid TCP port`);
  }
  return port;
}

function probeBridgeHealth({ bridgePort, token }) {
  return new Promise((resolve) => {
    const request = httpRequest({
      hostname: '127.0.0.1',
      port: bridgePort,
      path: '/health',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        [BRIDGE_PROTOCOL_HEADER]: BRIDGE_PROTOCOL_VERSION,
      },
    }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.setTimeout(1_000, () => {
      request.destroy();
      resolve(false);
    });
    request.on('error', () => resolve(false));
    request.end();
  });
}

export function createBridgeReadinessAdapter({ bridgePort, readyPort, token }) {
  const actualBridgePort = assertPort(bridgePort, 'bridgePort');
  const actualReadyPort = assertPort(readyPort, 'readyPort');
  if (actualReadyPort === actualBridgePort) {
    throw new Error('readyPort must be distinct from bridgePort');
  }
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('readiness adapter requires a non-empty bridge token');
  }

  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/ready') {
      response.statusCode = 503;
      response.setHeader('Content-Type', 'application/json');
      response.end('{"ready":false}');
      return;
    }
    probeBridgeHealth({ bridgePort: actualBridgePort, token }).then((ready) => {
      response.statusCode = ready ? 200 : 503;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ ready }));
    }).catch(() => {
      response.statusCode = 503;
      response.setHeader('Content-Type', 'application/json');
      response.end('{"ready":false}');
    });
  });

  return {
    server,
    listen() {
      return new Promise((resolve, reject) => {
        const onError = (error) => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.off('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(actualReadyPort, '127.0.0.1');
      });
    },
    close() {
      if (!server.listening) return Promise.resolve();
      return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
