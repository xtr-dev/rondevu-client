# @xtr-dev/rondevu-client

[![npm version](https://img.shields.io/npm/v/@xtr-dev/rondevu-client)](https://www.npmjs.com/package/@xtr-dev/rondevu-client)

🌐 **Topic-based peer discovery and WebRTC signaling client**

TypeScript/JavaScript client for Rondevu, providing topic-based peer discovery, stateless authentication, and complete WebRTC signaling.

**Related repositories:**
- [rondevu-server](https://github.com/xtr-dev/rondevu) - HTTP signaling server
- [rondevu-demo](https://rondevu-demo.pages.dev) - Interactive demo

---

## Features

- **Topic-Based Discovery**: Find peers by topics (e.g., torrent infohashes)
- **Stateless Authentication**: No server-side sessions, portable credentials
- **Bloom Filters**: Efficient peer exclusion for repeated discoveries
- **Multi-Offer Management**: Create and manage multiple offers per peer
- **Complete WebRTC Signaling**: Full offer/answer and ICE candidate exchange
- **TypeScript**: Full type safety and autocomplete

## Install

```bash
npm install @xtr-dev/rondevu-client
```

## Quick Start

The easiest way to use Rondevu is with the high-level `RondevuConnection` class, which handles all WebRTC connection complexity including offer/answer exchange, ICE candidates, and connection lifecycle.

### Creating an Offer (Peer A)

```typescript
import { Rondevu } from '@xtr-dev/rondevu-client';

const client = new Rondevu({ baseUrl: 'https://api.ronde.vu' });
await client.register();

// Create a connection
const conn = client.createConnection();

// Set up event listeners
conn.on('connected', () => {
  console.log('Connected to peer!');
});

conn.on('datachannel', (channel) => {
  console.log('Data channel ready');

  channel.onmessage = (event) => {
    console.log('Received:', event.data);
  };

  channel.send('Hello from peer A!');
});

// Create offer and advertise on topics
const offerId = await conn.createOffer({
  topics: ['my-app', 'room-123'],
  ttl: 300000  // 5 minutes
});

console.log('Offer created:', offerId);
console.log('Share these topics with peers:', ['my-app', 'room-123']);
```

### Answering an Offer (Peer B)

```typescript
import { Rondevu } from '@xtr-dev/rondevu-client';

const client = new Rondevu({ baseUrl: 'https://api.ronde.vu' });
await client.register();

// Discover offers by topic
const offers = await client.offers.findByTopic('my-app', { limit: 10 });

if (offers.length > 0) {
  const offer = offers[0];

  // Create connection
  const conn = client.createConnection();

  // Set up event listeners
  conn.on('connecting', () => {
    console.log('Connecting...');
  });

  conn.on('connected', () => {
    console.log('Connected!');
  });

  conn.on('datachannel', (channel) => {
    console.log('Data channel ready');

    channel.onmessage = (event) => {
      console.log('Received:', event.data);
    };

    channel.send('Hello from peer B!');
  });

  // Answer the offer
  await conn.answer(offer.id, offer.sdp);
}
```

### Connection Events

```typescript
conn.on('connecting', () => {
  // Connection is being established
});

conn.on('connected', () => {
  // Connection established successfully
});

conn.on('disconnected', () => {
  // Connection lost or closed
});

conn.on('error', (error) => {
  // An error occurred
  console.error('Connection error:', error);
});

conn.on('datachannel', (channel) => {
  // Data channel is ready to use
});

conn.on('track', (event) => {
  // Media track received (for audio/video streaming)
  const stream = event.streams[0];
  videoElement.srcObject = stream;
});
```

### Adding Media Tracks

```typescript
// Get user's camera/microphone
const stream = await navigator.mediaDevices.getUserMedia({
  video: true,
  audio: true
});

// Add tracks to connection
stream.getTracks().forEach(track => {
  conn.addTrack(track, stream);
});
```

### Connection Properties

```typescript
// Get connection state
console.log(conn.connectionState); // 'connecting', 'connected', 'disconnected', etc.

// Get offer ID
console.log(conn.id);

// Get data channel
console.log(conn.channel);
```

### Closing a Connection

```typescript
conn.close();
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

For advanced use cases where you need direct control over the signaling process, you can use the low-level API:

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

#### `client.offers.heartbeat(offerId)`
Update last_seen timestamp for an offer.

```typescript
await client.offers.heartbeat(offerId);
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
  'candidate:1 1 UDP...'
]);
```

#### `client.offers.getIceCandidates(offerId, since?)`
Get ICE candidates from the other peer.

```typescript
const candidates = await client.offers.getIceCandidates(offerId);
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
  ConnectionOptions,
  RondevuConnectionEvents
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
