# Migration Guide: v0.18.x → v0.18.8

Version 0.18.8 introduces significant improvements to connection durability and reliability. While we've maintained backward compatibility where possible, there are some breaking changes to be aware of.

## Overview of Changes

### New Features
- **Automatic reconnection** with exponential backoff
- **Message buffering** during disconnections
- **Connection state machine** with proper lifecycle management
- **Rich event system** for connection monitoring
- **ICE polling lifecycle** (stops when connected, no more resource leaks)

### Breaking Changes
- `connectToService()` now returns `AnswererConnection` instead of `ConnectionContext`
- `connection:opened` event signature changed for offerer side
- Direct DataChannel access replaced with connection wrapper API

---

## Migration Steps

### 1. Answerer Side (connectToService)

#### Old API (v0.18.7 and earlier)

```typescript
const context = await rondevu.connectToService({
  serviceFqn: 'chat:1.0.0@alice',
  onConnection: ({ dc, pc, peerUsername }) => {
    console.log('Connected to', peerUsername)

    dc.addEventListener('message', (event) => {
      console.log('Received:', event.data)
    })

    dc.addEventListener('open', () => {
      dc.send('Hello!')
    })
  }
})

// Access peer connection
context.pc.getStats()
```

#### New API (v0.18.8)

```typescript
const connection = await rondevu.connectToService({
  serviceFqn: 'chat:1.0.0@alice',
  connectionConfig: {
    reconnectEnabled: true,      // Optional: enable auto-reconnect
    bufferEnabled: true,          // Optional: enable message buffering
    connectionTimeout: 30000      // Optional: connection timeout (ms)
  }
})

// Listen for connection events
connection.on('connected', () => {
  console.log('Connected!')
  connection.send('Hello!')
})

connection.on('message', (data) => {
  console.log('Received:', data)
})

// Optional: monitor reconnection
connection.on('reconnecting', (attempt) => {
  console.log(`Reconnecting, attempt ${attempt}`)
})

connection.on('reconnect:success', () => {
  console.log('Reconnection successful!')
})

// Access peer connection if needed
const pc = connection.getPeerConnection()
const dc = connection.getDataChannel()
```

**Key Changes:**
- ❌ Removed `onConnection` callback
- ✅ Use event listeners instead: `connection.on('connected', ...)`
- ❌ Removed direct `dc.send()` access
- ✅ Use `connection.send()` for automatic buffering support
- ✅ Added automatic reconnection and message buffering

---

### 2. Offerer Side (publishService)

#### Old API (v0.18.7 and earlier)

```typescript
await rondevu.publishService({
  service: 'chat:1.0.0',
  maxOffers: 5
})

await rondevu.startFilling()

// Handle connections
rondevu.on('connection:opened', (offerId, dc) => {
  console.log('New connection:', offerId)

  dc.addEventListener('message', (event) => {
    console.log('Received:', event.data)
  })

  dc.send('Welcome!')
})
```

#### New API (v0.18.8)

```typescript
await rondevu.publishService({
  service: 'chat:1.0.0',
  maxOffers: 5,
  connectionConfig: {
    reconnectEnabled: true,
    bufferEnabled: true
  }
})

await rondevu.startFilling()

// Handle connections - signature changed!
rondevu.on('connection:opened', (offerId, connection) => {
  console.log('New connection:', offerId)

  connection.on('message', (data) => {
    console.log('Received:', data)
  })

  connection.on('disconnected', () => {
    console.log('Connection lost, will auto-reconnect')
  })

  connection.send('Welcome!')
})
```

**Key Changes:**
- ⚠️ Event signature changed: `(offerId, dc)` → `(offerId, connection)`
- ❌ Removed direct DataChannel access
- ✅ Use `connection.send()` and `connection.on('message', ...)`
- ✅ Connection object provides lifecycle events

---

## New Connection Configuration

All connection-related options are now configured via `connectionConfig`:

