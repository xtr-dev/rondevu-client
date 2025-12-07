# Rondevu Client Usage Guide

## Installation

```bash
npm install @xtr-dev/rondevu-client
```

## Quick Start

### 1. Register and Create Connection

```typescript
import { RondevuAPI, RondevuSignaler, WebRTCRondevuConnection } from '@xtr-dev/rondevu-client';

const API_URL = 'https://api.ronde.vu';

// Register to get credentials
const api = new RondevuAPI(API_URL);
const credentials = await api.register();

// Create authenticated API client
const authenticatedApi = new RondevuAPI(API_URL, credentials);
```

### 2. Create an Offer (Offerer Side)

```typescript
// Create a connection
const connection = new WebRTCRondevuConnection(
  'connection-id',
  'host-username',
  'service-name'
);

// Wait for local description
await connection.ready;

// Create offer on server
const offers = await authenticatedApi.createOffers([{
  sdp: connection.connection.localDescription!.sdp!,
  ttl: 300000 // 5 minutes
}]);

const offerId = offers[0].id;

// Set up signaler for ICE candidate exchange
const signaler = new RondevuSignaler(authenticatedApi, offerId);
connection.setSignaler(signaler);

// Poll for answer
const checkAnswer = setInterval(async () => {
  const answer = await authenticatedApi.getAnswer(offerId);
  if (answer) {
    clearInterval(checkAnswer);
    await connection.connection.setRemoteDescription({
      type: 'answer',
      sdp: answer.sdp
    });
    console.log('Connection established!');
  }
}, 1000);
```

### 3. Answer an Offer (Answerer Side)

```typescript
// Get the offer
const offer = await authenticatedApi.getOffer(offerId);

// Create connection with remote offer
const connection = new WebRTCRondevuConnection(
  'connection-id',
  'peer-username',
  'service-name',
  {
    type: 'offer',
    sdp: offer.sdp
  }
);

// Wait for local description (answer)
await connection.ready;

// Send answer to server
await authenticatedApi.answerOffer(
  offerId,
  connection.connection.localDescription!.sdp!
);

// Set up signaler for ICE candidate exchange
const signaler = new RondevuSignaler(authenticatedApi, offerId);
connection.setSignaler(signaler);

console.log('Connection established!');
```

## Using Services

### Publish a Service

```typescript
import { RondevuAPI } from '@xtr-dev/rondevu-client';

const api = new RondevuAPI(API_URL, credentials);

const service = await api.publishService({
  username: 'my-username',
  serviceFqn: 'chat.app@1.0.0',
  sdp: localDescription.sdp,
  ttl: 300000,
  isPublic: true,
  metadata: { description: 'My chat service' },
  signature: '...', // Ed25519 signature
  message: '...'    // Signed message
});

console.log('Service UUID:', service.uuid);
```

### Connect to a Service

```typescript
// Search for services
const services = await api.searchServices('username', 'chat.app@1.0.0');

if (services.length > 0) {
  // Get service details with offer
  const service = await api.getService(services[0].uuid);

  // Create connection with service offer
  const connection = new WebRTCRondevuConnection(
    service.serviceId,
    service.username,
    service.serviceFqn,
    {
      type: 'offer',
      sdp: service.sdp
    }
  );

  await connection.ready;

  // Answer the service offer
  await api.answerOffer(
    service.offerId,
    connection.connection.localDescription!.sdp!
  );

  // Set up signaler
  const signaler = new RondevuSignaler(api, service.offerId);
  connection.setSignaler(signaler);
}
```

## Event Handling

```typescript
import { EventBus } from '@xtr-dev/rondevu-client';

// Connection events
connection.events.on('state-change', (state) => {
  console.log('Connection state:', state);
});

connection.events.on('message', (message) => {
  console.log('Received message:', message);
});

// Custom events with EventBus
interface MyEvents {
  'user:connected': { userId: string; timestamp: number };
  'message:sent': string;
}

const events = new EventBus<MyEvents>();

events.on('user:connected', (data) => {
  console.log(`User ${data.userId} connected at ${data.timestamp}`);
});

events.emit('user:connected', {
  userId: '123',
  timestamp: Date.now()
});
```

## Cleanup

```typescript
import { createBin } from '@xtr-dev/rondevu-client';

const bin = createBin();

// Add cleanup functions
bin(
  () => console.log('Cleanup 1'),
  () => console.log('Cleanup 2')
);

// Clean all
bin.clean();
```

## API Reference

### RondevuAPI

Complete API client for Rondevu signaling server.

**Methods:**
- `register()` - Register new peer
- `createOffers(offers)` - Create offers
- `getOffer(offerId)` - Get offer by ID
- `answerOffer(offerId, sdp)` - Answer an offer
- `getAnswer(offerId)` - Poll for answer
- `searchOffers(topic)` - Search by topic
- `addIceCandidates(offerId, candidates)` - Add ICE candidates
- `getIceCandidates(offerId, since)` - Get ICE candidates (polling)
- `publishService(service)` - Publish service
- `getService(uuid)` - Get service by UUID
- `searchServices(username, serviceFqn)` - Search services
- `checkUsername(username)` - Check availability
- `claimUsername(username, publicKey, signature, message)` - Claim username

### RondevuSignaler

Handles ICE candidate exchange via polling.

**Constructor:**
```typescript
new RondevuSignaler(api: RondevuAPI, offerId: string)
```

**Methods:**
- `addIceCandidate(candidate)` - Send local candidate
- `addListener(callback)` - Poll for remote candidates (returns cleanup function)

### WebRTCRondevuConnection

WebRTC connection wrapper with type-safe events.

**Constructor:**
```typescript
new WebRTCRondevuConnection(
  id: string,
  host: string,
  service: string,
  offer?: RTCSessionDescriptionInit
)
```

**Properties:**
- `id` - Connection ID
- `host` - Host username
- `service` - Service FQN
- `state` - Connection state
- `events` - EventBus for state changes and messages
- `ready` - Promise that resolves when local description is set

**Methods:**
- `setSignaler(signaler)` - Set signaler for ICE exchange
- `queueMessage(message, options)` - Queue message for sending
- `sendMessage(message)` - Send message immediately

### EventBus<TEvents>

Type-safe event emitter with inferred types.

**Methods:**
- `on(event, handler)` - Subscribe
- `once(event, handler)` - Subscribe once
- `off(event, handler)` - Unsubscribe
- `emit(event, data)` - Emit event
- `clear(event?)` - Clear handlers
- `listenerCount(event)` - Get listener count
- `eventNames()` - Get event names

## Examples

See the demo application at https://github.com/xtr-dev/rondevu-demo for a complete working example.
