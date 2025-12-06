# Migration Guide: v0.8.x → v0.9.0

This guide helps you migrate from Rondevu Client v0.8.x to v0.9.0.

## Overview

v0.9.0 is a **breaking change** that completely replaces low-level APIs with high-level durable connections featuring automatic reconnection and message queuing.

### What's New

✅ **Durable Connections**: Automatic reconnection on network drops
✅ **Message Queuing**: Messages sent during disconnections are queued and flushed on reconnect
✅ **Durable Channels**: RTCDataChannel wrappers that survive connection drops
✅ **TTL Auto-Refresh**: Services automatically republish before expiration
✅ **Simplified API**: Direct methods on main client instead of nested APIs

### What's Removed

❌ **Low-level APIs**: `client.services.*`, `client.discovery.*`, `client.createPeer()` no longer exported
❌ **Manual Connection Management**: No need to handle WebRTC peer lifecycle manually
❌ **Service Handles**: Replaced with DurableService instances

## Breaking Changes

### 1. Service Exposure

#### v0.8.x (Old)
```typescript
import { Rondevu } from '@xtr-dev/rondevu-client';

const client = new Rondevu();
await client.register();

const handle = await client.services.exposeService({
  username: 'alice',
  privateKey: keypair.privateKey,
  serviceFqn: 'chat@1.0.0',
  isPublic: true,
  handler: (channel, peer) => {
    channel.onmessage = (e) => {
      console.log('Received:', e.data);
      channel.send(`Echo: ${e.data}`);
    };
  }
});

// Unpublish
await handle.unpublish();
```

#### v0.9.0 (New)
```typescript
import { Rondevu } from '@xtr-dev/rondevu-client';

const client = new Rondevu();
await client.register();

const service = await client.exposeService({
  username: 'alice',
  privateKey: keypair.privateKey,
  serviceFqn: 'chat@1.0.0',
  isPublic: true,
  poolSize: 10,  // NEW: Handle multiple concurrent connections
  handler: (channel, connectionId) => {
    // NEW: DurableChannel with event emitters
    channel.on('message', (data) => {
      console.log('Received:', data);
      channel.send(`Echo: ${data}`);
    });
  }
});

// NEW: Start the service
await service.start();

// NEW: Stop the service
await service.stop();
```

**Key Differences:**
- `client.services.exposeService()` → `client.exposeService()`
- Returns `DurableService` instead of `ServiceHandle`
- Handler receives `DurableChannel` instead of `RTCDataChannel`
- Handler receives `connectionId` string instead of `RondevuPeer`
- DurableChannel uses `.on('message', ...)` instead of `.onmessage = ...`
- Must call `service.start()` to begin accepting connections
- Use `service.stop()` instead of `handle.unpublish()`

### 2. Connecting to Services

#### v0.8.x (Old)
```typescript
// Connect by username + FQN
const { peer, channel } = await client.discovery.connect(
  'alice',
  'chat@1.0.0'
);

channel.onmessage = (e) => {
  console.log('Received:', e.data);
};

channel.onopen = () => {
  channel.send('Hello!');
};

peer.on('connected', () => {
  console.log('Connected');
});

peer.on('failed', (error) => {
  console.error('Failed:', error);
});
```

#### v0.9.0 (New)
```typescript
// Connect by username + FQN
const connection = await client.connect('alice', 'chat@1.0.0', {
  maxReconnectAttempts: 10  // NEW: Configurable reconnection
});

// NEW: Create durable channel
const channel = connection.createChannel('main');

channel.on('message', (data) => {
  console.log('Received:', data);
});

channel.on('open', () => {
  channel.send('Hello!');
});

// NEW: Connection lifecycle events
connection.on('connected', () => {
  console.log('Connected');
});

connection.on('reconnecting', (attempt, max, delay) => {
  console.log(`Reconnecting (${attempt}/${max})...`);
});

connection.on('failed', (error) => {
  console.error('Failed permanently:', error);
});

// NEW: Must explicitly connect
await connection.connect();
```

**Key Differences:**
- `client.discovery.connect()` → `client.connect()`
- Returns `DurableConnection` instead of `{ peer, channel }`
- Must create channels with `connection.createChannel()`
- Must call `connection.connect()` to establish connection
- Automatic reconnection with configurable retry limits
- Messages sent during disconnection are automatically queued

### 3. Connecting by UUID

#### v0.8.x (Old)
```typescript
const { peer, channel } = await client.discovery.connectByUuid('service-uuid');

channel.onmessage = (e) => {
  console.log('Received:', e.data);
};
```

#### v0.9.0 (New)
```typescript
const connection = await client.connectByUuid('service-uuid', {
  maxReconnectAttempts: 5
});

const channel = connection.createChannel('main');

channel.on('message', (data) => {
  console.log('Received:', data);
});

await connection.connect();
```

**Key Differences:**
- `client.discovery.connectByUuid()` → `client.connectByUuid()`
- Returns `DurableConnection` instead of `{ peer, channel }`
- Must create channels and connect explicitly

