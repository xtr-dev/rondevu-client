# @xtr-dev/rondevu-client

[![npm version](https://img.shields.io/npm/v/@xtr-dev/rondevu-client)](https://www.npmjs.com/package/@xtr-dev/rondevu-client)

🌐 **Topic-based peer discovery and WebRTC signaling client**

TypeScript/JavaScript client for Rondevu, providing topic-based peer discovery, stateless authentication, and complete WebRTC signaling with trickle ICE support.

**Related repositories:**
- [rondevu-server](https://github.com/xtr-dev/rondevu-server) - HTTP signaling server
- [rondevu-demo](https://rondevu-demo.pages.dev) - Interactive demo

---

## Features

- **Topic-Based Discovery**: Find peers by topics (e.g., torrent infohashes)
- **Stateless Authentication**: No server-side sessions, portable credentials
- **Bloom Filters**: Efficient peer exclusion for repeated discoveries
- **Multi-Offer Management**: Create and manage multiple offers per peer
- **Complete WebRTC Signaling**: Full offer/answer and ICE candidate exchange
- **Trickle ICE**: Send ICE candidates as they're discovered (faster connections)
- **State Machine**: Clean state-based connection lifecycle
- **TypeScript**: Full type safety and autocomplete

## Install

```bash
npm install @xtr-dev/rondevu-client
```

## Quick Start

### Creating an Offer (Peer A)

```typescript
import { Rondevu } from '@xtr-dev/rondevu-client';

// Initialize client and register
const client = new Rondevu({ baseUrl: 'https://api.ronde.vu' });
await client.register();

// Create peer connection
const peer = client.createPeer();

// Set up event listeners
peer.on('state', (state) => {
  console.log('Peer state:', state);
  // States: idle → creating-offer → waiting-for-answer → exchanging-ice → connected
});

peer.on('connected', () => {
  console.log('✅ Connected to peer!');
});

peer.on('datachannel', (channel) => {
  console.log('📡 Data channel ready');

  channel.addEventListener('message', (event) => {
    console.log('📥 Received:', event.data);
  });

  channel.addEventListener('open', () => {
    channel.send('Hello from peer A!');
  });
});

// Create offer and advertise on topics
const offerId = await peer.createOffer({
  topics: ['my-app', 'room-123'],
  ttl: 300000  // 5 minutes
});

console.log('Offer created:', offerId);
console.log('Share these topics with peers:', ['my-app', 'room-123']);
```

### Answering an Offer (Peer B)

```typescript
import { Rondevu } from '@xtr-dev/rondevu-client';

// Initialize client and register
const client = new Rondevu({ baseUrl: 'https://api.ronde.vu' });
await client.register();

// Discover offers by topic
const offers = await client.offers.findByTopic('my-app', { limit: 10 });

if (offers.length > 0) {
  const offer = offers[0];

  // Create peer connection
  const peer = client.createPeer();

  // Set up event listeners
  peer.on('state', (state) => {
    console.log('Peer state:', state);
    // States: idle → answering → exchanging-ice → connected
  });

  peer.on('connected', () => {
    console.log('✅ Connected!');
  });

  peer.on('datachannel', (channel) => {
    console.log('📡 Data channel ready');

    channel.addEventListener('message', (event) => {
      console.log('📥 Received:', event.data);
    });

    channel.addEventListener('open', () => {
      channel.send('Hello from peer B!');
    });
  });

  peer.on('failed', (error) => {
    console.error('❌ Connection failed:', error);
  });

  // Answer the offer
  await peer.answer(offer.id, offer.sdp, {
    topics: offer.topics
  });
}
```

## Connection Lifecycle

The `RondevuPeer` uses a state machine for connection management:

### Offerer States
1. **idle** - Initial state
2. **creating-offer** - Creating WebRTC offer
3. **waiting-for-answer** - Polling for answer from peer
4. **exchanging-ice** - Exchanging ICE candidates
5. **connected** - Successfully connected
6. **failed** - Connection failed
7. **closed** - Connection closed

### Answerer States
1. **idle** - Initial state
2. **answering** - Creating WebRTC answer
3. **exchanging-ice** - Exchanging ICE candidates
4. **connected** - Successfully connected
5. **failed** - Connection failed
6. **closed** - Connection closed

### State Events

```typescript
peer.on('state', (stateName) => {
  console.log('Current state:', stateName);
});

peer.on('connected', () => {
  // Connection established successfully
});

peer.on('disconnected', () => {
  // Connection lost or closed
});

peer.on('failed', (error) => {
  // Connection failed
  console.error('Connection error:', error);
});

peer.on('datachannel', (channel) => {
  // Data channel is ready (use channel.addEventListener)
});

peer.on('track', (event) => {
  // Media track received (for audio/video streaming)
  const stream = event.streams[0];
  videoElement.srcObject = stream;
});
```

## Trickle ICE

This library implements **trickle ICE** for faster connection establishment:

- ICE candidates are sent to the server as they're discovered
- No waiting for all candidates before sending offer/answer
- Connections establish much faster (milliseconds vs seconds)
- Proper event listener cleanup to prevent memory leaks

## Adding Media Tracks

```typescript
// Get user's camera/microphone
const stream = await navigator.mediaDevices.getUserMedia({
  video: true,
  audio: true
});

// Add tracks to peer connection
stream.getTracks().forEach(track => {
  peer.addTrack(track, stream);
});
```

## Peer Properties

```typescript
// Get current state name
console.log(peer.stateName); // 'idle', 'creating-offer', 'connected', etc.

// Get connection state
console.log(peer.connectionState); // RTCPeerConnectionState

// Get offer ID (after creating offer or answering)
console.log(peer.offerId);

// Get role
console.log(peer.role); // 'offerer' or 'answerer'
```

## Closing a Connection

```typescript
await peer.close();
```

## Custom RTCConfiguration

```typescript
const peer = client.createPeer({
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: 'turn:turn.example.com:3478',
      username: 'user',
      credential: 'pass'
    }
  ],
  iceTransportPolicy: 'relay' // Force TURN relay (useful for testing)
});
```

## Timeouts

Configure connection timeouts:

```typescript
await peer.createOffer({
  topics: ['my-topic'],
  timeouts: {
    iceGathering: 10000,        // ICE gathering timeout (10s)
    waitingForAnswer: 30000,    // Waiting for answer timeout (30s)
    creatingAnswer: 10000,      // Creating answer timeout (10s)
    iceConnection: 30000        // ICE connection timeout (30s)
  }
});
```

## Platform-Specific Setup

### Node.js 18+ (with native fetch)

Works out of the box - no additional setup needed.

### Node.js < 18 (without native fetch)

Install node-fetch and provide it to the client:

```bash
npm install node-fetch
```

```typescript
import { Rondevu } from '@xtr-dev/rondevu-client';
import fetch from 'node-fetch';

const client = new Rondevu({
  baseUrl: 'https://api.ronde.vu',
  fetch: fetch as any
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

## Low-Level API Usage

For direct control over the signaling process without WebRTC:

```typescript
import { Rondevu, BloomFilter } from '@xtr-dev/rondevu-client';

const client = new Rondevu({ baseUrl: 'https://api.ronde.vu' });

// Register and get credentials
const creds = await client.register();
console.log('Peer ID:', creds.peerId);

// Save credentials for later use
localStorage.setItem('rondevu-creds', JSON.stringify(creds));

// Create offer with topics
const offers = await client.offers.create([{
  sdp: 'v=0...',  // Your WebRTC offer SDP
  topics: ['movie-xyz', 'hd-content'],
  ttl: 300000  // 5 minutes
}]);

// Discover peers by topic
const discovered = await client.offers.findByTopic('movie-xyz', {
  limit: 50
});

console.log(`Found ${discovered.length} peers`);

// Use bloom filter to exclude known peers
const knownPeers = new Set(['peer-id-1', 'peer-id-2']);
const bloom = new BloomFilter(1024, 3);
knownPeers.forEach(id => bloom.add(id));

const newPeers = await client.offers.findByTopic('movie-xyz', {
  bloomFilter: bloom.toBytes(),
  limit: 50
});
```

## API Reference

### Authentication

#### `client.register()`
Register a new peer and receive credentials.

```typescript
const creds = await client.register();
// { peerId: '...', secret: '...' }
```

### Topics

#### `client.offers.getTopics(options?)`
List all topics with active peer counts (paginated).

```typescript
const result = await client.offers.getTopics({
  limit: 50,
  offset: 0
});

// {
//   topics: [
//     { topic: 'movie-xyz', activePeers: 42 },
//     { topic: 'torrent-abc', activePeers: 15 }
//   ],
//   total: 123,
//   limit: 50,
//   offset: 0
// }
```

### Offers

#### `client.offers.create(offers)`
Create one or more offers with topics.

```typescript
const offers = await client.offers.create([
  {
    sdp: 'v=0...',
    topics: ['topic-1', 'topic-2'],
    ttl: 300000  // optional, default 5 minutes
  }
]);
```

#### `client.offers.findByTopic(topic, options?)`
Find offers by topic with optional bloom filter.

```typescript
const offers = await client.offers.findByTopic('movie-xyz', {
  limit: 50,
  bloomFilter: bloomBytes  // optional
});
```

#### `client.offers.getMine()`
Get all offers owned by the authenticated peer.

```typescript
const myOffers = await client.offers.getMine();
```

#### `client.offers.delete(offerId)`
Delete a specific offer.

```typescript
await client.offers.delete(offerId);
```

#### `client.offers.answer(offerId, sdp)`
Answer an offer (locks it to answerer).

```typescript
await client.offers.answer(offerId, answerSdp);
```

#### `client.offers.getAnswers()`
Poll for answers to your offers.

```typescript
const answers = await client.offers.getAnswers();
```

### ICE Candidates

#### `client.offers.addIceCandidates(offerId, candidates)`
Post ICE candidates for an offer.

```typescript
await client.offers.addIceCandidates(offerId, [
  { candidate: 'candidate:1 1 UDP...', sdpMid: '0', sdpMLineIndex: 0 }
]);
```

#### `client.offers.getIceCandidates(offerId, since?)`
Get ICE candidates from the other peer.

```typescript
const candidates = await client.offers.getIceCandidates(offerId, since);
```

### Bloom Filter

```typescript
import { BloomFilter } from '@xtr-dev/rondevu-client';

// Create filter: size=1024 bits, hash=3 functions
const bloom = new BloomFilter(1024, 3);

// Add items
bloom.add('peer-id-1');
bloom.add('peer-id-2');

// Test membership
bloom.test('peer-id-1');  // true (probably)
bloom.test('unknown');    // false (definitely)

// Export for API
const bytes = bloom.toBytes();
```

## TypeScript

All types are exported:

```typescript
import type {
  Credentials,
  Offer,
  CreateOfferRequest,
  TopicInfo,
  IceCandidate,
  FetchFunction,
  RondevuOptions,
  PeerOptions,
  PeerEvents,
  PeerTimeouts
} from '@xtr-dev/rondevu-client';
```

## Environment Compatibility

The client library is designed to work across different JavaScript runtimes:

| Environment | Native Fetch | Custom Fetch Needed |
|-------------|--------------|---------------------|
| Modern Browsers | ✅ Yes | ❌ No |
| Node.js 18+ | ✅ Yes | ❌ No |
| Node.js < 18 | ❌ No | ✅ Yes (node-fetch) |
| Deno | ✅ Yes | ❌ No |
| Bun | ✅ Yes | ❌ No |
| Cloudflare Workers | ✅ Yes | ❌ No |

**If your environment doesn't have native fetch:**

```bash
npm install node-fetch
```

```typescript
import { Rondevu } from '@xtr-dev/rondevu-client';
import fetch from 'node-fetch';

const client = new Rondevu({
  baseUrl: 'https://rondevu.xtrdev.workers.dev',
  fetch: fetch as any
});
```

## License

MIT
