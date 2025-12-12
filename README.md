# Rondevu Client

[![npm version](https://img.shields.io/npm/v/@xtr-dev/rondevu-client)](https://www.npmjs.com/package/@xtr-dev/rondevu-client)

🌐 **Simple WebRTC signaling client with username-based discovery**

TypeScript/JavaScript client for Rondevu, providing WebRTC signaling with username claiming, service publishing/discovery, and efficient batch polling.

**Related repositories:**
- [@xtr-dev/rondevu-client](https://github.com/xtr-dev/rondevu-client) - TypeScript client library ([npm](https://www.npmjs.com/package/@xtr-dev/rondevu-client))
- [@xtr-dev/rondevu-server](https://github.com/xtr-dev/rondevu-server) - HTTP signaling server ([npm](https://www.npmjs.com/package/@xtr-dev/rondevu-server), [live](https://api.ronde.vu))
- [@xtr-dev/rondevu-demo](https://github.com/xtr-dev/rondevu-demo) - Interactive demo ([live](https://ronde.vu))

---

## Features

- **Username Claiming**: Secure ownership with Ed25519 signatures
- **Anonymous Users**: Auto-generated anonymous usernames for quick testing
- **Service Publishing**: Publish services with multiple offers for connection pooling
- **Service Discovery**: Direct lookup, random discovery, or paginated search
- **Efficient Batch Polling**: Single endpoint for answers and ICE candidates (50% fewer requests)
- **Semantic Version Matching**: Compatible version resolution (chat:1.0.0 matches any 1.x.x)
- **TypeScript**: Full type safety and autocomplete
- **Keypair Management**: Generate or reuse Ed25519 keypairs
- **Automatic Signatures**: All authenticated requests signed automatically

## Installation

```bash
npm install @xtr-dev/rondevu-client
```

## Quick Start

### Publishing a Service (Offerer)

```typescript
import { Rondevu } from '@xtr-dev/rondevu-client'

// 1. Connect to Rondevu
const rondevu = await Rondevu.connect({
  apiUrl: 'https://api.ronde.vu',
  username: 'alice',  // Or omit for anonymous username
  iceServers: 'ipv4-turn'  // Preset: 'ipv4-turn', 'hostname-turns', 'google-stun', 'relay-only'
})

// 2. Publish service with automatic offer management
await rondevu.publishService({
  service: 'chat:1.0.0',
  maxOffers: 5,  // Maintain up to 5 concurrent offers
  offerFactory: async (rtcConfig) => {
    const pc = new RTCPeerConnection(rtcConfig)
    const dc = pc.createDataChannel('chat')

    dc.addEventListener('open', () => {
      console.log('Connection opened!')
      dc.send('Hello from Alice!')
    })

    dc.addEventListener('message', (e) => {
      console.log('Received:', e.data)
    })

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    return { pc, dc, offer }
  }
})

// 3. Start accepting connections
await rondevu.startFilling()
```

### Connecting to a Service (Answerer)

```typescript
import { Rondevu } from '@xtr-dev/rondevu-client'

// 1. Connect to Rondevu
const rondevu = await Rondevu.connect({
  apiUrl: 'https://api.ronde.vu',
  username: 'bob',
  iceServers: 'ipv4-turn'
})

// 2. Connect to service (automatic WebRTC setup)
const connection = await rondevu.connectToService({
  serviceFqn: 'chat:1.0.0@alice',
  onConnection: ({ dc, peerUsername }) => {
    console.log('Connected to', peerUsername)

    dc.addEventListener('message', (e) => {
      console.log('Received:', e.data)
    })

    dc.addEventListener('open', () => {
      dc.send('Hello from Bob!')
    })
  }
})

// Access connection
connection.dc.send('Another message')
connection.pc.close()  // Close when done
```

## Core API

### Rondevu.connect()

```typescript
const rondevu = await Rondevu.connect({
  apiUrl: string,          // Required: Signaling server URL
  username?: string,       // Optional: your username (auto-generates anonymous if omitted)
  keypair?: Keypair,       // Optional: reuse existing keypair
  iceServers?: IceServerPreset | RTCIceServer[],  // Optional: preset or custom config
  debug?: boolean          // Optional: enable debug logging (default: false)
})
```

### Service Publishing

```typescript
await rondevu.publishService({
  service: string,        // e.g., 'chat:1.0.0' (username auto-appended)
  maxOffers: number,      // Maximum concurrent offers to maintain
  offerFactory?: OfferFactory,  // Optional: custom offer creation
  ttl?: number           // Optional: offer lifetime in ms (default: 300000)
})

await rondevu.startFilling()  // Start accepting connections
rondevu.stopFilling()         // Stop and close all connections
```

### Service Discovery

```typescript
// Direct lookup (with username)
await rondevu.getService('chat:1.0.0@alice')

// Random discovery (without username)
await rondevu.discoverService('chat:1.0.0')

// Paginated discovery
await rondevu.discoverServices('chat:1.0.0', limit, offset)
```

### Connecting to Services

```typescript
const connection = await rondevu.connectToService({
  serviceFqn?: string,     // Full FQN like 'chat:1.0.0@alice'
  service?: string,        // Service without username (for discovery)
  username?: string,       // Target username (combined with service)
  onConnection?: (context) => void,  // Called when data channel opens
  rtcConfig?: RTCConfiguration  // Optional: override ICE servers
})
```

## Documentation

📚 **[ADVANCED.md](./ADVANCED.md)** - Comprehensive guide including:
- Detailed API reference for all methods
- Type definitions and interfaces
- Platform support (Browser & Node.js)
- Advanced usage patterns
- Username rules and service FQN format
- Examples and migration guides

## Examples

- [React Demo](https://github.com/xtr-dev/rondevu-demo) - Full browser UI ([live](https://ronde.vu))

## License

MIT