### 4. Multi-Connection Services (Offer Pooling)

#### v0.8.x (Old)
```typescript
const handle = await client.services.exposeService({
  username: 'alice',
  privateKey: keypair.privateKey,
  serviceFqn: 'chat@1.0.0',
  poolSize: 5,
  pollingInterval: 2000,
  handler: (channel, peer, connectionId) => {
    console.log(`Connection: ${connectionId}`);
  },
  onPoolStatus: (status) => {
    console.log('Pool status:', status);
  }
});

const status = handle.getStatus();
await handle.addOffers(3);
```

#### v0.9.0 (New)
```typescript
const service = await client.exposeService({
  username: 'alice',
  privateKey: keypair.privateKey,
  serviceFqn: 'chat@1.0.0',
  poolSize: 5,          // SAME: Pool size
  pollingInterval: 2000, // SAME: Polling interval
  handler: (channel, connectionId) => {
    console.log(`Connection: ${connectionId}`);
  }
});

await service.start();

// Get active connections
const connections = service.getActiveConnections();

// Listen for connection events
service.on('connection', (connectionId) => {
  console.log('New connection:', connectionId);
});
```

**Key Differences:**
- `onPoolStatus` callback removed (use `service.on('connection')` instead)
- `handle.getStatus()` replaced with `service.getActiveConnections()`
- `handle.addOffers()` removed (pool auto-manages offers)
- Handler receives `DurableChannel` instead of `RTCDataChannel`

## Feature Comparison

| Feature | v0.8.x | v0.9.0 |
|---------|--------|--------|
| Service exposure | `client.services.exposeService()` | `client.exposeService()` |
| Connection | `client.discovery.connect()` | `client.connect()` |
| Connection by UUID | `client.discovery.connectByUuid()` | `client.connectByUuid()` |
| Channel type | `RTCDataChannel` | `DurableChannel` |
| Event handling | `.onmessage`, `.onopen`, etc. | `.on('message')`, `.on('open')`, etc. |
| Automatic reconnection | ❌ No | ✅ Yes (configurable) |
| Message queuing | ❌ No | ✅ Yes (during disconnections) |
| TTL auto-refresh | ❌ No | ✅ Yes (configurable) |
| Peer lifecycle | Manual | Automatic |
| Connection pooling | ✅ Yes | ✅ Yes (same API) |

## API Mapping

### Removed Exports

These are no longer exported in v0.9.0:

```typescript
// ❌ Removed
import {
  RondevuServices,
  RondevuDiscovery,
  RondevuPeer,
  ServiceHandle,
  PooledServiceHandle,
  ConnectResult
} from '@xtr-dev/rondevu-client';
```

### New Exports

These are new in v0.9.0:

```typescript
// ✅ New
import {
  DurableConnection,
  DurableChannel,
  DurableService,
  DurableConnectionState,
  DurableChannelState,
  DurableConnectionConfig,
  DurableChannelConfig,
  DurableServiceConfig,
  DurableConnectionEvents,
  DurableChannelEvents,
  DurableServiceEvents,
  ConnectionInfo,
  ServiceInfo,
  QueuedMessage
} from '@xtr-dev/rondevu-client';
```

### Unchanged Exports

These work the same in both versions:

```typescript
// ✅ Unchanged
import {
  Rondevu,
  RondevuAuth,
  RondevuUsername,
  Credentials,
  UsernameClaimResult,
  UsernameCheckResult
} from '@xtr-dev/rondevu-client';
```

## Configuration Options

### New Connection Options

v0.9.0 adds extensive configuration for automatic reconnection and message queuing:

```typescript
const connection = await client.connect('alice', 'chat@1.0.0', {
  // Reconnection
  maxReconnectAttempts: 10,      // default: 10
  reconnectBackoffBase: 1000,    // default: 1000ms
  reconnectBackoffMax: 30000,    // default: 30000ms (30 seconds)
  reconnectJitter: 0.2,          // default: 0.2 (±20%)
  connectionTimeout: 30000,      // default: 30000ms

  // Message queuing
  maxQueueSize: 1000,            // default: 1000 messages
  maxMessageAge: 60000,          // default: 60000ms (1 minute)

  // WebRTC
  rtcConfig: {
    iceServers: [...]
  }
});
```

### New Service Options

Services can now auto-refresh TTL:

```typescript
const service = await client.exposeService({
  username: 'alice',
  privateKey: keypair.privateKey,
  serviceFqn: 'chat@1.0.0',

  // TTL auto-refresh (NEW)
  ttl: 300000,              // default: 300000ms (5 minutes)
  ttlRefreshMargin: 0.2,    // default: 0.2 (refresh at 80% of TTL)

  // All connection options also apply to incoming connections
  maxReconnectAttempts: 10,
  maxQueueSize: 1000,
  // ...
});
```

## Migration Checklist

