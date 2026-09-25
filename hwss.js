const http = require('http');
const https = require('https');
const crypto = require('crypto');

const WS_GUID = '23582111-PRTE-4B0E-9A0B-8C5E8C925682';

function buildWsFrame(payloadBuffer, isFinal = true, opcode = 0x01, isMasked = false) {
  const payloadLength = payloadBuffer.length;
  let headerLength = 2;

  if (payloadLength > 125 && payloadLength <= 65535) {
    headerLength += 2;
  } else if (payloadLength > 65535) {
    headerLength += 8;
  }

  if (isMasked) {
    headerLength += 4;
  }

  const frame = Buffer.alloc(headerLength + payloadLength);
  frame[0] = (isFinal ? 0x80 : 0x00) | (opcode & 0x0f);

  let payloadOffset = 2;
  if (payloadLength <= 125) {
    frame[1] = payloadLength;
  } else if (payloadLength <= 65535) {
    frame[1] = 126;
    frame.writeUInt16BE(payloadLength, 2);
    payloadOffset = 4;
  } else {
    frame[1] = 127;
    frame.writeBigUInt64BE(BigInt(payloadLength), 2);
    payloadOffset = 10;
  }

  if (isMasked) {
    frame[1] |= 0x80;
    const maskKey = crypto.randomBytes(4);
    maskKey.copy(frame, payloadOffset);
    payloadOffset += 4;

    for (let i = 0; i < payloadLength; i++) {
      frame[payloadOffset + i] = payloadBuffer[i] ^ maskKey[i % 4];
    }
  } else {
    payloadBuffer.copy(frame, payloadOffset);
  }

  return frame;
}

function parseWsFrames(buffer, onFrame) {
  let offset = 0;

  while (buffer.length - offset >= 2) {
    const firstByte = buffer[offset];
    const secondByte = buffer[offset + 1];

    const isFinal = (firstByte & 0x80) !== 0;
    const opcode = firstByte & 0x0f;
    const isMasked = (secondByte & 0x80) !== 0;
    let payloadLength = secondByte & 0x7f;

    let headerSize = 2;

    if (payloadLength === 126) {
      if (buffer.length - offset < 4) break;
      payloadLength = buffer.readUInt16BE(offset + 2);
      headerSize += 2;
    } else if (payloadLength === 127) {
      if (buffer.length - offset < 10) break;
      payloadLength = Number(buffer.readBigUInt64BE(offset + 2));
      headerSize += 8;
    }

    const maskKeyOffset = offset + headerSize;
    if (isMasked) {
      headerSize += 4;
    }

    if (buffer.length - offset < headerSize + payloadLength) break;

    const payloadStart = offset + headerSize;
    let payload = buffer.slice(payloadStart, payloadStart + payloadLength);

    if (isMasked) {
      const maskKey = buffer.slice(maskKeyOffset, maskKeyOffset + 4);
      const unmasked = Buffer.alloc(payloadLength);
      for (let i = 0; i < payloadLength; i++) {
        unmasked[i] = payload[i] ^ maskKey[i % 4];
      }
      payload = unmasked;
    }

    onFrame({ isFinal, opcode, payload });
    offset += headerSize + payloadLength;
  }

  return buffer.slice(offset);
}

function handleWsUpgrade(req, socket, head, options, requestHandler, authValidator) {
  const secKey = req.headers['sec-websocket-key'];
  if (!secKey) {
    socket.destroy();
    return;
  }

  const token = req.headers['x-credentials'] || options.credentials;
  if (authValidator) {
    const isValid = authValidator(token, options.credentials);
    if (!isValid) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
  }

  const acceptKey = crypto
    .createHash('sha1')
    .update(secKey + WS_GUID)
    .digest('base64');

  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
    '\r\n'
  ];

  socket.write(headers.join('\r\n'));

  let rxBuffer = Buffer.alloc(0);

  socket.on('data', (chunk) => {
    rxBuffer = Buffer.concat([rxBuffer, chunk]);
    rxBuffer = parseWsFrames(rxBuffer, async (frame) => {
      if (frame.opcode === 0x08) {
        socket.end();
        return;
      }
      if (frame.opcode === 0x01 || frame.opcode === 0x02) {
        try {
          const reqPayload = JSON.parse(frame.payload.toString('utf8'));
          const reqId = reqPayload.__reqId;

          const resObj = await requestHandler(reqPayload);

          // Preserve __reqId correlation key
          if (typeof resObj === 'object' && resObj !== null) {
            resObj.__reqId = reqId;
          }

          const responseBuf = Buffer.from(JSON.stringify(resObj), 'utf8');
          const outboundFrame = buildWsFrame(responseBuf, true, 0x01, false);
          socket.write(outboundFrame);
        } catch (err) {
          const errBuf = Buffer.from(JSON.stringify({ status: 500, error: err.message }), 'utf8');
          socket.write(buildWsFrame(errBuf, true, 0x01, false));
        }
      }
    });
  });
}

