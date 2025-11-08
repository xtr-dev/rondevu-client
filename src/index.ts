/**
 * @xtr-dev/rondevu-client
 * WebRTC peer signaling and discovery client
 */

// Export main WebRTC client class
export { Rondevu } from './rondevu';

// Export connection class
export { RondevuConnection } from './connection';

// Export low-level signaling client (for advanced usage)
export { RondevuClient } from './client';

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
} from './types';
