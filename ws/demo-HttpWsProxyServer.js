const { createWsClient } = require('./hwss');
const { createHttpServer, sendHttpRequest } = require('./httpm');

const WS_BACKEND_PORT = 7009;
const HTTP_PROXY_PORT = 9011;
const SHARED_CREDENTIALS = 'ws-secret-token';

async function startReverseProxyGateway() {
  console.log('================================================================');
  console.log('  HTTP Reverse Proxy Gateway Server (Forwarding to WS Backend)');
  console.log('================================================================\n');

  // 1. Initialize WS Client targeting the WS Backend Target
  const wsProxyClient = createWsClient({
    port: WS_BACKEND_PORT,
    credentials: SHARED_CREDENTIALS
  });

  // 2. Bridge incoming HTTP requests to WebSocket frames
  const wsProxyHandler = async (httpRequestDetails) => {
    console.log(`[Reverse Proxy] Forwarding ${httpRequestDetails.method} ${httpRequestDetails.url} -> WS Backend:${WS_BACKEND_PORT}`);

    const wsResponse = await wsProxyClient.sendHttpRequestPayload(httpRequestDetails);

    return {
      protocolClient: wsProxyClient,
      response: wsResponse
    };
  };

  // 3. Start HTTP Reverse Proxy Gateway
  const httpServer = createHttpServer(
    { httpPort: HTTP_PROXY_PORT },
    wsProxyHandler
  );

  console.log(`[Reverse Proxy] Gateway active and listening on http://127.0.0.1:${HTTP_PROXY_PORT}`);

  // Wait brief duration for server bindings
  await new Promise((resolve) => setTimeout(resolve, 300));

  // 4. Test client request execution
  console.log('\n--- Initiating Client Request to Reverse Proxy Gateway ---');
  try {
    const response = await sendHttpRequest({
      targetUrl: `http://127.0.0.1:${HTTP_PROXY_PORT}/api/v1/events/stream`,
      method: 'POST',
      body: {
        channel: 'notifications',
        user: 'alice',
        filter: 'unread'
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
    wsProxyClient.close();
    process.exit(0);
  });
}

startReverseProxyGateway();