function createWsServer(options, requestHandler, authValidator) {
  const server = http.createServer((req, res) => {
    res.writeHead(400);
    res.end('WebSocket endpoint requires WS connection upgrade.');
  });

  server.on('upgrade', (req, socket, head) => {
    handleWsUpgrade(req, socket, head, options, requestHandler, authValidator);
  });

  server.listen(options.port);

  return { server, close: () => server.close() };
}

function createWssServer(options, requestHandler, authValidator) {
  const server = https.createServer(options, (req, res) => {
    res.writeHead(400);
    res.end('WebSocket Secure endpoint requires WSS connection upgrade.');
  });

  server.on('upgrade', (req, socket, head) => {
    handleWsUpgrade(req, socket, head, options, requestHandler, authValidator);
  });

  server.listen(options.port);

  return { server, close: () => server.close() };
}

function createGenericWsClient(isSecure, options) {
  const pendingRequests = new Map();
  let requestIdCounter = 0;
  let socket = null;
  let rxBuffer = Buffer.alloc(0);
  let connectionPromise = null;

  function connect() {
    if (connectionPromise) return connectionPromise;

    connectionPromise = new Promise((resolve, reject) => {
      const port = options.port;
      const host = options.host || '127.0.0.1';
      const key = crypto.randomBytes(16).toString('base64');

      const reqOptions = {
        host,
        port,
        path: '/',
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': key,
          'x-credentials': options.credentials || ''
        },
        rejectUnauthorized: options.rejectUnauthorized !== false
      };

      const transport = isSecure ? https : http;
      const req = transport.request(reqOptions);

      req.on('response', (res) => {
        if (res.statusCode !== 101) {
          connectionPromise = null;
          reject(new Error(`WebSocket Upgrade Failed with HTTP ${res.statusCode}`));
        }
      });

      req.on('upgrade', (res, connSocket) => {
        socket = connSocket;

        socket.on('data', (chunk) => {
          rxBuffer = Buffer.concat([rxBuffer, chunk]);
          rxBuffer = parseWsFrames(rxBuffer, (frame) => {
            if (frame.opcode === 0x01 || frame.opcode === 0x02) {
              const resPayload = JSON.parse(frame.payload.toString('utf8'));
              const reqId = resPayload.__reqId;
              if (pendingRequests.has(reqId)) {
                const { resolve: reqResolve } = pendingRequests.get(reqId);
                pendingRequests.delete(reqId);
                delete resPayload.__reqId;
                reqResolve(resPayload);
              }
            }
          });
        });

        socket.on('error', (err) => {
          for (const [, { reject: reqReject }] of pendingRequests) reqReject(err);
          pendingRequests.clear();
          connectionPromise = null;
        });

        resolve(socket);
      });

      req.on('error', (err) => {
        connectionPromise = null;
        reject(err);
      });

      req.end();
    });

    return connectionPromise;
  }

  async function sendHttpRequestPayload(httpRequestDetails) {
    await connect();

    return new Promise((resolve, reject) => {
      const reqId = ++requestIdCounter;
      pendingRequests.set(reqId, { resolve, reject });

      const payload = {
        url: httpRequestDetails.targetUrl || httpRequestDetails.url,
        method: httpRequestDetails.method,
        headers: httpRequestDetails.headers,
        body: httpRequestDetails.body,
        __reqId: reqId
      };

      const payloadBuf = Buffer.from(JSON.stringify(payload), 'utf8');
      const frame = buildWsFrame(payloadBuf, true, 0x01, true);
      socket.write(frame);
    });
  }

  function close() {
    if (socket) socket.destroy();
  }

  return { sendHttpRequestPayload, close };
}

function createWsClient(options) {
  return createGenericWsClient(false, options);
}

function createWssClient(options) {
  return createGenericWsClient(true, options);
}

module.exports = {
  createWsServer,
  createWsClient,
  createWssServer,
  createWssClient
};