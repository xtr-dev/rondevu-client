# Rondevu Client

[![npm version](https://img.shields.io/npm/v/@xtr-dev/rondevu-client)](https://www.npmjs.com/package/@xtr-dev/rondevu-client)

**WebRTC signaling client with durable connections**

TypeScript client for [Rondevu](https://github.com/xtr-dev/rondevu-server), providing WebRTC signaling with automatic reconnection, message buffering, and tags-based discovery.

## Features

- **Simple Peer API**: Connect with `rondevu.peer({ tags, username })`
- **Tags-Based Discovery**: Find peers using tags (e.g., `["chat", "video"]`)
- **Automatic Reconnection**: Built-in exponential backoff
- **Message Buffering**: Queues messages during disconnections

## Installation

```bash
npm install @xtr-dev/rondevu-client
```

## Quick Start

```typescript
import { Rondevu } from '@xtr-dev/rondevu-client'

// ============================================
// ALICE: Host and wait for connections
// ============================================
const alice = await Rondevu.connect({ username: 'alice' })

alice.on('connection:opened', (offerId, connection) => {
  console.log('Connected to', connection.peerUsername)
  connection.on('message', (data) => console.log('Received:', data))
  connection.send('Hello!')
})

const handle = await alice.offer({ tags: ['chat'], maxOffers: 5 })
// Later: handle.cancel() to stop accepting connections

// ============================================
// BOB: Connect to Alice
// ============================================
const bob = await Rondevu.connect()

const peer = await bob.peer({
  username: 'alice',
  tags: ['chat']
})

peer.on('open', () => peer.send('Hello Alice!'))
peer.on('message', (data) => console.log('Received:', data))
```

## API Reference

### Rondevu.connect()

```typescript
const rondevu = await Rondevu.connect({
  apiUrl?: string,         // Default: 'https://api.ronde.vu'
  credential?: Credential, // Reuse existing credential
  username?: string,       // Claim username (4-32 chars)
  iceServers?: IceServerPreset | RTCIceServer[],  // Default: 'rondevu'
  debug?: boolean
})

rondevu.getName()       // Get username
rondevu.getCredential() // Get credential for reuse
```

**ICE Presets**: `'rondevu'` (default), `'rondevu-relay'`, `'google-stun'`, `'public-stun'`

### rondevu.peer()

```typescript
const peer = await rondevu.peer({
  tags: string[],
  username?: string,
  rtcConfig?: RTCConfiguration
})

// Events
peer.on('open', () => {})
peer.on('close', (reason) => {})
peer.on('message', (data) => {})
peer.on('error', (error) => {})
peer.on('reconnecting', (attempt, max) => {})

// Properties & Methods
peer.state           // 'connecting' | 'connected' | 'reconnecting' | ...
peer.peerUsername
peer.send(data)
peer.close()
```

### rondevu.offer()

```typescript
const handle = await rondevu.offer({
  tags: string[],
  maxOffers: number,
  ttl?: number,       // Offer lifetime in ms (default: 300000)
  autoStart?: boolean // Auto-start filling (default: true)
})

handle.cancel()  // Stop accepting connections

rondevu.on('connection:opened', (offerId, connection) => {
  connection.on('message', (data) => {})
  connection.send('Hello!')
})
```

### rondevu.discover()

```typescript
const result = await rondevu.discover(['chat'], { limit: 20 })
result.offers.forEach(o => console.log(o.username, o.tags))
```

## Credentials

```typescript
// Auto-generated username
const rondevu = await Rondevu.connect()
// rondevu.getName() === 'friendly-panda-a1b2c3'

// Claimed username
const rondevu = await Rondevu.connect({ username: 'alice' })

// Save and restore credentials
const credential = rondevu.getCredential()
localStorage.setItem('cred', JSON.stringify(credential))

const saved = JSON.parse(localStorage.getItem('cred'))
const rondevu = await Rondevu.connect({ credential: saved })
```

## Tag Validation

Tags: 1-64 chars, lowercase alphanumeric with dots/dashes.

Valid: `chat`, `video-call`, `com.example.service`

## Links

- [Live Demo](https://ronde.vu) | [Server](https://github.com/xtr-dev/rondevu-server) | [API](https://api.ronde.vu)

## License

MIT
