// ============================================================================
// Signaling Types
// ============================================================================

/**
 * Session side - identifies which peer in a connection
 */
export type Side = 'offerer' | 'answerer';

/**
 * Request body for POST /offer
 */
export interface CreateOfferRequest {
  /** Peer identifier/metadata (max 1024 characters) */
  peerId: string;
  /** Signaling data for peer connection */
  offer: string;
  /** Optional custom connection code (if not provided, server generates UUID) */
  code?: string;
}

/**
 * Response from POST /offer
 */
export interface CreateOfferResponse {
  /** Unique session identifier (UUID) */
  code: string;
}

/**
 * Request body for POST /answer
 */
export interface AnswerRequest {
  /** Session UUID from the offer */
  code: string;
  /** Response signaling data (required if candidate not provided) */
  answer?: string;
  /** Additional signaling data (required if answer not provided) */
  candidate?: string;
  /** Which peer is sending the data */
  side: Side;
}

/**
 * Response from POST /answer
 */
export interface AnswerResponse {
  success: boolean;
}

/**
 * Request body for POST /poll
 */
export interface PollRequest {
  /** Session UUID */
  code: string;
  /** Which side is polling */
  side: Side;
}

/**
 * Response from POST /poll when side=offerer
 */
export interface PollOffererResponse {
  /** Answer from answerer (null if not yet received) */
  answer: string | null;
  /** Additional signaling data from answerer */
  answerCandidates: string[];
}

/**
 * Response from POST /poll when side=answerer
 */
export interface PollAnswererResponse {
  /** Offer from offerer */
  offer: string;
  /** Additional signaling data from offerer */
  offerCandidates: string[];
}

/**
 * Response from POST /poll (union type)
 */
export type PollResponse = PollOffererResponse | PollAnswererResponse;

/**
 * Response from GET / - server version information
 */
export interface VersionResponse {
  /** Git commit hash or version identifier */
  version: string;
}

/**
 * Response from GET /health
 */
export interface HealthResponse {
  status: 'ok';
  timestamp: number;
  version: string;
}

/**
 * Error response structure
 */
export interface ErrorResponse {
  error: string;
}

/**
 * Client configuration options
 */
export interface RondevuClientOptions {
  /** Base URL of the Rondevu server (e.g., 'https://example.com') */
  baseUrl: string;
  /** Optional fetch implementation (for Node.js environments) */
  fetch?: typeof fetch;
}

// ============================================================================
// WebRTC Types
// ============================================================================

/**
 * WebRTC polyfill for Node.js and other non-browser platforms
 */
export interface WebRTCPolyfill {
  RTCPeerConnection: typeof RTCPeerConnection;
  RTCSessionDescription: typeof RTCSessionDescription;
  RTCIceCandidate: typeof RTCIceCandidate;
}

/**
 * Configuration options for Rondevu WebRTC client
 */
export interface RondevuOptions {
  /** Base URL of the Rondevu server (defaults to 'https://api.ronde.vu') */
  baseUrl?: string;
  /** Peer identifier (optional, auto-generated if not provided) */
  peerId?: string;
  /** Optional fetch implementation (for Node.js environments) */
  fetch?: typeof fetch;
  /** WebRTC configuration (ICE servers, etc.) */
  rtcConfig?: RTCConfiguration;
  /** Polling interval in milliseconds (default: 1000) */
  pollingInterval?: number;
  /** Connection timeout in milliseconds (default: 30000) */
  connectionTimeout?: number;
  /** WebRTC polyfill for Node.js (e.g., wrtc or @roamhq/wrtc) */
  wrtc?: WebRTCPolyfill;
}

/**
 * Connection role - whether this peer is creating or answering
 */
export type ConnectionRole = 'offerer' | 'answerer';

/**
 * Parameters for creating a RondevuConnection
 */
export interface RondevuConnectionParams {
  id: string;
  topic?: string;
  role: ConnectionRole;
  pc: RTCPeerConnection;
  localPeerId: string;
  remotePeerId: string;
  pollingInterval: number;
  connectionTimeout: number;
  wrtc?: WebRTCPolyfill;
}

/**
 * Event map for RondevuConnection events
 */
export interface RondevuConnectionEvents {
  connect: () => void;
  disconnect: () => void;
  error: (error: Error) => void;
  datachannel: (channel: RTCDataChannel) => void;
  stream: (stream: MediaStream) => void;
}
