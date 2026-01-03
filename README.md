# Rondevu Client

[![npm version](https://img.shields.io/npm/v/@xtr-dev/rondevu-client)](https://www.npmjs.com/package/@xtr-dev/rondevu-client)

**WebRTC signaling client with durable connections**

TypeScript/JavaScript client for Rondevu, providing WebRTC signaling with **automatic reconnection**, **message buffering**, tags-based discovery, and efficient batch polling.

**Related repositories:**
- [@xtr-dev/rondevu-client](https://github.com/xtr-dev/rondevu-client) - TypeScript client library ([npm](https://www.npmjs.com/package/@xtr-dev/rondevu-client))
- [@xtr-dev/rondevu-server](https://github.com/xtr-dev/rondevu-server) - HTTP signaling server ([npm](https://www.npmjs.com/package/@xtr-dev/rondevu-server), [live](https://api.ronde.vu))
- [@xtr-dev/rondevu-demo](https://github.com/xtr-dev/rondevu-demo) - Interactive demo ([live](https://ronde.vu))

---

## Features

- **Simple Peer API**: Connect to peers with `rondevu.peer({ tags, username })`
- **Tags-Based Discovery**: Find peers using tags (e.g., `["chat", "video"]`)
- **Automatic Reconnection**: Built-in exponential backoff for failed connections
- **Message Buffering**: Queues messages during disconnections, replays on reconnect
- **TypeScript**: Full type safety and autocomplete
- **Credential Management**: Auto-generated or reusable credentials

## Installation

```bash
npm install @xtr-dev/rondevu-client
```

## Quick Start

### Credentials

Credentials are auto-generated on first connect, or you can claim a custom username:

```typescript
import { Rondevu } from '@xtr-dev/rondevu-client'

// Auto-generated username
const rondevu = await Rondevu.connect({ iceServers: 'ipv4-turn' })
// rondevu.getName() === 'friendly-panda-a1b2c3'

// Or claim a custom username (4-32 chars, lowercase alphanumeric + dashes + periods)
const rondevu = await Rondevu.connect({
  username: 'alice',
  iceServers: 'ipv4-turn'
})
// rondevu.getName() === 'alice'

// Get credential to save for later
const credential = rondevu.getCredential()
localStorage.setItem('rondevu-credential', JSON.stringify(credential))

// Load saved credential
const saved = JSON.parse(localStorage.getItem('rondevu-credential'))
const rondevu = await Rondevu.connect({
  credential: saved,
  iceServers: 'ipv4-turn'
})
```

### Connecting Peers

Two users who know each other's usernames can connect directly:

```typescript
import { Rondevu } from '@xtr-dev/rondevu-client'

// ============================================
// ALICE: Host offers and wait for Bob
// ============================================

const alice = await Rondevu.connect({
  credential: aliceCredential,  // Saved credential with known username
  iceServers: 'ipv4-turn'
})
// alice.getName() === 'alice-a1b2c3'

await alice.offer({ tags: ['chat'], maxOffers: 5 })
await alice.startFilling()

alice.on('connection:opened', (offerId, connection) => {
  console.log('Alice: connected to', connection.peerUsername)

  connection.on('message', (data) => {
    console.log('Alice received:', data)
  })

  connection.send('Hello Bob!')
})

// ============================================
// BOB: Connect directly to Alice by username
// ============================================

const bob = await Rondevu.connect({ iceServers: 'ipv4-turn' })

const peer = await bob.peer({
  username: 'alice-a1b2c3',  // Connect to Alice specifically
  tags: ['chat']
})

peer.on('open', () => {
  console.log('Bob: connected to', peer.peerUsername)
  peer.send('Hello Alice!')
})

peer.on('message', (data) => {
  console.log('Bob received:', data)
})
```

## API Reference

### Rondevu.connect()

```typescript
const rondevu = await Rondevu.connect({
  apiUrl?: string,         // Default: 'https://api.ronde.vu'
  credential?: Credential, // Optional: reuse existing credential
  username?: string,       // Optional: claim custom username (4-32 chars)
  iceServers?: IceServerPreset | RTCIceServer[],  // Optional: 'ipv4-turn', 'hostname-turns', 'google-stun', 'relay-only'
  debug?: boolean          // Optional: enable debug logging
})
```

### rondevu.peer() - Connect to a Peer

```typescript
const peer = await rondevu.peer({
  tags: string[],            // Tags to discover by
  username?: string,         // Optional: specific user
  rtcConfig?: RTCConfiguration,
  config?: Partial<ConnectionConfig>
})

// Events
peer.on('open', () => {})
peer.on('close', (reason) => {})
peer.on('message', (data) => {})
peer.on('state', (state, prev) => {})
peer.on('error', (error) => {})
peer.on('reconnecting', (attempt, max) => {})

// Properties
peer.state          // PeerState
peer.peerUsername   // string
peer.isConnected    // boolean
peer.peerConnection // RTCPeerConnection | null
peer.dataChannel    // RTCDataChannel | null

// Methods
peer.send(data)
peer.close()
```

### rondevu.offer() - Host Offers

```typescript
await rondevu.offer({
  tags: string[],           // Tags for discovery
  maxOffers: number,        // Max concurrent offers
  offerFactory?: OfferFactory,
  ttl?: number,             // Offer lifetime in ms (default: 300000)
  connectionConfig?: Partial<ConnectionConfig>
})

await rondevu.startFilling()  // Start accepting connections
rondevu.stopFilling()         // Stop and close all connections

// Events
rondevu.on('connection:opened', (offerId, connection) => {
  console.log('Peer connected:', connection.peerUsername)
  connection.on('message', (data) => {})
  connection.send('Hello!')
})
```

### rondevu.discover() - Find Offers

```typescript
const result = await rondevu.discover(['chat', 'video'], {
  limit: 20,
  offset: 0
})

for (const offer of result.offers) {
  console.log(offer.username, offer.tags, offer.offerId)
}
```

### Connection Configuration

```typescript
interface ConnectionConfig {
  connectionTimeout: number      // Default: 30000ms
  iceGatheringTimeout: number    // Default: 10000ms
  reconnectEnabled: boolean      // Default: true
  maxReconnectAttempts: number   // Default: 5 (0 = infinite)
  reconnectBackoffBase: number   // Default: 1000ms
  reconnectBackoffMax: number    // Default: 30000ms
  bufferEnabled: boolean         // Default: true
  maxBufferSize: number          // Default: 100
  maxBufferAge: number           // Default: 60000ms
  debug: boolean                 // Default: false
}
```

## Advanced API

### rondevu.connect() - Low-Level Connection

For more control, use `rondevu.connect()` instead of `rondevu.peer()`:

```typescript
const connection = await rondevu.connect({
  tags: ['chat'],
  username: 'alice',
  connectionConfig: {
    reconnectEnabled: true,
    bufferEnabled: true
  }
})

connection.on('connected', () => connection.send('Hello!'))
connection.on('message', (data) => console.log(data))
connection.on('reconnect:scheduled', ({ attempt, delay }) => {})
connection.on('reconnect:success', () => {})
connection.on('failed', (error) => {})
```

### Custom Offer Factory

```typescript
await rondevu.offer({
  tags: ['file-transfer'],
  maxOffers: 3,
  offerFactory: async (pc) => {
    const dc = pc.createDataChannel('files', {
      ordered: true,
      maxRetransmits: 10
    })
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    return { dc, offer }
  }
})
```

### Access Raw RTCPeerConnection

```typescript
const peer = await rondevu.peer({ tags: ['chat'] })

// Access underlying WebRTC objects
const pc = peer.peerConnection
const dc = peer.dataChannel

if (pc) {
  console.log('ICE state:', pc.iceConnectionState)
}
```

## Connection Events (Advanced)

```typescript
// Lifecycle
connection.on('connecting', () => {})
connection.on('connected', () => {})
connection.on('disconnected', (reason) => {})
connection.on('failed', (error) => {})
connection.on('closed', (reason) => {})

// Reconnection
connection.on('reconnect:scheduled', ({ attempt, delay, maxAttempts }) => {})
connection.on('reconnect:attempting', (attempt) => {})
connection.on('reconnect:success', () => {})
connection.on('reconnect:failed', (error) => {})
connection.on('reconnect:exhausted', (attempts) => {})

// Messages
connection.on('message', (data) => {})
connection.on('message:buffered', (data) => {})
connection.on('message:replayed', (message) => {})

// ICE
connection.on('ice:connection:state', (state) => {})
connection.on('ice:polling:started', () => {})
connection.on('ice:polling:stopped', () => {})
```

## Tag Validation

Tags must be 1-64 characters, lowercase alphanumeric with dots/dashes, starting and ending with alphanumeric.

Valid: `chat`, `video-call`, `com.example.service`
Invalid: `UPPERCASE`, `-starts-dash`

## Examples

- [React Demo](https://github.com/xtr-dev/rondevu-demo) - Full browser UI ([live](https://ronde.vu))

## License

MIT