```typescript
interface ConnectionConfig {
  // Timeouts
  connectionTimeout: number      // Default: 30000ms (30s)
  iceGatheringTimeout: number    // Default: 10000ms (10s)

  // Reconnection
  reconnectEnabled: boolean      // Default: true
  maxReconnectAttempts: number   // Default: 5
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

### Example Usage

```typescript
const connection = await rondevu.connectToService({
  serviceFqn: 'chat:1.0.0@alice',
  connectionConfig: {
    // Disable auto-reconnect if you want manual control
    reconnectEnabled: false,

    // Disable buffering if messages are time-sensitive
    bufferEnabled: false,

    // Increase timeout for slow networks
    connectionTimeout: 60000,

    // Reduce retry attempts
    maxReconnectAttempts: 3
  }
})
```

---

## New Event System

### Connection Lifecycle Events

```typescript
connection.on('state:changed', ({ oldState, newState, reason }) => {})
connection.on('connecting', () => {})
connection.on('connected', () => {})
connection.on('disconnected', (reason) => {})
connection.on('failed', (error) => {})
connection.on('closed', (reason) => {})
```

### Reconnection Events

```typescript
connection.on('reconnect:scheduled', ({ attempt, delay, maxAttempts }) => {})
connection.on('reconnect:attempting', (attempt) => {})
connection.on('reconnect:success', () => {})
connection.on('reconnect:failed', (error) => {})
connection.on('reconnect:exhausted', (attempts) => {})
```

### Message Events

```typescript
connection.on('message', (data) => {})
connection.on('message:sent', (data, buffered) => {})
connection.on('message:buffered', (data) => {})
connection.on('message:replayed', (message) => {})
connection.on('message:buffer:overflow', (discardedMessage) => {})
```

### ICE Events

```typescript
connection.on('ice:candidate:local', (candidate) => {})
connection.on('ice:candidate:remote', (candidate) => {})
connection.on('ice:connection:state', (state) => {})
connection.on('ice:polling:started', () => {})
connection.on('ice:polling:stopped', () => {})
```

---

## Common Migration Patterns

### Pattern 1: Simple Message Handler

**Before:**
```typescript
dc.addEventListener('message', (event) => {
  console.log(event.data)
})
dc.send('Hello')
```

**After:**
```typescript
connection.on('message', (data) => {
  console.log(data)
})
connection.send('Hello')
```

---

### Pattern 2: Connection State Monitoring

**Before:**
```typescript
pc.oniceconnectionstatechange = () => {
  console.log('ICE state:', pc.iceConnectionState)
}
```

**After:**
```typescript
connection.on('ice:connection:state', (state) => {
  console.log('ICE state:', state)
})

// Or use higher-level events
connection.on('connected', () => console.log('Connected!'))
connection.on('disconnected', () => console.log('Disconnected!'))
```

---

### Pattern 3: Handling Connection Failures

**Before:**
```typescript
pc.oniceconnectionstatechange = () => {
  if (pc.iceConnectionState === 'failed') {
    // Manual reconnection logic
    pc.close()
    await setupNewConnection()
  }
}
```

**After:**
```typescript
// Automatic reconnection built-in!
connection.on('reconnecting', (attempt) => {
  console.log(`Reconnecting... attempt ${attempt}`)
})

connection.on('reconnect:success', () => {
  console.log('Back online!')
})

connection.on('reconnect:exhausted', (attempts) => {
  console.log(`Failed after ${attempts} attempts`)
  // Fallback logic here
})
```

---

### Pattern 4: Accessing Raw RTCPeerConnection/DataChannel

If you need low-level access:

```typescript
const connection = await rondevu.connectToService({ ... })

// Get raw objects if needed
const pc = connection.getPeerConnection()
const dc = connection.getDataChannel()

// Use them directly (bypasses buffering/reconnection features)
if (dc) {
  dc.addEventListener('message', (event) => {
    console.log(event.data)
  })
}
```

**Note:** Using raw DataChannel bypasses automatic buffering and reconnection features.

---

## Backward Compatibility Notes

### What Still Works
✅ `publishService()` API (just add `connectionConfig` optionally)
✅ `findService()` API (unchanged)
✅ All RondevuAPI methods (unchanged)
✅ ICE server presets (unchanged)
✅ Username and keypair management (unchanged)

### What Changed
⚠️ `connectToService()` return type: `ConnectionContext` → `AnswererConnection`
⚠️ `connection:opened` event signature: `(offerId, dc)` → `(offerId, connection)`
⚠️ Direct DataChannel access replaced with connection wrapper

### What's New
✨ Automatic reconnection with exponential backoff
✨ Message buffering during disconnections
✨ Rich event system (20+ events)
✨ Connection state machine
✨ ICE polling lifecycle management (no more resource leaks)

---

## Troubleshooting

### Issue: "connection.send is not a function"

You're trying to use the old `dc.send()` API. Update to:

```typescript
// Old
dc.send('Hello')

// New
connection.send('Hello')
```

---

### Issue: "Cannot read property 'addEventListener' of undefined"

You're trying to access `dc` directly. Update to event listeners:

```typescript
// Old
dc.addEventListener('message', (event) => {
  console.log(event.data)
})

// New
connection.on('message', (data) => {
  console.log(data)
})
```

---

### Issue: Messages not being delivered

Check if buffering is enabled and connection is established:

```typescript
connection.on('connected', () => {
  // Only send after connected
  connection.send('Hello')
})

// Monitor buffer
connection.on('message:buffered', (data) => {
  console.log('Message buffered, will send when reconnected')
})
```

---

## Need Help?

- Check the updated README for full API documentation
- See examples in the `demo/` directory
- File issues at: https://github.com/xtr-dev/rondevu/issues

---

## Summary Checklist

When migrating from v0.18.7 to v0.18.8:

- [ ] Update `connectToService()` to use returned `AnswererConnection`
- [ ] Replace `dc.addEventListener('message', ...)` with `connection.on('message', ...)`
- [ ] Replace `dc.send()` with `connection.send()`
- [ ] Update `connection:opened` event handler signature
- [ ] Consider adding reconnection event handlers
- [ ] Optionally configure `connectionConfig` for your use case
- [ ] Test connection resilience (disconnect network, should auto-reconnect)
- [ ] Remove manual reconnection logic (now built-in)
