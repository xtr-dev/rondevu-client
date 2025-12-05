/**
 * @xtr-dev/rondevu-client
 * WebRTC peer signaling and discovery client with topic-based discovery
 */

// Export main client class
export { Rondevu } from './rondevu.js';
export type { RondevuOptions } from './rondevu.js';

// Export authentication
export { RondevuAuth } from './auth.js';
export type { Credentials, FetchFunction } from './auth.js';

// Export offers API
export { RondevuOffers } from './offers.js';
export type {
  CreateOfferRequest,
  Offer,
  IceCandidate,
  TopicInfo
} from './offers.js';

// Export peer manager
export { default as RondevuPeer } from './peer/index.js';
export type {
  PeerOptions,
  PeerEvents,
  PeerTimeouts
} from './peer/index.js';

// Export username API
export { RondevuUsername } from './usernames.js';
export type { UsernameClaimResult, UsernameCheckResult } from './usernames.js';

// Export services API
export { RondevuServices } from './services.js';
export type {
  ServicePublishResult,
  PublishServiceOptions,
  ServiceHandle
} from './services.js';

// Export discovery API
export { RondevuDiscovery } from './discovery.js';
export type {
  ServiceInfo,
  ServiceListResult,
  ServiceQueryResult,
  ServiceDetails,
  ConnectResult
} from './discovery.js';

// Export pool types
export type { PoolStatus, PooledServiceHandle } from './service-pool.js';
