const { createWssClient } = require('./hwss');
const { createHttpServer, sendHttpRequest } = require('./httpm');

const WSS_BACKEND_PORT = 7010;
const HTTP_PROXY_PORT = 9012;
const SHARED_CREDENTIALS = 'wss-secret-token';

async function startReverseProxyGateway() {
  console.log('================================================================');
  console.log('  HTTP Reverse Proxy Gateway Server (Forwarding to WSS Backend)');
  console.log('================================================================\n');

  // 1. Initialize WSS Client targeting the WSS Backend Target
  const wssProxyClient = createWssClient({
    port: WSS_BACKEND_PORT,
    credentials: SHARED_CREDENTIALS,
    rejectUnauthorized: false
  });

  // 2. Bridge incoming HTTP requests to secure WebSocket frames
  const wssProxyHandler = async (httpRequestDetails) => {
    console.log(`[Reverse Proxy] Forwarding ${httpRequestDetails.method} ${httpRequestDetails.url} -> WSS Backend:${WSS_BACKEND_PORT}`);

    const wssResponse = await wssProxyClient.sendHttpRequestPayload(httpRequestDetails);

    return {
      protocolClient: wssProxyClient,
      response: wssResponse
    };
  };

  // 3. Start HTTP Reverse Proxy Gateway
  const httpServer = createHttpServer(
    { httpPort: HTTP_PROXY_PORT },
    wssProxyHandler
  );

  console.log(`[Reverse Proxy] Gateway active and listening on http://127.0.0.1:${HTTP_PROXY_PORT}`);

  // Wait brief duration for server bindings
  await new Promise((resolve) => setTimeout(resolve, 300));

  // 4. Test client request execution
  console.log('\n--- Initiating Client Request to Reverse Proxy Gateway ---');
  try {
    const response = await sendHttpRequest({
      targetUrl: `http://127.0.0.1:${HTTP_PROXY_PORT}/api/v1/secure-stream`,
      method: 'POST',
      body: {
        auth: 'jwt-bearer-token',
        channel: 'secure-telemetry',
        session: 'sess-88912'
      }
    });

    console.log('[HTTP Client] Proxy Response Status Code:', response.statusCode);
    console.log('[HTTP Client] Proxy Response Body:', JSON.stringify(response.body, null, 2));
  } catch (err) {
    console.error('[HTTP Client] Reverse Proxy Request Failed:', err.message);
  }

  process.on('SIGINT', () => {
    console.log('\nShutting down HTTP Reverse Proxy Gateway...');
    httpServer.server.close();
    wssProxyClient.close();
    process.exit(0);
  });
}

startReverseProxyGateway();