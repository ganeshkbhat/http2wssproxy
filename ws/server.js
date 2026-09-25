const { createWsServer } = require('./hwss');

const WS_BACKEND_PORT = 7009;
const SHARED_CREDENTIALS = 'ws-secret-token';

// 1. Define WebSocket Request Handler
const wsRequestHandler = async (reqPayload) => {
  console.log(`[WS Backend Target] Handled Request: ${reqPayload.method} ${reqPayload.url}`);
  console.log('[WS Backend Target] Received Body:', reqPayload.body);

  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      status: 'success',
      message: 'Hello from Plain WS Target Backend Service',
      path: reqPayload.url,
      method: reqPayload.method,
      receivedData: reqPayload.body,
      processedAt: new Date().toISOString()
    })
  };
};

// 2. Define Authentication Validator
const authValidator = async (incomingToken, configuredCreds) => {
  return incomingToken === configuredCreds;
};

// 3. Start Standalone WS Backend Server
const wsBackendServer = createWsServer(
  {
    port: WS_BACKEND_PORT,
    credentials: SHARED_CREDENTIALS
  },
  wsRequestHandler,
  authValidator
);

console.log('================================================================');
console.log(`  WS Target Backend Server running on port ${WS_BACKEND_PORT}`);
console.log('================================================================');

process.on('SIGINT', () => {
  console.log('\nShutting down WS Target Backend Server...');
  wsBackendServer.close();
  process.exit(0);
});