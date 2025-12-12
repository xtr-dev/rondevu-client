# Rondevu Client - Advanced Usage

Comprehensive guide for advanced features, platform support, and detailed API reference.

## Table of Contents

- [API Reference](#api-reference)
- [Types](#types)
- [Advanced Usage](#advanced-usage)
- [Platform Support](#platform-support)
- [Username Rules](#username-rules)
- [Service FQN Format](#service-fqn-format)
- [Examples](#examples)
- [Migration Guide](#migration-guide)

---

## API Reference

### Rondevu Class

Main class for all Rondevu operations.

```typescript
import { Rondevu } from '@xtr-dev/rondevu-client'

// Create and connect to Rondevu
const rondevu = await Rondevu.connect({
  apiUrl: string,          // Signaling server URL
  username?: string,       // Optional: your username (auto-generates anonymous if omitted)
  keypair?: Keypair,       // Optional: reuse existing keypair
  cryptoAdapter?: CryptoAdapter  // Optional: platform-specific crypto (defaults to WebCryptoAdapter)
  batching?: BatcherOptions | false  // Optional: RPC batching configuration
  iceServers?: IceServerPreset | RTCIceServer[]  // Optional: preset name or custom STUN/TURN servers
  debug?: boolean  // Optional: enable debug logging (default: false)
})
```

#### Platform Support (Browser & Node.js)

The client supports both browser and Node.js environments using crypto adapters:

**Browser (default):**
```typescript
import { Rondevu } from '@xtr-dev/rondevu-client'

// WebCryptoAdapter is used by default - no configuration needed
const rondevu = await Rondevu.connect({
  apiUrl: 'https://api.ronde.vu',
  username: 'alice'
})
```

**Node.js (19+ or 18 with --experimental-global-webcrypto):**
```typescript
import { Rondevu, NodeCryptoAdapter } from '@xtr-dev/rondevu-client'

const rondevu = await Rondevu.connect({
  apiUrl: 'https://api.ronde.vu',
  username: 'alice',
  cryptoAdapter: new NodeCryptoAdapter()
})
```

**Note:** Node.js support requires:
- Node.js 19+ (crypto.subtle available globally), OR
- Node.js 18 with `--experimental-global-webcrypto` flag
- WebRTC implementation like `wrtc` or `node-webrtc` for RTCPeerConnection

**Custom Crypto Adapter:**
```typescript
import { CryptoAdapter, Keypair } from '@xtr-dev/rondevu-client'

class CustomCryptoAdapter implements CryptoAdapter {
  async generateKeypair(): Promise<Keypair> { /* ... */ }
  async signMessage(message: string, privateKey: string): Promise<string> { /* ... */ }
  async verifySignature(message: string, signature: string, publicKey: string): Promise<boolean> { /* ... */ }
  bytesToBase64(bytes: Uint8Array): string { /* ... */ }
  base64ToBytes(base64: string): Uint8Array { /* ... */ }
  randomBytes(length: number): Uint8Array { /* ... */ }
}

const rondevu = await Rondevu.connect({
  apiUrl: 'https://api.ronde.vu',
  cryptoAdapter: new CustomCryptoAdapter()
})
```

#### Username Management

Usernames are **automatically claimed** on the first authenticated request (like `publishService()`).

```typescript
// Check if username is claimed (checks server)
await rondevu.isUsernameClaimed(): Promise<boolean>

// Get username
rondevu.getUsername(): string

// Get public key
rondevu.getPublicKey(): string

// Get keypair (for backup/storage)
rondevu.getKeypair(): Keypair
```

#### Service Publishing

```typescript
// Publish service with offers
await rondevu.publishService({
  service: string,  // e.g., 'chat:1.0.0' (username auto-appended)
  maxOffers: number,  // Maximum number of concurrent offers to maintain
  offerFactory?: OfferFactory,  // Optional: custom offer creation (defaults to simple data channel)
  ttl?: number      // Optional: milliseconds (default: 300000)
}): Promise<void>
```

#### Service Discovery

```typescript
// Direct lookup by FQN (with username)
await rondevu.getService('chat:1.0.0@alice'): Promise<ServiceOffer>

// Random discovery (without username)
await rondevu.discoverService('chat:1.0.0'): Promise<ServiceOffer>

// Paginated discovery (returns multiple offers)
await rondevu.discoverServices(
  'chat:1.0.0',  // serviceVersion
  10,            // limit
  0              // offset
): Promise<{ services: ServiceOffer[], count: number, limit: number, offset: number }>
```

#### WebRTC Signaling

```typescript
// Post answer SDP
await rondevu.postOfferAnswer(
  serviceFqn: string,
  offerId: string,
  sdp: string
): Promise<{ success: boolean, offerId: string }>

// Get answer SDP (offerer polls this - deprecated, use pollOffers instead)
await rondevu.getOfferAnswer(
  serviceFqn: string,
  offerId: string
): Promise<{ sdp: string, offerId: string, answererId: string, answeredAt: number } | null>

// Combined polling for answers and ICE candidates (RECOMMENDED for offerers)
await rondevu.pollOffers(since?: number): Promise<{
  answers: Array<{
    offerId: string
    serviceId?: string
    answererId: string
    sdp: string
    answeredAt: number
  }>
  iceCandidates: Record<string, Array<{
    candidate: RTCIceCandidateInit | null
    role: 'offerer' | 'answerer'
    peerId: string
    createdAt: number
  }>>
}>

// Add ICE candidates
await rondevu.addOfferIceCandidates(
  serviceFqn: string,
  offerId: string,
  candidates: RTCIceCandidateInit[]
): Promise<{ count: number, offerId: string }>

// Get ICE candidates (with polling support)
await rondevu.getOfferIceCandidates(
  serviceFqn: string,
  offerId: string,
  since: number = 0
): Promise<{ candidates: IceCandidate[], offerId: string }>
```

### RondevuAPI Class

Low-level HTTP API client (used internally by Rondevu class).

```typescript
import { RondevuAPI } from '@xtr-dev/rondevu-client'

const api = new RondevuAPI(
  baseUrl: string,
  username: string,
  keypair: Keypair
)

// Check username
await api.checkUsername(username: string): Promise<{
  available: boolean
  publicKey?: string
  claimedAt?: number
  expiresAt?: number
}>

// Note: Username claiming is now implicit - usernames are auto-claimed
// on first authenticated request to the server

// ... (all other HTTP endpoints)
```

#### Cryptographic Helpers

```typescript
// Generate Ed25519 keypair
const keypair = await RondevuAPI.generateKeypair(): Promise<Keypair>

// Sign message
const signature = await RondevuAPI.signMessage(
  message: string,
  privateKey: string
): Promise<string>

// Verify signature
const valid = await RondevuAPI.verifySignature(
  message: string,
  signature: string,
  publicKey: string
): Promise<boolean>
```

---

## Types

```typescript
interface Keypair {
  publicKey: string   // Base64-encoded Ed25519 public key
  privateKey: string  // Base64-encoded Ed25519 private key
}

interface Service {
  serviceId: string
  offers: ServiceOffer[]
  username: string
  serviceFqn: string
  createdAt: number
  expiresAt: number
}

interface ServiceOffer {
  offerId: string
  sdp: string
  createdAt: number
  expiresAt: number
}

interface IceCandidate {
  candidate: RTCIceCandidateInit | null
  createdAt: number
}
```

---

## Advanced Usage

### Anonymous Username

```typescript
// Auto-generate anonymous username (format: anon-{timestamp}-{random})
const rondevu = await Rondevu.connect({
  apiUrl: 'https://api.ronde.vu'
  // No username provided - will generate anonymous username
})

console.log(rondevu.getUsername())  // e.g., "anon-lx2w34-a3f501"

// Anonymous users behave exactly like regular users
await rondevu.publishService({
  service: 'chat:1.0.0',
  maxOffers: 5
})

await rondevu.startFilling()
```

### Persistent Keypair

```typescript
// Save keypair and username to localStorage
const rondevu = await Rondevu.connect({
  apiUrl: 'https://api.ronde.vu',
  username: 'alice'
})

// Save for later (username will be auto-claimed on first authenticated request)
localStorage.setItem('rondevu-username', rondevu.getUsername())
localStorage.setItem('rondevu-keypair', JSON.stringify(rondevu.getKeypair()))

// Load on next session
const savedUsername = localStorage.getItem('rondevu-username')
const savedKeypair = JSON.parse(localStorage.getItem('rondevu-keypair'))

const rondevu2 = await Rondevu.connect({
  apiUrl: 'https://api.ronde.vu',
  username: savedUsername,
  keypair: savedKeypair
})
```

### Service Discovery

```typescript
// Get a random available service
const service = await rondevu.discoverService('chat:1.0.0')
console.log('Discovered:', service.username)

// Get multiple services (paginated)
const result = await rondevu.discoverServices('chat:1.0.0', 10, 0)
console.log(`Found ${result.count} services:`)
result.services.forEach(s => console.log(`  - ${s.username}`))
```

### Multiple Concurrent Offers

```typescript
// Publish service with multiple offers for connection pooling
const offers = []
const connections = []

for (let i = 0; i < 5; i++) {
  const pc = new RTCPeerConnection(rtcConfig)
  const dc = pc.createDataChannel('chat')
  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)

  offers.push({ sdp: offer.sdp })
  connections.push({ pc, dc })
}

const service = await rondevu.publishService({
  service: 'chat:1.0.0',
  offers,
  ttl: 300000
})

// Each offer can be answered independently
console.log(`Published ${service.offers.length} offers`)
```

### Debug Logging

```typescript
// Enable debug logging to see internal operations
const rondevu = await Rondevu.connect({
  apiUrl: 'https://api.ronde.vu',
  username: 'alice',
  debug: true  // All internal logs will be displayed with [Rondevu] prefix
})

// Debug logs include:
// - Connection establishment
// - Keypair generation
// - Service publishing
// - Offer creation
// - ICE candidate exchange
// - Connection state changes
```

---

## Platform Support

### Modern Browsers
Works out of the box - no additional setup needed.

### Node.js 18+
Native fetch is available, but WebRTC requires polyfills:

```bash
npm install wrtc
```

```typescript
import { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } from 'wrtc'

// Use wrtc implementations
const pc = new RTCPeerConnection()
```

---

## Username Rules

- **Format**: Lowercase alphanumeric + dash (`a-z`, `0-9`, `-`)
- **Length**: 3-32 characters
- **Pattern**: `^[a-z0-9][a-z0-9-]*[a-z0-9]$`
- **Validity**: 365 days from claim/last use
- **Ownership**: Secured by Ed25519 public key signature

---

## Service FQN Format

- **Format**: `service:version@username`
- **Service**: Lowercase alphanumeric + dash (e.g., `chat`, `video-call`)
- **Version**: Semantic versioning (e.g., `1.0.0`, `2.1.3`)
- **Username**: Claimed username
- **Example**: `chat:1.0.0@alice`

---

## Examples

### Node.js Service Host Example

You can host WebRTC services in Node.js that browser clients can connect to. See the [Node.js Host Guide](https://github.com/xtr-dev/rondevu-demo/blob/main/NODE_HOST_GUIDE.md) for a complete guide.

**Quick example:**

```typescript
import { Rondevu, NodeCryptoAdapter } from '@xtr-dev/rondevu-client'
import wrtc from 'wrtc'

const { RTCPeerConnection } = wrtc

// Initialize with Node crypto adapter
const rondevu = await Rondevu.connect({
  apiUrl: 'https://api.ronde.vu',
  username: 'mybot',
  cryptoAdapter: new NodeCryptoAdapter()
})

// Create peer connection (offerer creates data channel)
const pc = new RTCPeerConnection(rtcConfig)
const dc = pc.createDataChannel('chat')

// Publish service (username auto-claimed on first publish)
await rondevu.publishService({
  service: 'chat:1.0.0',
  maxOffers: 5
})

await rondevu.startFilling()

// Browser clients can now discover and connect to chat:1.0.0@mybot
```

See complete examples:
- [Node.js Host Guide](https://github.com/xtr-dev/rondevu-demo/blob/main/NODE_HOST_GUIDE.md) - Full guide with complete examples
- [test-connect.js](https://github.com/xtr-dev/rondevu-demo/blob/main/test-connect.js) - Working Node.js client example
- [React Demo](https://github.com/xtr-dev/rondevu-demo) - Complete browser UI ([live](https://ronde.vu))

---

## Migration Guide

### Migration from v0.3.x

v0.4.0 removes high-level abstractions and uses manual WebRTC setup:

**Removed:**
- `ServiceHost` class (use manual WebRTC + `publishService()`)
- `ServiceClient` class (use manual WebRTC + `getService()`)
- `RTCDurableConnection` class (use native WebRTC APIs)
- `RondevuService` class (merged into `Rondevu`)

**Added:**
- `pollOffers()` - Combined polling for answers and ICE candidates
- `publishService()` - Automatic offer pool management
- `connectToService()` - Automatic answering side setup

**Migration Example:**

```typescript
// Before (v0.3.x) - ServiceHost
const host = new ServiceHost({
  service: 'chat@1.0.0',
  rondevuService: service
})
await host.start()

// After (v0.4.0+) - Automatic setup
await rondevu.publishService({
  service: 'chat:1.0.0',
  maxOffers: 5
})

await rondevu.startFilling()
```
