# Rondevu Client

[![npm version](https://img.shields.io/npm/v/@xtr-dev/rondevu-client)](https://www.npmjs.com/package/@xtr-dev/rondevu-client)

🌐 **WebRTC with durable connections and automatic reconnection**

TypeScript/JavaScript client for Rondevu, providing durable WebRTC connections that survive network interruptions with automatic reconnection and message queuing.

**Related repositories:**
- [@xtr-dev/rondevu-client](https://github.com/xtr-dev/rondevu-client) - TypeScript client library ([npm](https://www.npmjs.com/package/@xtr-dev/rondevu-client))
- [@xtr-dev/rondevu-server](https://github.com/xtr-dev/rondevu-server) - HTTP signaling server ([npm](https://www.npmjs.com/package/@xtr-dev/rondevu-server), [live](https://api.ronde.vu))
- [@xtr-dev/rondevu-demo](https://github.com/xtr-dev/rondevu-demo) - Interactive demo ([live](https://ronde.vu))

---

## Features

- **Durable Connections**: Automatic reconnection on network drops
- **Message Queuing**: Messages sent during disconnections are queued and flushed on reconnect
- **Durable Channels**: RTCDataChannel wrappers that survive connection drops
- **TTL Auto-Refresh**: Services automatically republish before expiration
- **Username Claiming**: Cryptographic ownership with Ed25519 signatures
- **Service Publishing**: Package-style naming (com.example.chat@1.0.0)
- **TypeScript**: Full type safety and autocomplete
- **Configurable**: All timeouts, retry limits, and queue sizes are configurable

## Install

```bash
npm install @xtr-dev/rondevu-client
```

## Quick Start

### Publishing a Service (Alice)

```typescript
import { Rondevu } from '@xtr-dev/rondevu-client';

// Initialize client and register
const client = new Rondevu({ baseUrl: 'https://api.ronde.vu' });
await client.register();

// Step 1: Claim username (one-time)
const claim = await client.usernames.claimUsername('alice');
client.usernames.saveKeypairToStorage('alice', claim.publicKey, claim.privateKey);

// Step 2: Expose service with handler
const keypair = client.usernames.loadKeypairFromStorage('alice');

const service = await client.exposeService({
  username: 'alice',
  privateKey: keypair.privateKey,
  serviceFqn: 'chat@1.0.0',
  isPublic: true,
  poolSize: 10,  // Handle 10 concurrent connections
  handler: (channel, connectionId) => {
    console.log(`📡 New connection: ${connectionId}`);

    channel.on('message', (data) => {
      console.log('📥 Received:', data);
      channel.send(`Echo: ${data}`);
    });

    channel.on('close', () => {
      console.log(`👋 Connection ${connectionId} closed`);
    });
  }
});

// Start the service
const info = await service.start();
console.log(`Service published with UUID: ${info.uuid}`);
console.log('Waiting for connections...');

// Later: stop the service
await service.stop();
```

### Connecting to a Service (Bob)

```typescript
import { Rondevu } from '@xtr-dev/rondevu-client';

// Initialize client and register
const client = new Rondevu({ baseUrl: 'https://api.ronde.vu' });
await client.register();

// Connect to Alice's service
const connection = await client.connect('alice', 'chat@1.0.0', {
  maxReconnectAttempts: 5
});

// Create a durable channel
const channel = connection.createChannel('main');

channel.on('message', (data) => {
  console.log('📥 Received:', data);
});

channel.on('open', () => {
  console.log('✅ Channel open');
  channel.send('Hello Alice!');
});

// Listen for connection events
connection.on('connected', () => {
  console.log('🎉 Connected to Alice');
});

connection.on('reconnecting', (attempt, max, delay) => {
  console.log(`🔄 Reconnecting... (${attempt}/${max}, retry in ${delay}ms)`);
});

connection.on('disconnected', () => {
  console.log('🔌 Disconnected');
});

connection.on('failed', (error) => {
  console.error('❌ Connection failed permanently:', error);
});

// Establish the connection
await connection.connect();

// Messages sent during disconnection are automatically queued
channel.send('This will be queued if disconnected');

// Later: close the connection
await connection.close();
```

## Core Concepts

### DurableConnection

Manages WebRTC peer lifecycle with automatic reconnection:
- Automatically reconnects when connection drops
- Exponential backoff with jitter (1s → 2s → 4s → 8s → ... max 30s)
- Configurable max retry attempts (default: 10)
- Manages multiple DurableChannel instances

### DurableChannel

Wraps RTCDataChannel with message queuing:
- Queues messages during disconnection
- Flushes queue on reconnection
- Configurable queue size and message age limits
- RTCDataChannel-compatible API with event emitters

### DurableService

Server-side service with TTL auto-refresh:
- Automatically republishes service before TTL expires
- Creates DurableConnection for each incoming peer
- Manages connection pool for multiple simultaneous connections

## API Reference

### Main Client

```typescript
const client = new Rondevu({
  baseUrl: 'https://api.ronde.vu',  // optional, default shown
  credentials?: { peerId, secret },  // optional, skip registration
  fetch?: customFetch,               // optional, for Node.js < 18
  RTCPeerConnection?: RTCPeerConnection,  // optional, for Node.js
  RTCSessionDescription?: RTCSessionDescription,
  RTCIceCandidate?: RTCIceCandidate
});

// Register and get credentials
const creds = await client.register();
// { peerId: '...', secret: '...' }

// Check if authenticated
client.isAuthenticated(); // boolean

// Get current credentials
client.getCredentials(); // { peerId, secret } | undefined
```

### Username API

```typescript
// Check username availability
const check = await client.usernames.checkUsername('alice');
// { available: true } or { available: false, expiresAt: number, publicKey: string }

// Claim username with new keypair
const claim = await client.usernames.claimUsername('alice');
// { username, publicKey, privateKey, claimedAt, expiresAt }

// Save keypair to localStorage
client.usernames.saveKeypairToStorage('alice', claim.publicKey, claim.privateKey);

// Load keypair from localStorage
const keypair = client.usernames.loadKeypairFromStorage('alice');
// { publicKey, privateKey } | null
```

**Username Rules:**
- Format: Lowercase alphanumeric + dash (`a-z`, `0-9`, `-`)
- Length: 3-32 characters
- Pattern: `^[a-z0-9][a-z0-9-]*[a-z0-9]$`
- Validity: 365 days from claim/last use
- Ownership: Secured by Ed25519 public key

### Durable Service API

```typescript
// Expose a durable service
const service = await client.exposeService({
  username: 'alice',
  privateKey: keypair.privateKey,
  serviceFqn: 'chat@1.0.0',

  // Service options
  isPublic: true,               // optional, default: false
  metadata: { version: '1.0' }, // optional
  ttl: 300000,                  // optional, default: 5 minutes
  ttlRefreshMargin: 0.2,        // optional, refresh at 80% of TTL

  // Connection pooling
  poolSize: 10,                 // optional, default: 1
  pollingInterval: 2000,        // optional, default: 2000ms

  // Connection options (applied to incoming connections)
  maxReconnectAttempts: 10,     // optional, default: 10
  reconnectBackoffBase: 1000,   // optional, default: 1000ms
  reconnectBackoffMax: 30000,   // optional, default: 30000ms
  reconnectJitter: 0.2,         // optional, default: 0.2 (±20%)
  connectionTimeout: 30000,     // optional, default: 30000ms

  // Message queuing
  maxQueueSize: 1000,           // optional, default: 1000
  maxMessageAge: 60000,         // optional, default: 60000ms (1 minute)

  // WebRTC configuration
  rtcConfig: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' }
    ]
  },

  // Connection handler
  handler: (channel, connectionId) => {
    // Handle incoming connection
    channel.on('message', (data) => {
      console.log('Received:', data);
      channel.send(`Echo: ${data}`);
    });
  }
});

// Start the service
const info = await service.start();
// { serviceId: '...', uuid: '...', expiresAt: 1234567890 }

// Get active connections
const connections = service.getActiveConnections();
// ['conn-123', 'conn-456']

// Get service info
const serviceInfo = service.getServiceInfo();
// { serviceId: '...', uuid: '...', expiresAt: 1234567890 } | null

// Stop the service
await service.stop();
```

**Service Events:**
```typescript
service.on('published', (serviceId, uuid) => {
  console.log(`Service published: ${uuid}`);
});

service.on('connection', (connectionId) => {
  console.log(`New connection: ${connectionId}`);
});

service.on('disconnection', (connectionId) => {
  console.log(`Connection closed: ${connectionId}`);
});

service.on('ttl-refreshed', (expiresAt) => {
  console.log(`TTL refreshed, expires at: ${new Date(expiresAt)}`);
});

service.on('error', (error, context) => {
  console.error(`Service error (${context}):`, error);
});

service.on('closed', () => {
  console.log('Service stopped');
});
```

### Durable Connection API

```typescript
// Connect by username and service FQN
const connection = await client.connect('alice', 'chat@1.0.0', {
  // Connection options
  maxReconnectAttempts: 10,     // optional, default: 10
  reconnectBackoffBase: 1000,   // optional, default: 1000ms
  reconnectBackoffMax: 30000,   // optional, default: 30000ms
  reconnectJitter: 0.2,         // optional, default: 0.2 (±20%)
  connectionTimeout: 30000,     // optional, default: 30000ms

  // Message queuing
  maxQueueSize: 1000,           // optional, default: 1000
  maxMessageAge: 60000,         // optional, default: 60000ms

  // WebRTC configuration
  rtcConfig: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' }
    ]
  }
});

// Connect by UUID
const connection2 = await client.connectByUuid('service-uuid-here', {
  maxReconnectAttempts: 5
});

// Create channels before connecting
const channel = connection.createChannel('main');
const fileChannel = connection.createChannel('files', {
  ordered: false,
  maxRetransmits: 3
});

// Get existing channel
const existingChannel = connection.getChannel('main');

// Check connection state
const state = connection.getState();
// 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'failed' | 'closed'

const isConnected = connection.isConnected();

// Connect
await connection.connect();

// Close connection
await connection.close();
```

**Connection Events:**
```typescript
connection.on('state', (newState, previousState) => {
  console.log(`State: ${previousState} → ${newState}`);
});

connection.on('connected', () => {
  console.log('Connected');
});

connection.on('reconnecting', (attempt, maxAttempts, delay) => {
  console.log(`Reconnecting (${attempt}/${maxAttempts}) in ${delay}ms`);
});

connection.on('disconnected', () => {
  console.log('Disconnected');
});

connection.on('failed', (error, permanent) => {
  console.error('Connection failed:', error, 'Permanent:', permanent);
});

connection.on('closed', () => {
  console.log('Connection closed');
});
```

### Durable Channel API

```typescript
const channel = connection.createChannel('chat', {
  ordered: true,          // optional, default: true
  maxRetransmits: undefined  // optional, for unordered channels
});

// Send data (queued if disconnected)
channel.send('Hello!');
channel.send(new ArrayBuffer(1024));
channel.send(new Blob(['data']));

// Check state
const state = channel.readyState;
// 'connecting' | 'open' | 'closing' | 'closed'

// Get buffered amount
const buffered = channel.bufferedAmount;

// Set buffered amount low threshold
channel.bufferedAmountLowThreshold = 16 * 1024; // 16KB

// Get queue size (for debugging)
const queueSize = channel.getQueueSize();

// Close channel
channel.close();
```

**Channel Events:**
```typescript
channel.on('open', () => {
  console.log('Channel open');
});

channel.on('message', (data) => {
  console.log('Received:', data);
});

channel.on('error', (error) => {
  console.error('Channel error:', error);
});

channel.on('close', () => {
  console.log('Channel closed');
});

channel.on('bufferedAmountLow', () => {
  console.log('Buffer drained, safe to send more');
});

channel.on('queueOverflow', (droppedCount) => {
  console.warn(`Queue overflow: ${droppedCount} messages dropped`);
});
```

## Configuration Options

### Connection Configuration

```typescript
interface DurableConnectionConfig {
  maxReconnectAttempts?: number;      // default: 10
  reconnectBackoffBase?: number;      // default: 1000 (1 second)
  reconnectBackoffMax?: number;       // default: 30000 (30 seconds)
  reconnectJitter?: number;           // default: 0.2 (±20%)
  connectionTimeout?: number;         // default: 30000 (30 seconds)
  maxQueueSize?: number;              // default: 1000 messages
  maxMessageAge?: number;             // default: 60000 (1 minute)
  rtcConfig?: RTCConfiguration;
}
```

### Service Configuration

```typescript
interface DurableServiceConfig extends DurableConnectionConfig {
  username: string;
  privateKey: string;
  serviceFqn: string;
  isPublic?: boolean;                 // default: false
  metadata?: Record<string, any>;
  ttl?: number;                       // default: 300000 (5 minutes)
  ttlRefreshMargin?: number;          // default: 0.2 (refresh at 80%)
  poolSize?: number;                  // default: 1
  pollingInterval?: number;           // default: 2000 (2 seconds)
}
```

## Examples

### Chat Application

```typescript
// Server
const client = new Rondevu();
await client.register();

const claim = await client.usernames.claimUsername('alice');
client.usernames.saveKeypairToStorage('alice', claim.publicKey, claim.privateKey);
const keypair = client.usernames.loadKeypairFromStorage('alice');

const service = await client.exposeService({
  username: 'alice',
  privateKey: keypair.privateKey,
  serviceFqn: 'chat@1.0.0',
  isPublic: true,
  poolSize: 50,  // Handle 50 concurrent users
  handler: (channel, connectionId) => {
    console.log(`User ${connectionId} joined`);

    channel.on('message', (data) => {
      console.log(`[${connectionId}]: ${data}`);
      // Broadcast to all users (implement your broadcast logic)
    });

    channel.on('close', () => {
      console.log(`User ${connectionId} left`);
    });
  }
});

await service.start();

// Client
const client2 = new Rondevu();
await client2.register();

const connection = await client2.connect('alice', 'chat@1.0.0');
const channel = connection.createChannel('chat');

channel.on('message', (data) => {
  console.log('Message:', data);
});

await connection.connect();
channel.send('Hello everyone!');
```

### File Transfer with Progress

```typescript
// Server
const service = await client.exposeService({
  username: 'alice',
  privateKey: keypair.privateKey,
  serviceFqn: 'files@1.0.0',
  handler: (channel, connectionId) => {
    channel.on('message', async (data) => {
      const request = JSON.parse(data);

      if (request.action === 'download') {
        const file = await fs.readFile(request.path);
        const chunkSize = 16 * 1024; // 16KB chunks

        for (let i = 0; i < file.byteLength; i += chunkSize) {
          const chunk = file.slice(i, i + chunkSize);
          channel.send(chunk);

          // Wait for buffer to drain if needed
          while (channel.bufferedAmount > 16 * 1024 * 1024) { // 16MB
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }

        channel.send(JSON.stringify({ done: true }));
      }
    });
  }
});

await service.start();

// Client
const connection = await client.connect('alice', 'files@1.0.0');
const channel = connection.createChannel('files');

const chunks = [];
channel.on('message', (data) => {
  if (typeof data === 'string') {
    const msg = JSON.parse(data);
    if (msg.done) {
      const blob = new Blob(chunks);
      console.log('Download complete:', blob.size, 'bytes');
    }
  } else {
    chunks.push(data);
    console.log('Progress:', chunks.length * 16 * 1024, 'bytes');
  }
});

await connection.connect();
channel.send(JSON.stringify({ action: 'download', path: '/file.zip' }));
```

## Platform-Specific Setup

### Modern Browsers
Works out of the box - no additional setup needed.

### Node.js 18+
Native fetch is available, but you need WebRTC polyfills:

```bash
npm install wrtc
```

```typescript
import { Rondevu } from '@xtr-dev/rondevu-client';
import { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } from 'wrtc';

const client = new Rondevu({
  baseUrl: 'https://api.ronde.vu',
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate
});
```

### Node.js < 18
Install both fetch and WebRTC polyfills:

```bash
npm install node-fetch wrtc
```

```typescript
import { Rondevu } from '@xtr-dev/rondevu-client';
import fetch from 'node-fetch';
import { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } from 'wrtc';

const client = new Rondevu({
  baseUrl: 'https://api.ronde.vu',
  fetch: fetch as any,
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate
});
```

## TypeScript

All types are exported:

```typescript
import type {
  // Client types
  Credentials,
  RondevuOptions,

  // Username types
  UsernameCheckResult,
  UsernameClaimResult,

  // Durable connection types
  DurableConnectionState,
  DurableChannelState,
  DurableConnectionConfig,
  DurableChannelConfig,
  DurableServiceConfig,
  QueuedMessage,
  DurableConnectionEvents,
  DurableChannelEvents,
  DurableServiceEvents,
  ConnectionInfo,
  ServiceInfo
} from '@xtr-dev/rondevu-client';
```

## Migration from v0.8.x

v0.9.0 is a **breaking change** that replaces the low-level APIs with high-level durable connections. See [MIGRATION.md](./MIGRATION.md) for detailed migration guide.

**Key Changes:**
- ❌ Removed: `client.services.*`, `client.discovery.*`, `client.createPeer()` (low-level APIs)
- ✅ Added: `client.exposeService()`, `client.connect()`, `client.connectByUuid()` (durable APIs)
- ✅ Changed: Focus on durable connections with automatic reconnection and message queuing

## License

MIT
