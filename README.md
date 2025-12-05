# Rondevu Client

[![npm version](https://img.shields.io/npm/v/@xtr-dev/rondevu-client)](https://www.npmjs.com/package/@xtr-dev/rondevu-client)

🌐 **DNS-like WebRTC client with username claiming and service discovery**

TypeScript/JavaScript client for Rondevu, providing cryptographic username claiming, service publishing, and privacy-preserving discovery.

**Related repositories:**
- [@xtr-dev/rondevu-client](https://github.com/xtr-dev/rondevu-client) - TypeScript client library ([npm](https://www.npmjs.com/package/@xtr-dev/rondevu-client))
- [@xtr-dev/rondevu-server](https://github.com/xtr-dev/rondevu-server) - HTTP signaling server ([npm](https://www.npmjs.com/package/@xtr-dev/rondevu-server), [live](https://api.ronde.vu))
- [@xtr-dev/rondevu-demo](https://github.com/xtr-dev/rondevu-demo) - Interactive demo ([live](https://ronde.vu))

---

## Features

- **Username Claiming**: Cryptographic ownership with Ed25519 signatures
- **Service Publishing**: Package-style naming (com.example.chat@1.0.0)
- **Privacy-Preserving Discovery**: UUID-based service index
- **Public/Private Services**: Control service visibility
- **Complete WebRTC Signaling**: Full offer/answer and ICE candidate exchange
- **Trickle ICE**: Send ICE candidates as they're discovered
- **TypeScript**: Full type safety and autocomplete

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

console.log(`Username claimed: ${claim.username}`);
console.log(`Expires: ${new Date(claim.expiresAt)}`);

// Step 2: Expose service with handler
const keypair = client.usernames.loadKeypairFromStorage('alice');

const handle = await client.services.exposeService({
  username: 'alice',
  privateKey: keypair.privateKey,
  serviceFqn: 'com.example.chat@1.0.0',
  isPublic: true,
  handler: (channel, peer) => {
    console.log('📡 New connection established');

    channel.onmessage = (e) => {
      console.log('📥 Received:', e.data);
      channel.send(`Echo: ${e.data}`);
    };

    channel.onopen = () => {
      console.log('✅ Data channel open');
    };
  }
});

console.log(`Service published with UUID: ${handle.uuid}`);
console.log('Waiting for connections...');

// Later: unpublish
await handle.unpublish();
```

### Connecting to a Service (Bob)

```typescript
import { Rondevu } from '@xtr-dev/rondevu-client';

// Initialize client and register
const client = new Rondevu({ baseUrl: 'https://api.ronde.vu' });
await client.register();

// Option 1: Connect by username + FQN
const { peer, channel } = await client.discovery.connect(
  'alice',
  'com.example.chat@1.0.0'
);

channel.onmessage = (e) => {
  console.log('📥 Received:', e.data);
};

channel.onopen = () => {
  console.log('✅ Connected!');
  channel.send('Hello Alice!');
};

peer.on('connected', () => {
  console.log('🎉 WebRTC connection established');
});

peer.on('failed', (error) => {
  console.error('❌ Connection failed:', error);
});

// Option 2: List services first, then connect
const services = await client.discovery.listServices('alice');
console.log(`Found ${services.services.length} services`);

for (const service of services.services) {
  console.log(`- UUID: ${service.uuid}`);
  if (service.isPublic) {
    console.log(`  FQN: ${service.serviceFqn}`);
  }
}

// Connect by UUID
const { peer: peer2, channel: channel2 } = await client.discovery.connectByUuid(
  services.services[0].uuid
);
```

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

// Claim with existing keypair
const keypair = await client.usernames.generateKeypair();
const claim2 = await client.usernames.claimUsername('bob', keypair);

// Save keypair to localStorage
client.usernames.saveKeypairToStorage('alice', publicKey, privateKey);

// Load keypair from localStorage
const stored = client.usernames.loadKeypairFromStorage('alice');
// { publicKey, privateKey } | null

// Export keypair for backup
const exported = client.usernames.exportKeypair('alice');
// { username, publicKey, privateKey }

// Import keypair from backup
client.usernames.importKeypair({ username: 'alice', publicKey, privateKey });

// Low-level: Generate keypair
const { publicKey, privateKey } = await client.usernames.generateKeypair();

// Low-level: Sign message
const signature = await client.usernames.signMessage(
  'claim:alice:1234567890',
  privateKey
);

// Low-level: Verify signature
const valid = await client.usernames.verifySignature(
  'claim:alice:1234567890',
  signature,
  publicKey
);
```

**Username Rules:**
- Format: Lowercase alphanumeric + dash (`a-z`, `0-9`, `-`)
- Length: 3-32 characters
- Pattern: `^[a-z0-9][a-z0-9-]*[a-z0-9]$`
- Validity: 365 days from claim/last use
- Ownership: Secured by Ed25519 public key

### Services API

```typescript
// Publish service (returns UUID)
const service = await client.services.publishService({
  username: 'alice',
  privateKey: keypair.privateKey,
  serviceFqn: 'com.example.chat@1.0.0',
  isPublic: false,              // optional, default false
  metadata: { description: '...' },  // optional
  ttl: 5 * 60 * 1000,           // optional, default 5 minutes
  rtcConfig: { ... }            // optional RTCConfiguration
});
// { serviceId, uuid, offerId, expiresAt }

console.log(`Service UUID: ${service.uuid}`);
console.log('Share this UUID to allow connections');

// Expose service with automatic connection handling
const handle = await client.services.exposeService({
  username: 'alice',
  privateKey: keypair.privateKey,
  serviceFqn: 'com.example.echo@1.0.0',
  isPublic: true,
  handler: (channel, peer) => {
    channel.onmessage = (e) => {
      console.log('Received:', e.data);
      channel.send(`Echo: ${e.data}`);
    };
  }
});

// Later: unpublish
await handle.unpublish();

// Unpublish service manually
await client.services.unpublishService(serviceId, username);
```

#### Multi-Connection Service Hosting (Offer Pooling)

By default, `exposeService()` creates a single offer and can only accept one connection. To handle multiple concurrent connections, use the `poolSize` option to enable **offer pooling**:

```typescript
// Expose service with offer pooling for multiple concurrent connections
const handle = await client.services.exposeService({
  username: 'alice',
  privateKey: keypair.privateKey,
  serviceFqn: 'com.example.chat@1.0.0',
  isPublic: true,
  poolSize: 5,  // Maintain 5 simultaneous open offers
  pollingInterval: 2000,  // Optional: polling interval in ms (default: 2000)
  handler: (channel, peer, connectionId) => {
    console.log(`📡 New connection: ${connectionId}`);

    channel.onmessage = (e) => {
      console.log(`📥 [${connectionId}] Received:`, e.data);
      channel.send(`Echo: ${e.data}`);
    };

    channel.onclose = () => {
      console.log(`👋 [${connectionId}] Connection closed`);
    };
  },
  onPoolStatus: (status) => {
    console.log('Pool status:', {
      activeOffers: status.activeOffers,
      activeConnections: status.activeConnections,
      totalHandled: status.totalConnectionsHandled
    });
  },
  onError: (error, context) => {
    console.error(`Pool error (${context}):`, error);
  }
});

// Get current pool status
const status = handle.getStatus();
console.log(`Active offers: ${status.activeOffers}`);
console.log(`Active connections: ${status.activeConnections}`);

// Manually add more offers if needed
await handle.addOffers(3);
```

**How Offer Pooling Works:**
1. The pool maintains `poolSize` simultaneous open offers at all times
2. When an offer is answered (connection established), a new offer is automatically created
3. Polling checks for answers every `pollingInterval` milliseconds (default: 2000ms)
4. Each connection gets a unique `connectionId` passed to the handler
5. No limit on total concurrent connections - only pool size (open offers) is controlled

**Use Cases:**
- Chat servers handling multiple clients
- File sharing services with concurrent downloads
- Multiplayer game lobbies
- Collaborative editing sessions
- Any service that needs to accept multiple simultaneous connections

**Pool Status Interface:**
```typescript
interface PoolStatus {
  activeOffers: number;          // Current number of open offers
  activeConnections: number;     // Current number of connected peers
  totalConnectionsHandled: number;  // Total connections since start
  failedOfferCreations: number;  // Failed offer creation attempts
}
```

**Pooled Service Handle:**
```typescript
interface PooledServiceHandle extends ServiceHandle {
  getStatus: () => PoolStatus;        // Get current pool status
  addOffers: (count: number) => Promise<void>;  // Manually add offers
}
```

**Service FQN Format:**
- Service name: Reverse domain notation (e.g., `com.example.chat`)
- Version: Semantic versioning (e.g., `1.0.0`, `2.1.3-beta`)
- Complete FQN: `service-name@version`
- Examples: `com.example.chat@1.0.0`, `io.github.alice.notes@0.1.0-beta`

**Validation Rules:**
- Service name pattern: `^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$`
- Length: 3-128 characters
- Minimum 2 components (at least one dot)
- Version pattern: `^[0-9]+\.[0-9]+\.[0-9]+(-[a-z0-9.-]+)?$`

### Discovery API

```typescript
// List all services for a username
const services = await client.discovery.listServices('alice');
// {
//   username: 'alice',
//   services: [
//     { uuid: 'abc123', isPublic: false },
//     { uuid: 'def456', isPublic: true, serviceFqn: '...', metadata: {...} }
//   ]
// }

// Query service by FQN
const query = await client.discovery.queryService('alice', 'com.example.chat@1.0.0');
// { uuid: 'abc123', allowed: true }

// Get service details by UUID
const details = await client.discovery.getServiceDetails('abc123');
// { serviceId, username, serviceFqn, offerId, sdp, isPublic, metadata, ... }

// Connect to service by UUID
const peer = await client.discovery.connectToService('abc123', {
  rtcConfig: { ... },           // optional
  onConnected: () => { ... },   // optional
  onData: (data) => { ... }     // optional
});

// Connect by username + FQN (convenience method)
const { peer, channel } = await client.discovery.connect(
  'alice',
  'com.example.chat@1.0.0',
  { rtcConfig: { ... } }  // optional
);

// Connect by UUID with channel
const { peer, channel } = await client.discovery.connectByUuid('abc123');
```

### Low-Level Peer Connection

```typescript
// Create peer connection
const peer = client.createPeer({
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: 'turn:turn.example.com:3478',
      username: 'user',
      credential: 'pass'
    }
  ],
  iceTransportPolicy: 'relay'  // optional: force TURN relay
});

// Event listeners
peer.on('state', (state) => {
  console.log('Peer state:', state);
});

peer.on('connected', () => {
  console.log('✅ Connected');
});

peer.on('disconnected', () => {
  console.log('🔌 Disconnected');
});

peer.on('failed', (error) => {
  console.error('❌ Failed:', error);
});

peer.on('datachannel', (channel) => {
  console.log('📡 Data channel ready');
});

peer.on('track', (event) => {
  // Media track received
  const stream = event.streams[0];
  videoElement.srcObject = stream;
});

// Create offer
const offerId = await peer.createOffer({
  ttl: 300000,  // optional
  timeouts: {   // optional
    iceGathering: 10000,
    waitingForAnswer: 30000,
    creatingAnswer: 10000,
    iceConnection: 30000
  }
});

// Answer offer
await peer.answer(offerId, sdp);

// Add media tracks
const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
stream.getTracks().forEach(track => {
  peer.addTrack(track, stream);
});

// Close connection
await peer.close();

// Properties
peer.stateName;        // 'idle', 'creating-offer', 'connected', etc.
peer.connectionState;  // RTCPeerConnectionState
peer.offerId;          // string | undefined
peer.role;             // 'offerer' | 'answerer' | undefined
```

## Connection Lifecycle

### Service Publisher (Offerer)
1. **idle** - Initial state
2. **creating-offer** - Creating WebRTC offer
3. **waiting-for-answer** - Polling for answer from peer
4. **exchanging-ice** - Exchanging ICE candidates
5. **connected** - Successfully connected
6. **failed** - Connection failed
7. **closed** - Connection closed

### Service Consumer (Answerer)
1. **idle** - Initial state
2. **answering** - Creating WebRTC answer
3. **exchanging-ice** - Exchanging ICE candidates
4. **connected** - Successfully connected
5. **failed** - Connection failed
6. **closed** - Connection closed

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

### Deno
```typescript
import { Rondevu } from 'npm:@xtr-dev/rondevu-client';

const client = new Rondevu({
  baseUrl: 'https://api.ronde.vu'
});
```

### Bun
Works out of the box - no additional setup needed.

### Cloudflare Workers
```typescript
import { Rondevu } from '@xtr-dev/rondevu-client';

export default {
  async fetch(request: Request, env: Env) {
    const client = new Rondevu({
      baseUrl: 'https://api.ronde.vu'
    });

    const creds = await client.register();
    return new Response(JSON.stringify(creds));
  }
};
```

## Examples

### Echo Service

```typescript
// Publisher
const client1 = new Rondevu();
await client1.register();

const claim = await client1.usernames.claimUsername('alice');
client1.usernames.saveKeypairToStorage('alice', claim.publicKey, claim.privateKey);

const keypair = client1.usernames.loadKeypairFromStorage('alice');

await client1.services.exposeService({
  username: 'alice',
  privateKey: keypair.privateKey,
  serviceFqn: 'com.example.echo@1.0.0',
  isPublic: true,
  handler: (channel, peer) => {
    channel.onmessage = (e) => {
      console.log('Received:', e.data);
      channel.send(`Echo: ${e.data}`);
    };
  }
});

// Consumer
const client2 = new Rondevu();
await client2.register();

const { peer, channel } = await client2.discovery.connect(
  'alice',
  'com.example.echo@1.0.0'
);

channel.onmessage = (e) => console.log('Received:', e.data);
channel.send('Hello!');
```

### File Transfer Service

```typescript
// Publisher
await client.services.exposeService({
  username: 'alice',
  privateKey: keypair.privateKey,
  serviceFqn: 'com.example.files@1.0.0',
  isPublic: false,
  handler: (channel, peer) => {
    channel.binaryType = 'arraybuffer';

    channel.onmessage = (e) => {
      if (typeof e.data === 'string') {
        console.log('Request:', JSON.parse(e.data));
      } else {
        console.log('Received file chunk:', e.data.byteLength, 'bytes');
      }
    };
  }
});

// Consumer
const { peer, channel } = await client.discovery.connect(
  'alice',
  'com.example.files@1.0.0'
);

channel.binaryType = 'arraybuffer';

// Request file
channel.send(JSON.stringify({ action: 'get', path: '/readme.txt' }));

channel.onmessage = (e) => {
  if (e.data instanceof ArrayBuffer) {
    console.log('Received file:', e.data.byteLength, 'bytes');
  }
};
```

### Video Chat Service

```typescript
// Publisher
const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

const peer = client.createPeer();
stream.getTracks().forEach(track => peer.addTrack(track, stream));

const offerId = await peer.createOffer({ ttl: 300000 });

await client.services.publishService({
  username: 'alice',
  privateKey: keypair.privateKey,
  serviceFqn: 'com.example.videochat@1.0.0',
  isPublic: true
});

// Consumer
const { peer, channel } = await client.discovery.connect(
  'alice',
  'com.example.videochat@1.0.0'
);

peer.on('track', (event) => {
  const remoteStream = event.streams[0];
  videoElement.srcObject = remoteStream;
});
```

## TypeScript

All types are exported:

```typescript
import type {
  Credentials,
  RondevuOptions,

  // Username types
  UsernameCheckResult,
  UsernameClaimResult,
  Keypair,

  // Service types
  ServicePublishResult,
  PublishServiceOptions,
  ServiceHandle,

  // Discovery types
  ServiceInfo,
  ServiceListResult,
  ServiceQueryResult,
  ServiceDetails,
  ConnectResult,

  // Peer types
  PeerOptions,
  PeerEvents,
  PeerTimeouts
} from '@xtr-dev/rondevu-client';
```

## Migration from V1

V2 is a **breaking change** that replaces topic-based discovery with username claiming and service publishing. See the main [MIGRATION.md](../MIGRATION.md) for detailed migration guide.

**Key Changes:**
- ❌ Removed: `offers.findByTopic()`, `offers.getTopics()`, bloom filters
- ✅ Added: `usernames.*`, `services.*`, `discovery.*` APIs
- ✅ Changed: Focus on service-based discovery instead of topics

## License

MIT
