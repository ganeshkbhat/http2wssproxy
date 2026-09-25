const fs = require('fs');
const path = require('path');
const { createWssServer } = require('./hwss');

const WSS_BACKEND_PORT = 7010;
const SHARED_CREDENTIALS = 'wss-secret-token';

const tlsOptions = {
  key: fs.readFileSync(path.join(__dirname, 'key.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'cert.pem'))
};

// 1. Define Secure WebSocket Request Handler
const wssRequestHandler = async (reqPayload) => {
  console.log(`[WSS Backend Target] Handled Request: ${reqPayload.method} ${reqPayload.url}`);
  console.log('[WSS Backend Target] Received Body:', reqPayload.body);

  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      status: 'success',
      message: 'Hello from Secure WSS Target Backend Service',
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

// 3. Start Standalone WSS Backend Server
const wssBackendServer = createWssServer(
  {
    port: WSS_BACKEND_PORT,
    credentials: SHARED_CREDENTIALS,
    ...tlsOptions
  },
  wssRequestHandler,
  authValidator
);

console.log('================================================================');
console.log(`  WSS Target Backend Server running on port ${WSS_BACKEND_PORT}`);
console.log('================================================================');

process.on('SIGINT', () => {
  console.log('\nShutting down WSS Target Backend Server...');
  wssBackendServer.close();
  process.exit(0);
});