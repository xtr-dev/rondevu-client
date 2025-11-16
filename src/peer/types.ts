/**
 * Timeout configurations for different connection phases
 */
export interface PeerTimeouts {
  /** Timeout for ICE gathering (default: 10000ms) */
  iceGathering?: number;
  /** Timeout for waiting for answer (default: 30000ms) */
  waitingForAnswer?: number;
  /** Timeout for creating answer (default: 10000ms) */
  creatingAnswer?: number;
  /** Timeout for ICE connection (default: 30000ms) */
  iceConnection?: number;
}

/**
 * Options for creating a peer connection
 */
export interface PeerOptions {
  /** RTCConfiguration for the peer connection */
  rtcConfig?: RTCConfiguration;
  /** Topics to advertise this connection under */
  topics: string[];
  /** How long the offer should live (milliseconds) */
  ttl?: number;
  /** Whether to create a data channel automatically (for offerer) */
  createDataChannel?: boolean;
  /** Label for the automatically created data channel */
  dataChannelLabel?: string;
  /** Timeout configurations */
  timeouts?: PeerTimeouts;
}

/**
 * Events emitted by RondevuPeer
 */
export interface PeerEvents extends Record<string, (...args: any[]) => void> {
  'state': (state: string) => void;
  'connected': () => void;
  'disconnected': () => void;
  'failed': (error: Error) => void;
  'datachannel': (channel: RTCDataChannel) => void;
  'track': (event: RTCTrackEvent) => void;
}
