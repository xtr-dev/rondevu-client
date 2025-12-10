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

// 1. Initialize (with username or anonymous)
const rondevu = new Rondevu({
  apiUrl: 'https://api.ronde.vu',
  username: 'alice'  // Or omit for anonymous username
})

await rondevu.initialize()  // Generates keypair automatically

// 2. Claim username (optional - anonymous users auto-claim)
await rondevu.claimUsername()

// 3. Create WebRTC offer
const pc = new RTCPeerConnection({
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
})

const dc = pc.createDataChannel('chat')

const offer = await pc.createOffer()
await pc.setLocalDescription(offer)

// 4. Publish service
const service = await rondevu.publishService({
  serviceFqn: 'chat:1.0.0@alice',
  offers: [{ sdp: offer.sdp }],
  ttl: 300000
})

const offerId = service.offers[0].offerId

// 5. Poll for answer and ICE candidates (combined)
let lastPollTimestamp = 0
const pollInterval = setInterval(async () => {
  const result = await rondevu.pollOffers(lastPollTimestamp)

  // Check for answer
  if (result.answers.length > 0) {
    const answer = result.answers.find(a => a.offerId === offerId)
    if (answer) {
      await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp })
      lastPollTimestamp = answer.answeredAt
    }
  }

  // Process ICE candidates
  if (result.iceCandidates[offerId]) {
    const candidates = result.iceCandidates[offerId]
      .filter(c => c.role === 'answerer')  // Only answerer's candidates

    for (const item of candidates) {
      await pc.addIceCandidate(new RTCIceCandidate(item.candidate))
      lastPollTimestamp = Math.max(lastPollTimestamp, item.createdAt)
    }
  }
}, 1000)

// 6. Send ICE candidates
pc.onicecandidate = (event) => {
  if (event.candidate) {
    rondevu.addOfferIceCandidates(
      'chat:1.0.0@alice',
      offerId,
      [event.candidate.toJSON()]
    )
  }
}

// 7. Handle messages
dc.onmessage = (event) => {
  console.log('Received:', event.data)
}

dc.onopen = () => {
  dc.send('Hello from Alice!')
}
```

### Connecting to a Service (Answerer)

```typescript
import { Rondevu } from '@xtr-dev/rondevu-client'

// 1. Initialize
const rondevu = new Rondevu({
  apiUrl: 'https://api.ronde.vu',
  username: 'bob'
})

await rondevu.initialize()
await rondevu.claimUsername()

// 2. Get service offer
const serviceData = await rondevu.getService('chat:1.0.0@alice')

// 3. Create peer connection
const pc = new RTCPeerConnection({
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
})

// 4. Set remote offer and create answer
await pc.setRemoteDescription({ type: 'offer', sdp: serviceData.sdp })

const answer = await pc.createAnswer()
await pc.setLocalDescription(answer)

// 5. Send answer
await rondevu.postOfferAnswer(
  serviceData.serviceFqn,
  serviceData.offerId,
  answer.sdp
)

// 6. Send ICE candidates
pc.onicecandidate = (event) => {
  if (event.candidate) {
    rondevu.addOfferIceCandidates(
      serviceData.serviceFqn,
      serviceData.offerId,
      [event.candidate.toJSON()]
    )
  }
}

// 7. Poll for ICE candidates
let lastIceTimestamp = 0
const iceInterval = setInterval(async () => {
  const result = await rondevu.getOfferIceCandidates(
    serviceData.serviceFqn,
    serviceData.offerId,
    lastIceTimestamp
  )

  for (const item of result.candidates) {
    if (item.candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(item.candidate))
      lastIceTimestamp = item.createdAt
    }
  }
}, 1000)

// 8. Handle data channel
pc.ondatachannel = (event) => {
  const dc = event.channel

  dc.onmessage = (event) => {
    console.log('Received:', event.data)
  }

  dc.onopen = () => {
    dc.send('Hello from Bob!')
  }
}
```

## API Reference

### Rondevu Class

Main class for all Rondevu operations.

```typescript
import { Rondevu } from '@xtr-dev/rondevu-client'

const rondevu = new Rondevu({
  apiUrl: string,     // Signaling server URL
  username?: string,  // Optional: your username (auto-generates anonymous if omitted)
  keypair?: Keypair   // Optional: reuse existing keypair
})
```

#### Initialization

```typescript
// Initialize (generates keypair if not provided, auto-claims anonymous usernames)
await rondevu.initialize(): Promise<void>
```

#### Username Management

```typescript
// Claim username with Ed25519 signature
await rondevu.claimUsername(): Promise<void>

// Check if username is claimed (checks server)
await rondevu.isUsernameClaimed(): Promise<boolean>

// Get username
rondevu.getUsername(): string

// Get public key
rondevu.getPublicKey(): string | null

// Get keypair (for backup/storage)
rondevu.getKeypair(): Keypair | null
```

#### Service Publishing

```typescript
// Publish service with offers
await rondevu.publishService({
  serviceFqn: string,  // e.g., 'chat:1.0.0@alice'
  offers: Array<{ sdp: string }>,
  ttl?: number         // Optional: milliseconds (default: 300000)
}): Promise<Service>
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
    candidate: any
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

### RondevuSignaler Class

Higher-level signaling abstraction with automatic polling and event listeners.

```typescript
import { RondevuSignaler } from '@xtr-dev/rondevu-client'

const signaler = new RondevuSignaler(
  rondevu: Rondevu,
  service: string,      // Service FQN without username (e.g., 'chat:1.0.0')
  host?: string,        // Optional: target username for answerer
  pollingConfig?: {
    initialInterval?: number      // Default: 500ms
    maxInterval?: number           // Default: 5000ms
    backoffMultiplier?: number     // Default: 1.5
    maxRetries?: number            // Default: 50
    jitter?: boolean               // Default: true
  }
)
```

