/**
 * @xtr-dev/rondevu-client
 * WebRTC peer signaling client
 */

export { ConnectionManager } from './connection-manager.js';
export { EventBus } from './event-bus.js';
export { RondevuAPI } from './api.js';
export { RondevuSignaler } from './signaler.js';
export { WebRTCRondevuConnection } from './connection.js';
export { createBin } from './bin.js';

// Export types
export type {
  ConnectionInterface,
  QueueMessageOptions,
  Message,
  ConnectionEvents,
  Signaler
} from './types.js';

export type {
  Credentials,
  OfferRequest,
  Offer,
  ServiceRequest,
  Service,
  IceCandidate
} from './api.js';

export type { Binnable } from './bin.js';
