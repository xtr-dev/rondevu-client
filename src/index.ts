/**
 * @xtr-dev/rondevu-client
 * WebRTC peer signaling and discovery client
 */

// Export main WebRTC client class
export { Rondevu } from './rondevu.js';

// Export connection class
export { RondevuConnection } from './connection.js';

// Export low-level signaling API (for advanced usage)
export { RondevuAPI } from './client.js';

// Export all types
export type {
  // WebRTC types
  RondevuOptions,
  JoinOptions,
  ConnectionRole,
  RondevuConnectionParams,
  RondevuConnectionEvents,
  // Signaling types
  Side,
  Session,
  TopicInfo,
  Pagination,
  ListTopicsResponse,
  ListSessionsResponse,
  CreateOfferRequest,
  CreateOfferResponse,
  AnswerRequest,
  AnswerResponse,
  PollRequest,
  PollOffererResponse,
  PollAnswererResponse,
  PollResponse,
  VersionResponse,
  HealthResponse,
  ErrorResponse,
  RondevuClientOptions,
} from './types.js';