#### Offerer Side

```typescript
// Set offer (automatically starts polling for answer and ICE)
await signaler.setOffer(offer: RTCSessionDescriptionInit): Promise<void>

// Listen for answer
const unbind = signaler.addAnswerListener((answer) => {
  console.log('Received answer:', answer)
})

// Listen for ICE candidates
signaler.addListener((candidate) => {
  console.log('Received ICE candidate:', candidate)
})

// Send ICE candidate
await signaler.addIceCandidate(candidate: RTCIceCandidate): Promise<void>
```

#### Answerer Side

```typescript
// Listen for offer (automatically searches for service)
const unbind = signaler.addOfferListener((offer) => {
  console.log('Received offer:', offer)
})

// Set answer (automatically starts polling for ICE)
await signaler.setAnswer(answer: RTCSessionDescriptionInit): Promise<void>

// Send ICE candidate
await signaler.addIceCandidate(candidate: RTCIceCandidate): Promise<void>

// Listen for ICE candidates
signaler.addListener((candidate) => {
  console.log('Received ICE candidate:', candidate)
})
```

#### Cleanup

```typescript
// Stop all polling and cleanup
signaler.dispose(): void
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

// Claim username
await api.claimUsername(
  username: string,
  publicKey: string,
  signature: string,
  message: string
): Promise<{ success: boolean, username: string }>

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
  candidate: RTCIceCandidateInit
  createdAt: number
}

interface PollingConfig {
  initialInterval?: number     // Default: 500ms
  maxInterval?: number          // Default: 5000ms
  backoffMultiplier?: number    // Default: 1.5
  maxRetries?: number           // Default: 50
  jitter?: boolean              // Default: true
}
```

## Advanced Usage

### Anonymous Username

```typescript
// Auto-generate anonymous username (format: anon-{timestamp}-{random})
const rondevu = new Rondevu({
  apiUrl: 'https://api.ronde.vu'
  // No username provided - will generate anonymous username
})

await rondevu.initialize()  // Auto-claims anonymous username

console.log(rondevu.getUsername())  // e.g., "anon-lx2w34-a3f501"

// Anonymous users behave exactly like regular users
await rondevu.publishService({
  serviceFqn: `chat:1.0.0@${rondevu.getUsername()}`,
  offers: [{ sdp: offerSdp }]
})
```

### Persistent Keypair

```typescript
// Save keypair and username to localStorage
const rondevu = new Rondevu({
  apiUrl: 'https://api.ronde.vu',
  username: 'alice'
})

await rondevu.initialize()
await rondevu.claimUsername()

// Save for later
localStorage.setItem('rondevu-username', rondevu.getUsername())
localStorage.setItem('rondevu-keypair', JSON.stringify(rondevu.getKeypair()))

// Load on next session
const savedUsername = localStorage.getItem('rondevu-username')
const savedKeypair = JSON.parse(localStorage.getItem('rondevu-keypair'))

const rondevu2 = new Rondevu({
  apiUrl: 'https://api.ronde.vu',
  username: savedUsername,
  keypair: savedKeypair
})

await rondevu2.initialize()  // Reuses keypair
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
  serviceFqn: 'chat:1.0.0@alice',
  offers,
  ttl: 300000
})

// Each offer can be answered independently
console.log(`Published ${service.offers.length} offers`)
```

### Custom Polling Configuration

```typescript
const signaler = new RondevuSignaler(
  rondevu,
  'chat:1.0.0',
  'alice',
  {
    initialInterval: 1000,    // Start at 1 second
    maxInterval: 10000,       // Max 10 seconds
    backoffMultiplier: 2,     // Double each time
    maxRetries: 30,           // Stop after 30 retries
    jitter: true              // Add randomness
  }
)
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
import { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } from 'wrtc'

// Use wrtc implementations
const pc = new RTCPeerConnection()
```

## Username Rules

- **Format**: Lowercase alphanumeric + dash (`a-z`, `0-9`, `-`)
- **Length**: 3-32 characters
- **Pattern**: `^[a-z0-9][a-z0-9-]*[a-z0-9]$`
- **Validity**: 365 days from claim/last use
- **Ownership**: Secured by Ed25519 public key signature

## Service FQN Format

- **Format**: `service:version@username`
- **Service**: Lowercase alphanumeric + dash (e.g., `chat`, `video-call`)
- **Version**: Semantic versioning (e.g., `1.0.0`, `2.1.3`)
- **Username**: Claimed username
- **Example**: `chat:1.0.0@alice`

## Examples

See the [demo](https://github.com/xtr-dev/rondevu-demo) for a complete working example with React UI.

## Migration from v0.3.x

v0.4.0 removes high-level abstractions and uses manual WebRTC setup:

**Removed:**
- `ServiceHost` class (use manual WebRTC + `publishService()`)
- `ServiceClient` class (use manual WebRTC + `getService()`)
- `RTCDurableConnection` class (use native WebRTC APIs)
- `RondevuService` class (merged into `Rondevu`)

**Added:**
- `pollOffers()` - Combined polling for answers and ICE candidates
- `RondevuSignaler` - Simplified signaling with automatic polling

**Migration Example:**

```typescript
// Before (v0.3.x) - ServiceHost
const host = new ServiceHost({
  service: 'chat@1.0.0',
  rondevuService: service
})
await host.start()

// After (v0.4.0) - Manual setup
const pc = new RTCPeerConnection()
const dc = pc.createDataChannel('chat')
const offer = await pc.createOffer()
await pc.setLocalDescription(offer)

await rondevu.publishService({
  serviceFqn: 'chat:1.0.0@alice',
  offers: [{ sdp: offer.sdp }]
})
```

## License

MIT
