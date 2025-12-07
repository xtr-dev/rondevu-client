# EventBus Usage Examples

## Type-Safe Event Bus

The `EventBus` class provides fully type-safe event handling with TypeScript type inference.

### Basic Usage

```typescript
import { EventBus } from '@xtr-dev/rondevu-client';

// Define your event mapping
interface AppEvents {
  'user:connected': { userId: string; timestamp: number };
  'user:disconnected': { userId: string };
  'message:received': string;
  'connection:error': Error;
}

// Create the event bus
const events = new EventBus<AppEvents>();

// Subscribe to events - TypeScript knows the exact data type!
events.on('user:connected', (data) => {
  // data is { userId: string; timestamp: number }
  console.log(`User ${data.userId} connected at ${data.timestamp}`);
});

events.on('message:received', (data) => {
  // data is string
  console.log(data.toUpperCase());
});

// Emit events - TypeScript validates the data type
events.emit('user:connected', {
  userId: '123',
  timestamp: Date.now()
});

events.emit('message:received', 'Hello World');

// Type errors caught at compile time:
// events.emit('user:connected', 'wrong type'); // ❌ Error!
// events.emit('message:received', { wrong: 'type' }); // ❌ Error!
```

### One-Time Listeners

```typescript
// Subscribe once - handler auto-unsubscribes after first call
events.once('connection:error', (error) => {
  console.error('Connection failed:', error.message);
});
```

### Unsubscribing

```typescript
const handler = (data: string) => {
  console.log('Message:', data);
};

events.on('message:received', handler);

// Later, unsubscribe
events.off('message:received', handler);
```

### Utility Methods

```typescript
// Clear all handlers for a specific event
events.clear('message:received');

// Clear all handlers for all events
events.clear();

// Get listener count
const count = events.listenerCount('user:connected');

// Get all event names with handlers
const eventNames = events.eventNames();
```

## Connection Events Example

```typescript
interface ConnectionEvents {
  'connection:state': { state: 'connected' | 'disconnected' | 'connecting' };
  'connection:message': { from: string; data: string | ArrayBuffer };
  'connection:error': { code: string; message: string };
}

class ConnectionManager {
  private events = new EventBus<ConnectionEvents>();

  on<K extends keyof ConnectionEvents>(
    event: K,
    handler: (data: ConnectionEvents[K]) => void
  ) {
    this.events.on(event, handler);
  }

  private handleStateChange(state: 'connected' | 'disconnected' | 'connecting') {
    this.events.emit('connection:state', { state });
  }

  private handleMessage(from: string, data: string | ArrayBuffer) {
    this.events.emit('connection:message', { from, data });
  }
}
```

## Benefits

- ✅ **Full type safety** - TypeScript validates event names and data types
- ✅ **IntelliSense support** - Auto-completion for event names and data properties
- ✅ **Compile-time errors** - Catch type mismatches before runtime
- ✅ **Self-documenting** - Event interface serves as documentation
- ✅ **Refactoring-friendly** - Rename events or change types with confidence
