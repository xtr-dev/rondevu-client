# Rondevu Client

[![npm version](https://img.shields.io/npm/v/@xtr-dev/rondevu-client)](https://www.npmjs.com/package/@xtr-dev/rondevu-client)

🌐 **WebRTC signaling client with durable connections**

TypeScript/JavaScript client for Rondevu, providing WebRTC signaling with **automatic reconnection**, **message buffering**, username claiming, service publishing/discovery, and efficient batch polling.

**Related repositories:**
- [@xtr-dev/rondevu-client](https://github.com/xtr-dev/rondevu-client) - TypeScript client library ([npm](https://www.npmjs.com/package/@xtr-dev/rondevu-client))
- [@xtr-dev/rondevu-server](https://github.com/xtr-dev/rondevu-server) - HTTP signaling server ([npm](https://www.npmjs.com/package/@xtr-dev/rondevu-server), [live](https://api.ronde.vu))
- [@xtr-dev/rondevu-demo](https://github.com/xtr-dev/rondevu-demo) - Interactive demo ([live](https://ronde.vu))

---

## Features

### ✨ New in v0.19.0
- **🔄 Automatic Reconnection**: Built-in exponential backoff for failed connections
- **📦 Message Buffering**: Queues messages during disconnections, replays on reconnect
- **📊 Connection State Machine**: Explicit lifecycle tracking with native RTC events
- **🎯 Rich Event System**: 20+ events for monitoring connection health
- **⚡ Improved Reliability**: ICE polling lifecycle management, proper cleanup
- **🏗️ Internal Refactoring**: Cleaner codebase with OfferPool extraction and consolidated ICE polling

### Core Features
- **Username Claiming**: Secure ownership with Ed25519 signatures
- **Anonymous Users**: Auto-generated anonymous usernames for quick testing
- **Service Publishing**: Publish services with multiple offers for connection pooling
- **Service Discovery**: Direct lookup, random discovery, or paginated search
- **Efficient Batch Polling**: Single endpoint for answers and ICE candidates
- **Semantic Version Matching**: Compatible version resolution (chat:1.0.0 matches any 1.x.x)
- **TypeScript**: Full type safety and autocomplete
- **Keypair Management**: Generate or reuse Ed25519 keypairs

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
  connectionConfig: {
    reconnectEnabled: true,    // Auto-reconnect on failures
    bufferEnabled: true,       // Buffer messages during disconnections
    connectionTimeout: 30000   // 30 second timeout
  }
})

// 3. Start accepting connections
await rondevu.startFilling()

// 4. Handle incoming connections
rondevu.on('connection:opened', (offerId, connection) => {
  console.log('New connection:', offerId)

  // Listen for messages
  connection.on('message', (data) => {
    console.log('Received:', data)
  })

  // Monitor connection state
  connection.on('connected', () => {
    console.log('Fully connected!')
    connection.send('Hello from Alice!')
  })

  connection.on('disconnected', () => {
    console.log('Connection lost, will auto-reconnect')
  })
})
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

// 2. Connect to service - returns AnswererConnection
const connection = await rondevu.connectToService({
  serviceFqn: 'chat:1.0.0@alice',
  connectionConfig: {
    reconnectEnabled: true,
    bufferEnabled: true,
    maxReconnectAttempts: 5
  }
})

// 3. Setup event handlers
connection.on('connected', () => {
  console.log('Connected to alice!')
  connection.send('Hello from Bob!')
})

connection.on('message', (data) => {
  console.log('Received:', data)
})

// 4. Monitor connection health
connection.on('reconnecting', (attempt) => {
  console.log(`Reconnecting... attempt ${attempt}`)
})

connection.on('reconnect:success', () => {
  console.log('Back online!')
})

connection.on('failed', (error) => {
  console.error('Connection failed:', error)
})
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
  ttl?: number,           // Optional: offer lifetime in ms (default: 300000)
  connectionConfig?: Partial<ConnectionConfig>  // Optional: durability settings
})

await rondevu.startFilling()  // Start accepting connections
rondevu.stopFilling()         // Stop and close all connections
```

### Connecting to Services

**⚠️ Breaking Change in v0.18.9+:** `connectToService()` now returns `AnswererConnection` instead of `ConnectionContext`.

```typescript
// New API (v0.18.9/v0.18.11+)
const connection = await rondevu.connectToService({
  serviceFqn?: string,     // Full FQN like 'chat:1.0.0@alice'
  service?: string,        // Service without username (for discovery)
  username?: string,       // Target username (combined with service)
  connectionConfig?: Partial<ConnectionConfig>,  // Durability settings
  rtcConfig?: RTCConfiguration  // Optional: override ICE servers
})

// Setup event handlers
connection.on('connected', () => {
  connection.send('Hello!')
})

connection.on('message', (data) => {
  console.log(data)
})
```

### Connection Configuration

```typescript
interface ConnectionConfig {
  // Timeouts
  connectionTimeout: number      // Default: 30000ms (30s)
  iceGatheringTimeout: number    // Default: 10000ms (10s)

  // Reconnection
  reconnectEnabled: boolean      // Default: true
  maxReconnectAttempts: number   // Default: 5 (0 = infinite)
  reconnectBackoffBase: number   // Default: 1000ms
  reconnectBackoffMax: number    // Default: 30000ms (30s)

  // Message buffering
  bufferEnabled: boolean         // Default: true
  maxBufferSize: number          // Default: 100 messages
  maxBufferAge: number           // Default: 60000ms (1 min)

  // Debug
  debug: boolean                 // Default: false
}
```

### Connection Events

```typescript
// Lifecycle events
connection.on('connecting', () => {})
connection.on('connected', () => {})
connection.on('disconnected', (reason) => {})
connection.on('failed', (error) => {})
connection.on('closed', (reason) => {})

// Reconnection events
connection.on('reconnecting', (attempt) => {})
connection.on('reconnect:success', () => {})
connection.on('reconnect:failed', (error) => {})
connection.on('reconnect:exhausted', (attempts) => {})

// Message events
connection.on('message', (data) => {})
connection.on('message:buffered', (data) => {})
connection.on('message:replayed', (message) => {})

// ICE events
connection.on('ice:connection:state', (state) => {})
connection.on('ice:polling:started', () => {})
connection.on('ice:polling:stopped', () => {})
```

### Service Discovery

```typescript
// Unified discovery API
const service = await rondevu.findService(
  'chat:1.0.0@alice',  // Direct lookup (with username)
  { mode: 'direct' }
)

const service = await rondevu.findService(
  'chat:1.0.0',  // Random discovery (without username)
  { mode: 'random' }
)

const result = await rondevu.findService(
  'chat:1.0.0',
  {
    mode: 'paginated',
    limit: 20,
    offset: 0
  }
)
```

## Migration Guide

**Upgrading from v0.18.10 or earlier?** See [MIGRATION.md](./MIGRATION.md) for detailed upgrade instructions.

### Quick Migration Summary

**Before (v0.18.7/v0.18.10):**
```typescript
const context = await rondevu.connectToService({
  serviceFqn: 'chat:1.0.0@alice',
  onConnection: ({ dc }) => {
    dc.addEventListener('message', (e) => console.log(e.data))
    dc.send('Hello')
  }
})
```

**After (v0.18.9/v0.18.11):**
```typescript
const connection = await rondevu.connectToService({
  serviceFqn: 'chat:1.0.0@alice'
})

connection.on('connected', () => {
  connection.send('Hello')  // Use connection.send()
})

connection.on('message', (data) => {
  console.log(data)  // data is already extracted
})
```

## Advanced Usage

### Custom Offer Factory

```typescript
await rondevu.publishService({
  service: 'file-transfer:1.0.0',
  maxOffers: 3,
  offerFactory: async (pc) => {
    // Customize data channel settings
    const dc = pc.createDataChannel('files', {
      ordered: true,
      maxRetransmits: 10
    })

    // Add custom listeners
    dc.addEventListener('open', () => {
      console.log('Transfer channel ready')
    })

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    return { dc, offer }
  }
})
```

### Accessing Raw RTCPeerConnection

```typescript
const connection = await rondevu.connectToService({ ... })

// Get raw objects if needed
const pc = connection.getPeerConnection()
const dc = connection.getDataChannel()

// Note: Using raw DataChannel bypasses buffering/reconnection features
if (dc) {
  dc.addEventListener('message', (e) => {
    console.log('Raw message:', e.data)
  })
}
```

### Disabling Durability Features

```typescript
const connection = await rondevu.connectToService({
  serviceFqn: 'chat:1.0.0@alice',
  connectionConfig: {
    reconnectEnabled: false,  // Disable auto-reconnect
    bufferEnabled: false,     // Disable message buffering
  }
})
```

## Documentation

📚 **[MIGRATION.md](./MIGRATION.md)** - Upgrade guide from v0.18.7 to v0.18.9

📚 **[ADVANCED.md](./ADVANCED.md)** - Comprehensive guide including:
- Detailed API reference for all methods
- Type definitions and interfaces
- Platform support (Browser & Node.js)
- Advanced usage patterns
- Username rules and service FQN format

## Examples

- [React Demo](https://github.com/xtr-dev/rondevu-demo) - Full browser UI ([live](https://ronde.vu))

## Changelog

### v0.19.0 (Latest)
- **Internal Refactoring** - Improved codebase maintainability (no API changes)
- Extract OfferPool class for offer lifecycle management
- Consolidate ICE polling logic (remove ~86 lines of duplicate code)
- Add AsyncLock utility for race-free concurrent operations
- Disable reconnection for offerer connections (offers are ephemeral)
- 100% backward compatible - upgrade without code changes

### v0.18.11
- Restore EventEmitter-based durable connections (same as v0.18.9)
- Durable WebRTC connections with state machine
- Automatic reconnection with exponential backoff
- Message buffering during disconnections
- ICE polling lifecycle management
- **Breaking:** `connectToService()` returns `AnswererConnection` instead of `ConnectionContext`
- See [MIGRATION.md](./MIGRATION.md) for upgrade guide

### v0.18.10
- Temporary revert to callback-based API (reverted in v0.18.11)

### v0.18.9
- Add durable WebRTC connections with state machine
- Implement automatic reconnection with exponential backoff
- Add message buffering during disconnections
- Fix ICE polling lifecycle (stops when connected)
- Add fillOffers() semaphore to prevent exceeding maxOffers
- **Breaking:** `connectToService()` returns `AnswererConnection` instead of `ConnectionContext`
- **Breaking:** `connection:opened` event signature changed
- See [MIGRATION.md](./MIGRATION.md) for upgrade guide

### v0.18.8
- Initial durable connections implementation

### v0.18.3
- Fix EventEmitter cross-platform compatibility

## License

MIT
