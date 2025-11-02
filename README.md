# @rondevu/client

TypeScript client for interacting with the Rondevu peer signaling and discovery server. Provides a simple, type-safe API for WebRTC peer discovery and connection establishment.

## Installation

```bash
npm install @rondevu/client
```

## Usage

### Basic Setup

```typescript
import { RondevuClient } from '@rondevu/client';

const client = new RondevuClient({
  baseUrl: 'https://rondevu.example.com',
  // Optional: custom origin for session isolation
  origin: 'https://myapp.com'
});
```

### Peer Discovery Flow

#### 1. List Available Topics

```typescript
// Get all topics with peer counts
const { topics, pagination } = await client.listTopics();

topics.forEach(topic => {
  console.log(`${topic.topic}: ${topic.count} peers available`);
});
```

#### 2. Create an Offer (Peer A)

```typescript
// Announce availability in a topic
const { code } = await client.createOffer('my-room', {
  info: 'peer-A-unique-id',
  offer: webrtcOfferData
});

console.log('Session code:', code);
```

#### 3. Discover Peers (Peer B)

```typescript
// Find available peers in a topic
const { sessions } = await client.listSessions('my-room');

// Filter out your own sessions
const otherPeers = sessions.filter(s => s.info !== 'my-peer-id');

if (otherPeers.length > 0) {
  const peer = otherPeers[0];
  console.log('Found peer:', peer.info);
}
```

#### 4. Send Answer (Peer B)

```typescript
// Connect to a peer by answering their offer
await client.sendAnswer({
  code: peer.code,
  answer: webrtcAnswerData,
  side: 'answerer'
});
```

#### 5. Poll for Data (Both Peers)

```typescript
// Offerer polls for answer
const offererData = await client.poll(code, 'offerer');
if (offererData.answer) {
  console.log('Received answer from peer');
}

// Answerer polls for offer details
const answererData = await client.poll(code, 'answerer');
console.log('Offer candidates:', answererData.offerCandidates);
```

#### 6. Exchange ICE Candidates

```typescript
// Send additional signaling data
await client.sendAnswer({
  code: sessionCode,
  candidate: iceCandidate,
  side: 'offerer' // or 'answerer'
});
```

### Health Check

```typescript
const health = await client.health();
console.log('Server status:', health.status);
console.log('Timestamp:', health.timestamp);
```

## API Reference

### `RondevuClient`

#### Constructor

```typescript
new RondevuClient(options: RondevuClientOptions)
```

**Options:**
- `baseUrl` (string, required): Base URL of the Rondevu server
- `origin` (string, optional): Origin header for session isolation (defaults to baseUrl origin)
- `fetch` (function, optional): Custom fetch implementation (for Node.js)

#### Methods

##### `listTopics(page?, limit?)`

Lists all topics with peer counts.

**Parameters:**
- `page` (number, optional): Page number, default 1
- `limit` (number, optional): Results per page, default 100, max 1000

**Returns:** `Promise<ListTopicsResponse>`

##### `listSessions(topic)`

Discovers available peers for a given topic.

**Parameters:**
- `topic` (string): Topic identifier

**Returns:** `Promise<ListSessionsResponse>`

##### `createOffer(topic, request)`

Announces peer availability and creates a new session.

**Parameters:**
- `topic` (string): Topic identifier (max 256 characters)
- `request` (CreateOfferRequest):
  - `info` (string): Peer identifier/metadata (max 1024 characters)
  - `offer` (string): WebRTC signaling data

**Returns:** `Promise<CreateOfferResponse>`

##### `sendAnswer(request)`

Sends an answer or candidate to an existing session.

**Parameters:**
- `request` (AnswerRequest):
  - `code` (string): Session UUID
  - `answer` (string, optional): Answer signaling data
  - `candidate` (string, optional): ICE candidate data
  - `side` ('offerer' | 'answerer'): Which peer is sending

**Returns:** `Promise<AnswerResponse>`

##### `poll(code, side)`

Polls for session data from the other peer.

**Parameters:**
- `code` (string): Session UUID
- `side` ('offerer' | 'answerer'): Which side is polling

**Returns:** `Promise<PollOffererResponse | PollAnswererResponse>`

##### `health()`

Checks server health.

**Returns:** `Promise<HealthResponse>`

## TypeScript Types

All types are exported from the main package:

```typescript
import {
  RondevuClient,
  Session,
  TopicInfo,
  CreateOfferRequest,
  AnswerRequest,
  PollRequest,
  Side,
  // ... and more
} from '@rondevu/client';
```

## Node.js Usage

For Node.js environments (v18+), the built-in fetch is used automatically. For older Node.js versions, provide a fetch implementation:

```typescript
import fetch from 'node-fetch';
import { RondevuClient } from '@rondevu/client';

const client = new RondevuClient({
  baseUrl: 'https://rondevu.example.com',
  fetch: fetch as any
});
```

## Error Handling

All API methods throw errors with descriptive messages:

```typescript
try {
  await client.createOffer('my-room', {
    info: 'peer-id',
    offer: data
  });
} catch (error) {
  console.error('Failed to create offer:', error.message);
}
```

## License

MIT
