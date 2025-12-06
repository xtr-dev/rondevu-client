/**
 * Type definitions for durable WebRTC connections
 *
 * This module defines all interfaces, enums, and types used by the durable
 * connection system for automatic reconnection and message queuing.
 */

/**
 * Connection state enum
 */
export enum DurableConnectionState {
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  DISCONNECTED = 'disconnected',
  FAILED = 'failed',
  CLOSED = 'closed'
}

/**
 * Channel state enum
 */
export enum DurableChannelState {
  CONNECTING = 'connecting',
  OPEN = 'open',
  CLOSING = 'closing',
  CLOSED = 'closed'
}

/**
 * Configuration for durable connections
 */
export interface DurableConnectionConfig {
  /** Maximum number of reconnection attempts (default: 10) */
  maxReconnectAttempts?: number;

  /** Base delay for exponential backoff in milliseconds (default: 1000) */
  reconnectBackoffBase?: number;

  /** Maximum delay between reconnection attempts in milliseconds (default: 30000) */
  reconnectBackoffMax?: number;

  /** Jitter factor for randomizing reconnection delays (default: 0.2 = ±20%) */
  reconnectJitter?: number;

  /** Timeout for initial connection attempt in milliseconds (default: 30000) */
  connectionTimeout?: number;

  /** Maximum number of messages to queue during disconnection (default: 1000) */
  maxQueueSize?: number;

  /** Maximum age of queued messages in milliseconds (default: 60000) */
  maxMessageAge?: number;

  /** WebRTC configuration */
  rtcConfig?: RTCConfiguration;
}

/**
 * Configuration for durable channels
 */
export interface DurableChannelConfig {
  /** Maximum number of messages to queue (default: 1000) */
  maxQueueSize?: number;

  /** Maximum age of queued messages in milliseconds (default: 60000) */
  maxMessageAge?: number;

  /** Whether messages should be delivered in order (default: true) */
  ordered?: boolean;

  /** Maximum retransmits for unordered channels (default: undefined) */
  maxRetransmits?: number;
}

/**
 * Configuration for durable services
 */
export interface DurableServiceConfig extends DurableConnectionConfig {
  /** Username that owns the service */
  username: string;

  /** Private key for signing service operations */
  privateKey: string;

  /** Fully qualified service name (e.g., com.example.chat@1.0.0) */
  serviceFqn: string;

  /** Whether the service is publicly discoverable (default: false) */
  isPublic?: boolean;

  /** Optional metadata for the service */
  metadata?: Record<string, any>;

  /** Time-to-live for service in milliseconds (default: server default) */
  ttl?: number;

  /** Margin before TTL expiry to trigger refresh (default: 0.2 = refresh at 80%) */
  ttlRefreshMargin?: number;

  /** Number of simultaneous open offers to maintain (default: 1) */
  poolSize?: number;

  /** Polling interval for checking answers in milliseconds (default: 2000) */
  pollingInterval?: number;
}

/**
 * Queued message structure
 */
export interface QueuedMessage {
  /** Message data */
  data: string | Blob | ArrayBuffer | ArrayBufferView;

  /** Timestamp when message was enqueued */
  enqueuedAt: number;

  /** Unique message ID */
  id: string;
}

/**
 * Event type map for DurableConnection
 */
export interface DurableConnectionEvents extends Record<string, (...args: any[]) => void> {
  'state': (state: DurableConnectionState, previousState: DurableConnectionState) => void;
  'connected': () => void;
  'reconnecting': (attempt: number, maxAttempts: number, nextRetryIn: number) => void;
  'disconnected': () => void;
  'failed': (error: Error, permanent: boolean) => void;
  'closed': () => void;
}

/**
 * Event type map for DurableChannel
 */
export interface DurableChannelEvents extends Record<string, (...args: any[]) => void> {
  'open': () => void;
  'message': (data: any) => void;
  'error': (error: Error) => void;
  'close': () => void;
  'bufferedAmountLow': () => void;
  'queueOverflow': (droppedCount: number) => void;
}

/**
 * Event type map for DurableService
 */
export interface DurableServiceEvents extends Record<string, (...args: any[]) => void> {
  'published': (serviceId: string, uuid: string) => void;
  'connection': (connectionId: string) => void;
  'disconnection': (connectionId: string) => void;
  'ttl-refreshed': (expiresAt: number) => void;
  'error': (error: Error, context: string) => void;
  'closed': () => void;
}

/**
 * Information about a durable connection
 */
export interface ConnectionInfo {
  /** Username (for username-based connections) */
  username?: string;

  /** Service FQN (for service-based connections) */
  serviceFqn?: string;

  /** UUID (for UUID-based connections) */
  uuid?: string;
}

/**
 * Service information returned when service is published
 */
export interface ServiceInfo {
  /** Service ID */
  serviceId: string;

  /** Service UUID for discovery */
  uuid: string;

  /** Expiration timestamp */
  expiresAt: number;
}
