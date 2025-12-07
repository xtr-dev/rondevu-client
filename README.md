# Rondevu Client

[![npm version](https://img.shields.io/npm/v/@xtr-dev/rondevu-client)](https://www.npmjs.com/package/@xtr-dev/rondevu-client)

🌐 **Simple, high-level WebRTC peer-to-peer connections**

TypeScript/JavaScript client for Rondevu, providing easy-to-use WebRTC connections with automatic signaling, username-based discovery, and built-in reconnection support.

**Related repositories:**
- [@xtr-dev/rondevu-client](https://github.com/xtr-dev/rondevu-client) - TypeScript client library ([npm](https://www.npmjs.com/package/@xtr-dev/rondevu-client))
- [@xtr-dev/rondevu-server](https://github.com/xtr-dev/rondevu-server) - HTTP signaling server ([npm](https://www.npmjs.com/package/@xtr-dev/rondevu-server), [live](https://api.ronde.vu))
- [@xtr-dev/rondevu-demo](https://github.com/xtr-dev/rondevu-demo) - Interactive demo ([live](https://ronde.vu))

---

## Features

- **High-Level Wrappers**: ServiceHost and ServiceClient eliminate WebRTC boilerplate
- **Username-Based Discovery**: Connect to peers by username, not complex offer/answer exchange
- **Semver-Compatible Matching**: Requesting chat@1.0.0 matches any compatible 1.x.x version
- **Privacy-First Design**: Services are hidden by default - no enumeration possible
- **Automatic Reconnection**: Built-in retry logic with exponential backoff
- **Message Queuing**: Messages sent while disconnected are queued and flushed on reconnect
- **Cryptographic Username Claiming**: Secure ownership with Ed25519 signatures
- **Service Publishing**: Package-style naming (chat.app@1.0.0) with multiple simultaneous offers
- **TypeScript**: Full type safety and autocomplete
- **Configurable Polling**: Exponential backoff with jitter to reduce server load

## Install

```bash
npm install @xtr-dev/rondevu-client
```

## Quick Start

### Hosting a Service (Alice)

```typescript
import { RondevuService, ServiceHost } from '@xtr-dev/rondevu-client'

// Step 1: Create and initialize service
const service = new RondevuService({
    apiUrl: 'https://api.ronde.vu',
    username: 'alice'
})

await service.initialize()  // Generates keypair
await service.claimUsername()  // Claims username with signature

// Step 2: Create ServiceHost
const host = new ServiceHost({
    service: 'chat.app@1.0.0',
    rondevuService: service,
    maxPeers: 5,  // Accept up to 5 connections
    ttl: 300000   // 5 minutes
})

// Step 3: Listen for incoming connections
host.events.on('connection', (connection) => {
    console.log('✅ New connection!')

    connection.events.on('message', (msg) => {
        console.log('📨 Received:', msg)
        connection.sendMessage('Hello from Alice!')
    })

    connection.events.on('state-change', (state) => {
        console.log('Connection state:', state)
    })
})

host.events.on('error', (error) => {
    console.error('Host error:', error)
})

// Step 4: Start hosting
await host.start()
console.log('Service is now live! Others can connect to @alice')

// Later: stop hosting
host.dispose()
```

### Connecting to a Service (Bob)

```typescript
import { RondevuService, ServiceClient } from '@xtr-dev/rondevu-client'

// Step 1: Create and initialize service
const service = new RondevuService({
    apiUrl: 'https://api.ronde.vu',
    username: 'bob'
})

await service.initialize()
await service.claimUsername()

// Step 2: Create ServiceClient
const client = new ServiceClient({
    username: 'alice',  // Connect to Alice
    serviceFqn: 'chat.app@1.0.0',
    rondevuService: service,
    autoReconnect: true,
    maxReconnectAttempts: 5
})

// Step 3: Listen for connection events
client.events.on('connected', (connection) => {
    console.log('✅ Connected to Alice!')

    connection.events.on('message', (msg) => {
        console.log('📨 Received:', msg)
    })

    // Send a message
    connection.sendMessage('Hello from Bob!')
})

client.events.on('disconnected', () => {
    console.log('🔌 Disconnected')
})

client.events.on('reconnecting', ({ attempt, maxAttempts }) => {
    console.log(`🔄 Reconnecting (${attempt}/${maxAttempts})...`)
})

client.events.on('error', (error) => {
    console.error('❌ Error:', error)
})

// Step 4: Connect
await client.connect()

// Later: disconnect
client.dispose()
```

## Core Concepts

### RondevuService

Handles authentication and username management:
- Generates Ed25519 keypair for signing
- Claims usernames with cryptographic proof
- Provides API client for signaling server

### ServiceHost

High-level wrapper for hosting a WebRTC service:
- Automatically creates and publishes offers
- Handles incoming connections
- Manages ICE candidate exchange
- Supports multiple simultaneous peers

### ServiceClient

High-level wrapper for connecting to services:
- Discovers services by username
- Handles offer/answer exchange automatically
- Built-in auto-reconnection with exponential backoff
- Event-driven API

### RTCDurableConnection

Low-level connection wrapper (used internally):
- Manages WebRTC PeerConnection lifecycle
- Handles ICE candidate polling
- Provides message queue for reliability
- State management and events

## API Reference

### RondevuService

```typescript
const service = new RondevuService({
    apiUrl: string,           // Signaling server URL
    username: string,         // Your username
    keypair?: Keypair         // Optional: reuse existing keypair
})

// Initialize service (generates keypair if not provided)
await service.initialize(): Promise<void>

// Claim username with cryptographic signature
await service.claimUsername(): Promise<void>

// Check if username is claimed
service.isUsernameClaimed(): boolean

// Get current username
service.getUsername(): string

// Get keypair
service.getKeypair(): Keypair

// Get API client
service.getAPI(): RondevuAPI
```

### ServiceHost

```typescript
const host = new ServiceHost({
    service: string,              // Service FQN (e.g., 'chat.app@1.0.0')
    rondevuService: RondevuService,
    maxPeers?: number,            // Default: 5
    ttl?: number,                 // Default: 300000 (5 minutes)
    isPublic?: boolean,           // Default: true
    rtcConfiguration?: RTCConfiguration
})

// Start hosting
await host.start(): Promise<void>

// Stop hosting and cleanup
host.dispose(): void

// Get all active connections
host.getConnections(): RTCDurableConnection[]

// Events
host.events.on('connection', (conn: RTCDurableConnection) => {})
host.events.on('error', (error: Error) => {})
```

### ServiceClient

```typescript
const client = new ServiceClient({
    username: string,             // Host username to connect to
    serviceFqn: string,          // Service FQN (e.g., 'chat.app@1.0.0')
    rondevuService: RondevuService,
    autoReconnect?: boolean,     // Default: true
    maxReconnectAttempts?: number, // Default: 5
    rtcConfiguration?: RTCConfiguration
})

// Connect to service
await client.connect(): Promise<RTCDurableConnection>

// Disconnect and cleanup
client.dispose(): void

// Get current connection
client.getConnection(): RTCDurableConnection | null

// Events
client.events.on('connected', (conn: RTCDurableConnection) => {})
client.events.on('disconnected', () => {})
client.events.on('reconnecting', (info: { attempt: number, maxAttempts: number }) => {})
client.events.on('error', (error: Error) => {})
```

### RTCDurableConnection

```typescript
// Connection state
connection.state: 'connected' | 'connecting' | 'disconnected'

// Send message (returns true if sent, false if queued)
await connection.sendMessage(message: string): Promise<boolean>

// Queue message for sending when connected
await connection.queueMessage(message: string, options?: QueueMessageOptions): Promise<void>

// Disconnect
connection.disconnect(): void

// Events
connection.events.on('message', (msg: string) => {})
connection.events.on('state-change', (state: ConnectionStates) => {})
```

## Configuration

### Polling Configuration

The signaling uses configurable polling with exponential backoff:

```typescript
// Default polling config
{
    initialInterval: 500,      // Start at 500ms
    maxInterval: 5000,         // Max 5 seconds
    backoffMultiplier: 1.5,    // Increase by 1.5x each time
    maxRetries: 50,            // Max 50 attempts
    jitter: true               // Add random 0-100ms to prevent thundering herd
}
```

This is handled automatically - no configuration needed.

### WebRTC Configuration

Provide custom STUN/TURN servers:

```typescript
const host = new ServiceHost({
    service: 'chat.app@1.0.0',
    rondevuService: service,
    rtcConfiguration: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            {
                urls: 'turn:turn.example.com:3478',
                username: 'user',
                credential: 'pass'
            }
        ]
    }
})
```

## Username Rules

- **Format**: Lowercase alphanumeric + dash (`a-z`, `0-9`, `-`)
- **Length**: 3-32 characters
- **Pattern**: `^[a-z0-9][a-z0-9-]*[a-z0-9]$`
- **Validity**: 365 days from claim/last use
- **Ownership**: Secured by Ed25519 public key signature

## Examples

### Chat Application

See [demo/demo.js](./demo/demo.js) for a complete working example.

### Persistent Keypair

```typescript
// Save keypair to localStorage
const service = new RondevuService({
    apiUrl: 'https://api.ronde.vu',
    username: 'alice'
})

await service.initialize()
await service.claimUsername()

// Save for later
localStorage.setItem('rondevu-keypair', JSON.stringify(service.getKeypair()))
localStorage.setItem('rondevu-username', service.getUsername())

// Load on next session
const savedKeypair = JSON.parse(localStorage.getItem('rondevu-keypair'))
const savedUsername = localStorage.getItem('rondevu-username')

const service2 = new RondevuService({
    apiUrl: 'https://api.ronde.vu',
    username: savedUsername,
    keypair: savedKeypair
})

await service2.initialize()  // Reuses keypair
```

### Message Queue Example

```typescript
// Messages are automatically queued if not connected yet
client.events.on('connected', (connection) => {
    // Send immediately
    connection.sendMessage('Hello!')
})

// Or queue for later
await client.connect()
const conn = client.getConnection()
await conn.queueMessage('This will be sent when connected', {
    expiresAt: Date.now() + 60000  // Expire after 1 minute
})
```

## Migration from v0.9.x

v0.11.0+ introduces high-level wrappers, RESTful API changes, and semver-compatible discovery:

**API Changes:**
- Server endpoints restructured (`/usernames/*` → `/users/*`)
- Added `ServiceHost` and `ServiceClient` wrappers
- Message queue fully implemented
- Configurable polling with exponential backoff
- Removed deprecated `cleanup()` methods (use `dispose()`)
- **v0.11.0+**: Services use `offers` array instead of single `sdp`
- **v0.11.0+**: Semver-compatible service discovery (chat@1.0.0 matches 1.x.x)
- **v0.11.0+**: All services are hidden - no listing endpoint
- **v0.11.0+**: Services support multiple simultaneous offers for connection pooling

**Migration Guide:**

```typescript
// Before (v0.9.x) - Manual WebRTC setup
const signaler = new RondevuSignaler(service, 'chat@1.0.0')
const context = new WebRTCContext()
const pc = context.createPeerConnection()
// ... 50+ lines of boilerplate

// After (v0.11.0) - ServiceHost wrapper
const host = new ServiceHost({
    service: 'chat@1.0.0',
    rondevuService: service
})
await host.start()
// Done!
```

## Platform Support

### Modern Browsers
Works out of the box - no additional setup needed.

### Node.js 18+
Native fetch is available, but WebRTC requires polyfills:

```bash
npm install wrtc
```

```typescript
import { WebRTCContext } from '@xtr-dev/rondevu-client'
import { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } from 'wrtc'

// Configure WebRTC context
const context = new WebRTCContext({
    RTCPeerConnection,
    RTCSessionDescription,
    RTCIceCandidate
} as any)
```

## TypeScript

All types are exported:

```typescript
import type {
    RondevuServiceOptions,
    ServiceHostOptions,
    ServiceHostEvents,
    ServiceClientOptions,
    ServiceClientEvents,
    ConnectionInterface,
    ConnectionEvents,
    ConnectionStates,
    Message,
    QueueMessageOptions,
    Signaler,
    PollingConfig,
    Credentials,
    Keypair
} from '@xtr-dev/rondevu-client'
```

## License

MIT
