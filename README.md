# Rondevu Client

[![npm version](https://img.shields.io/npm/v/@xtr-dev/rondevu-client)](https://www.npmjs.com/package/@xtr-dev/rondevu-client)

**WebRTC signaling client with durable connections**

TypeScript client for [Rondevu](https://github.com/xtr-dev/rondevu-server), providing WebRTC signaling with automatic reconnection, message buffering, and tags-based discovery.

## Features

- **Ed25519 Identity**: Your public key IS your identity (like Ethereum addresses)
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
const alice = await Rondevu.connect()

alice.on('connection:opened', (offerId, connection) => {
  console.log('Connected to', connection.peerPublicKey)
  connection.on('message', (data) => console.log('Received:', data))
  connection.send('Hello!')
})

const offer = await alice.offer({ tags: ['chat'], maxOffers: 5 })
// Later: offer.cancel() to stop accepting connections

// ============================================
// BOB: Connect to Alice
// ============================================
const bob = await Rondevu.connect()

const peer = await bob.peer({ tags: ['chat'] })

peer.on('open', () => peer.send('Hello Alice!'))
peer.on('message', (data) => console.log('Received:', data))
```

## API Reference

### Rondevu.connect()

```typescript
const rondevu = await Rondevu.connect({
  apiUrl?: string,         // Default: 'https://api.ronde.vu'
  keyPair?: KeyPair,       // Reuse existing keypair
  iceServers?: IceServerPreset | RTCIceServer[],  // Default: 'rondevu'
  debug?: boolean
})

rondevu.getPublicKey()  // Get public key (your identity)
rondevu.getKeyPair()    // Get keypair for persistence
```

**ICE Presets**: `'rondevu'` (default), `'rondevu-relay'`, `'google-stun'`, `'public-stun'`

### rondevu.peer()

```typescript
const peer = await rondevu.peer({
  tags: string[],
  publicKey?: string,       // Connect to specific peer
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
peer.peerPublicKey
peer.send(data)
peer.close()
```

### rondevu.offer()

```typescript
const offer = await rondevu.offer({
  tags: string[],
  maxOffers: number,
  ttl?: number,       // Offer lifetime in ms (default: 300000)
  autoStart?: boolean // Auto-start filling (default: true)
})

offer.cancel()  // Stop accepting connections

rondevu.on('connection:opened', (offerId, connection) => {
  connection.on('message', (data) => {})
  connection.send('Hello!')
})
```

### rondevu.discover()

```typescript
const result = await rondevu.discover(['chat'], { limit: 20 })
result.offers.forEach(o => console.log(o.publicKey, o.tags))
```

## Identity (Ed25519 Keypairs)

Your identity is an Ed25519 public key - no usernames, no registration, no claiming conflicts. Generate a keypair locally and start making requests immediately.

```typescript
// Auto-generated keypair
const rondevu = await Rondevu.connect()
console.log(rondevu.getPublicKey())  // '5a7f3e2d...' (64 hex chars)

// Save and restore keypair for persistent identity
const keyPair = rondevu.getKeyPair()
localStorage.setItem('keypair', JSON.stringify(keyPair))

// Later: restore
const saved = JSON.parse(localStorage.getItem('keypair'))
const rondevu = await Rondevu.connect({ keyPair: saved })
```

## Tag Validation

Tags: 1-64 chars, lowercase alphanumeric with dots/dashes.

Valid: `chat`, `video-call`, `com.example.service`

## Links

- [Live Demo](https://ronde.vu) | [Server](https://github.com/xtr-dev/rondevu-server) | [API](https://api.ronde.vu)

## License

MIT