- [ ] Replace `client.services.exposeService()` with `client.exposeService()`
- [ ] Add `await service.start()` after creating service
- [ ] Replace `handle.unpublish()` with `service.stop()`
- [ ] Replace `client.discovery.connect()` with `client.connect()`
- [ ] Replace `client.discovery.connectByUuid()` with `client.connectByUuid()`
- [ ] Create channels with `connection.createChannel()` instead of receiving them directly
- [ ] Add `await connection.connect()` to establish connection
- [ ] Update handlers from `(channel, peer, connectionId?)` to `(channel, connectionId)`
- [ ] Replace `.onmessage` with `.on('message', ...)`
- [ ] Replace `.onopen` with `.on('open', ...)`
- [ ] Replace `.onclose` with `.on('close', ...)`
- [ ] Replace `.onerror` with `.on('error', ...)`
- [ ] Add reconnection event handlers (`connection.on('reconnecting', ...)`)
- [ ] Review and configure reconnection options if needed
- [ ] Review and configure message queue limits if needed
- [ ] Update TypeScript imports to use new types
- [ ] Test automatic reconnection behavior
- [ ] Test message queuing during disconnections

## Common Migration Patterns

### Pattern 1: Simple Echo Service

#### Before (v0.8.x)
```typescript
await client.services.exposeService({
  username: 'alice',
  privateKey: keypair.privateKey,
  serviceFqn: 'echo@1.0.0',
  handler: (channel) => {
    channel.onmessage = (e) => {
      channel.send(`Echo: ${e.data}`);
    };
  }
});
```

#### After (v0.9.0)
```typescript
const service = await client.exposeService({
  username: 'alice',
  privateKey: keypair.privateKey,
  serviceFqn: 'echo@1.0.0',
  handler: (channel) => {
    channel.on('message', (data) => {
      channel.send(`Echo: ${data}`);
    });
  }
});

await service.start();
```

### Pattern 2: Connection with Error Handling

#### Before (v0.8.x)
```typescript
try {
  const { peer, channel } = await client.discovery.connect('alice', 'chat@1.0.0');

  channel.onopen = () => {
    channel.send('Hello!');
  };

  peer.on('failed', (error) => {
    console.error('Connection failed:', error);
    // Manual reconnection logic here
  });
} catch (error) {
  console.error('Failed to connect:', error);
}
```

#### After (v0.9.0)
```typescript
const connection = await client.connect('alice', 'chat@1.0.0', {
  maxReconnectAttempts: 5
});

const channel = connection.createChannel('main');

channel.on('open', () => {
  channel.send('Hello!');
});

connection.on('reconnecting', (attempt, max, delay) => {
  console.log(`Reconnecting (${attempt}/${max}) in ${delay}ms`);
});

connection.on('failed', (error) => {
  console.error('Connection failed permanently:', error);
});

try {
  await connection.connect();
} catch (error) {
  console.error('Initial connection failed:', error);
}
```

### Pattern 3: Multi-User Chat Server

#### Before (v0.8.x)
```typescript
const connections = new Map();

await client.services.exposeService({
  username: 'alice',
  privateKey: keypair.privateKey,
  serviceFqn: 'chat@1.0.0',
  poolSize: 10,
  handler: (channel, peer, connectionId) => {
    connections.set(connectionId, channel);

    channel.onmessage = (e) => {
      // Broadcast to all
      for (const [id, ch] of connections) {
        if (id !== connectionId) {
          ch.send(e.data);
        }
      }
    };

    channel.onclose = () => {
      connections.delete(connectionId);
    };
  }
});
```

#### After (v0.9.0)
```typescript
const channels = new Map();

const service = await client.exposeService({
  username: 'alice',
  privateKey: keypair.privateKey,
  serviceFqn: 'chat@1.0.0',
  poolSize: 10,
  handler: (channel, connectionId) => {
    channels.set(connectionId, channel);

    channel.on('message', (data) => {
      // Broadcast to all
      for (const [id, ch] of channels) {
        if (id !== connectionId) {
          ch.send(data);
        }
      }
    });

    channel.on('close', () => {
      channels.delete(connectionId);
    });
  }
});

await service.start();

// Optional: Track connections
service.on('connection', (connectionId) => {
  console.log(`User ${connectionId} joined`);
});

service.on('disconnection', (connectionId) => {
  console.log(`User ${connectionId} left`);
});
```

## Benefits of Migration

1. **Reliability**: Automatic reconnection handles network hiccups transparently
2. **Simplicity**: No need to manage WebRTC peer lifecycle manually
3. **Durability**: Messages sent during disconnections are queued and delivered when connection restores
4. **Uptime**: Services automatically refresh TTL before expiration
5. **Type Safety**: Better TypeScript types with DurableChannel event emitters
6. **Debugging**: Queue size monitoring, connection state tracking, and detailed events

## Getting Help

If you encounter issues during migration:
1. Check the [README](./README.md) for complete API documentation
2. Review the examples for common patterns
3. Open an issue on [GitHub](https://github.com/xtr-dev/rondevu-client/issues)
