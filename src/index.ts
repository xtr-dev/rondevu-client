/**
 * @xtr-dev/rondevu-client
 * WebRTC peer signaling and discovery client with durable connections
 */

// Export main client class
export { Rondevu } from './rondevu.js';
export type { RondevuOptions } from './rondevu.js';

// Export authentication
export { RondevuAuth } from './auth.js';
export type { Credentials, FetchFunction } from './auth.js';

// Export username API
export { RondevuUsername } from './usernames.js';
export type { UsernameClaimResult, UsernameCheckResult } from './usernames.js';

// Export durable connection APIs
export { DurableConnection } from './durable/connection.js';
export { DurableChannel } from './durable/channel.js';
export { DurableService } from './durable/service.js';

// Export durable connection types
export type {
  DurableConnectionState,
  DurableChannelState,
  DurableConnectionConfig,
  DurableChannelConfig,
  DurableServiceConfig,
  QueuedMessage,
  DurableConnectionEvents,
  DurableChannelEvents,
  DurableServiceEvents,
  ConnectionInfo,
  ServiceInfo
} from './durable/types.js';
