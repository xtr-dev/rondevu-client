/**
 * DurableConnection - WebRTC connection with automatic reconnection
 *
 * Manages the WebRTC peer lifecycle and automatically reconnects on
 * connection drops with exponential backoff.
 */

import { EventEmitter } from '../event-emitter.js';
import RondevuPeer from '../peer/index.js';
import type { RondevuOffers } from '../offers.js';
import { DurableChannel } from './channel.js';
import { createReconnectionScheduler, type ReconnectionScheduler } from './reconnection.js';
import {
  DurableConnectionState
} from './types.js';
import type {
  DurableConnectionConfig,
  DurableConnectionEvents,
  ConnectionInfo
} from './types.js';

/**
 * Default configuration for durable connections
 */
const DEFAULT_CONFIG: Required<DurableConnectionConfig> = {
  maxReconnectAttempts: 10,
  reconnectBackoffBase: 1000,
  reconnectBackoffMax: 30000,
  reconnectJitter: 0.2,
  connectionTimeout: 30000,
  maxQueueSize: 1000,
  maxMessageAge: 60000,
  rtcConfig: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  }
};

/**
 * Durable WebRTC connection that automatically reconnects
 *
 * The DurableConnection manages the lifecycle of a WebRTC peer connection
 * and provides:
 * - Automatic reconnection with exponential backoff
 * - Multiple durable channels that survive reconnections
 * - Configurable retry limits and timeouts
 * - High-level connection state events
 *
 * @example
 * ```typescript
 * const connection = new DurableConnection(
 *   offersApi,
 *   { username: 'alice', serviceFqn: 'chat@1.0.0' },
 *   { maxReconnectAttempts: 5 }
 * );
 *
 * connection.on('connected', () => {
 *   console.log('Connected!');
 * });
 *
 * connection.on('reconnecting', (attempt, max, delay) => {
 *   console.log(`Reconnecting... (${attempt}/${max}, retry in ${delay}ms)`);
 * });
 *
 * const channel = connection.createChannel('chat');
 * channel.on('message', (data) => {
 *   console.log('Received:', data);
 * });
 *
 * await connection.connect();
 * ```
 */
export class DurableConnection extends EventEmitter<DurableConnectionEvents> {
  readonly connectionId: string;
  readonly config: Required<DurableConnectionConfig>;
  readonly connectionInfo: ConnectionInfo;

  private _state: DurableConnectionState;
  private currentPeer?: RondevuPeer;
  private channels: Map<string, DurableChannel> = new Map();
  private reconnectionScheduler?: ReconnectionScheduler;

  // Track peer event handlers for cleanup
  private peerConnectedHandler?: () => void;
  private peerDisconnectedHandler?: () => void;
  private peerFailedHandler?: (error: Error) => void;
  private peerDataChannelHandler?: (channel: RTCDataChannel) => void;

  constructor(
    private offersApi: RondevuOffers,
    connectionInfo: ConnectionInfo,
    config?: DurableConnectionConfig
  ) {
    super();
    this.connectionId = `conn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.connectionInfo = connectionInfo;
    this._state = DurableConnectionState.CONNECTING;
  }

  /**
   * Current connection state
   */
  getState(): DurableConnectionState {
    return this._state;
  }

  /**
   * Check if connection is currently connected
   */
  isConnected(): boolean {
    return this._state === DurableConnectionState.CONNECTED;
  }

  /**
   * Create a durable channel on this connection
   *
   * The channel will be created on the current peer connection if available,
   * otherwise it will be created when the connection is established.
   *
   * @param label - Channel label
   * @param options - RTCDataChannel init options
   * @returns DurableChannel instance
   */
  createChannel(label: string, options?: RTCDataChannelInit): DurableChannel {
    // Check if channel already exists
    if (this.channels.has(label)) {
      throw new Error(`Channel with label '${label}' already exists`);
    }

    // Create durable channel
    const durableChannel = new DurableChannel(label, {
      maxQueueSize: this.config.maxQueueSize,
      maxMessageAge: this.config.maxMessageAge,
      ordered: options?.ordered ?? true,
      maxRetransmits: options?.maxRetransmits
    });

    this.channels.set(label, durableChannel);

    // If we have a current peer, attach the channel
    if (this.currentPeer && this._state === DurableConnectionState.CONNECTED) {
      this.createAndAttachChannel(durableChannel, options);
    }

    return durableChannel;
  }

  /**
   * Get an existing channel by label
   */
  getChannel(label: string): DurableChannel | undefined {
    return this.channels.get(label);
  }

  /**
   * Establish the initial connection
   *
   * @returns Promise that resolves when connected
   */
  async connect(): Promise<void> {
    if (this._state !== DurableConnectionState.CONNECTING) {
      throw new Error(`Cannot connect from state: ${this._state}`);
    }

    try {
      await this.establishConnection();
    } catch (error) {
      this._state = DurableConnectionState.DISCONNECTED;
      await this.handleDisconnection();
      throw error;
    }
  }

  /**
   * Close the connection gracefully
   */
  async close(): Promise<void> {
    if (this._state === DurableConnectionState.CLOSED) {
      return;
    }

    const previousState = this._state;
    this._state = DurableConnectionState.CLOSED;

    // Cancel any ongoing reconnection
    if (this.reconnectionScheduler) {
      this.reconnectionScheduler.cancel();
    }

    // Close all channels
    for (const channel of this.channels.values()) {
      channel.close();
    }

    // Close peer connection
    if (this.currentPeer) {
      await this.currentPeer.close();
      this.currentPeer = undefined;
    }

    this.emit('state', this._state, previousState);
    this.emit('closed');
  }

  /**
   * Establish a WebRTC connection
   */
  private async establishConnection(): Promise<void> {
    // Create new peer
    const peer = new RondevuPeer(this.offersApi, this.config.rtcConfig);
    this.currentPeer = peer;

    // Setup peer event handlers
    this.setupPeerHandlers(peer);

    // Determine connection method based on connection info
    if (this.connectionInfo.uuid) {
      // Connect by UUID
      await this.connectByUuid(peer, this.connectionInfo.uuid);
    } else if (this.connectionInfo.username && this.connectionInfo.serviceFqn) {
      // Connect by username and service FQN
      await this.connectByService(peer, this.connectionInfo.username, this.connectionInfo.serviceFqn);
    } else {
      throw new Error('Invalid connection info: must provide either uuid or (username + serviceFqn)');
    }

    // Wait for connection with timeout
    await this.waitForConnection(peer);

    // Connection established
    this.transitionToConnected();
  }

  /**
   * Connect to a service by UUID
   */
  private async connectByUuid(peer: RondevuPeer, uuid: string): Promise<void> {
    // Get service details
    const response = await fetch(`${this.offersApi['baseUrl']}/services/${uuid}`);
    if (!response.ok) {
      throw new Error(`Service not found: ${uuid}`);
    }

    const service = await response.json();

    // Answer the offer
    await peer.answer(service.offerId, service.sdp, {
      secret: this.offersApi['credentials'].secret,
      topics: []
    });
  }

  /**
   * Connect to a service by username and service FQN
   */
  private async connectByService(peer: RondevuPeer, username: string, serviceFqn: string): Promise<void> {
    // Query service to get UUID
    const response = await fetch(`${this.offersApi['baseUrl']}/index/${username}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceFqn })
    });

    if (!response.ok) {
      throw new Error(`Service not found: ${username}/${serviceFqn}`);
    }

    const { uuid } = await response.json();

    // Connect by UUID
    await this.connectByUuid(peer, uuid);
  }

  /**
   * Wait for peer connection to establish
   */
  private async waitForConnection(peer: RondevuPeer): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, this.config.connectionTimeout);

      const onConnected = () => {
        clearTimeout(timeout);
        peer.off('connected', onConnected);
        peer.off('failed', onFailed);
        resolve();
      };

      const onFailed = (error: Error) => {
        clearTimeout(timeout);
        peer.off('connected', onConnected);
        peer.off('failed', onFailed);
        reject(error);
      };

      peer.on('connected', onConnected);
      peer.on('failed', onFailed);
    });
  }

  /**
   * Setup event handlers for peer
   */
  private setupPeerHandlers(peer: RondevuPeer): void {
    this.peerConnectedHandler = () => {
      // Connection established - will be handled by waitForConnection
    };

    this.peerDisconnectedHandler = () => {
      if (this._state !== DurableConnectionState.CLOSED) {
        this.handleDisconnection();
      }
    };

    this.peerFailedHandler = (error: Error) => {
      if (this._state !== DurableConnectionState.CLOSED) {
        console.error('Peer connection failed:', error);
        this.handleDisconnection();
      }
    };

    this.peerDataChannelHandler = (channel: RTCDataChannel) => {
      // Find or create durable channel
      let durableChannel = this.channels.get(channel.label);

      if (!durableChannel) {
        // Auto-create channel for incoming data channels
        durableChannel = new DurableChannel(channel.label, {
          maxQueueSize: this.config.maxQueueSize,
          maxMessageAge: this.config.maxMessageAge
        });
        this.channels.set(channel.label, durableChannel);
      }

      // Attach the received channel
      durableChannel.attachToChannel(channel);
    };

    peer.on('connected', this.peerConnectedHandler);
    peer.on('disconnected', this.peerDisconnectedHandler);
    peer.on('failed', this.peerFailedHandler);
    peer.on('datachannel', this.peerDataChannelHandler);
  }

  /**
   * Transition to connected state
   */
  private transitionToConnected(): void {
    const previousState = this._state;
    this._state = DurableConnectionState.CONNECTED;

    // Reset reconnection scheduler if it exists
    if (this.reconnectionScheduler) {
      this.reconnectionScheduler.reset();
    }

    // Attach all channels to the new peer connection
    for (const [label, channel] of this.channels) {
      if (this.currentPeer) {
        this.createAndAttachChannel(channel);
      }
    }

    this.emit('state', this._state, previousState);
    this.emit('connected');
  }

  /**
   * Create underlying RTCDataChannel and attach to durable channel
   */
  private createAndAttachChannel(
    durableChannel: DurableChannel,
    options?: RTCDataChannelInit
  ): void {
    if (!this.currentPeer) {
      return;
    }

    // Check if peer already has this channel (received via datachannel event)
    // If not, create it
    const senders = (this.currentPeer.pc as any).getSenders?.() || [];
    const existingChannel = Array.from(senders as RTCRtpSender[])
      .map((sender) => (sender as any).channel as RTCDataChannel)
      .find(ch => ch && ch.label === durableChannel.label);

    if (existingChannel) {
      durableChannel.attachToChannel(existingChannel);
    } else {
      // Create new channel on peer
      const rtcChannel = this.currentPeer.createDataChannel(
        durableChannel.label,
        options
      );
      durableChannel.attachToChannel(rtcChannel);
    }
  }

  /**
   * Handle connection disconnection
   */
  private async handleDisconnection(): Promise<void> {
    if (this._state === DurableConnectionState.CLOSED ||
        this._state === DurableConnectionState.FAILED) {
      return;
    }

    const previousState = this._state;
    this._state = DurableConnectionState.RECONNECTING;

    this.emit('state', this._state, previousState);
    this.emit('disconnected');

    // Detach all channels (but keep them alive)
    for (const channel of this.channels.values()) {
      channel.detachFromChannel();
    }

    // Close old peer
    if (this.currentPeer) {
      await this.currentPeer.close();
      this.currentPeer = undefined;
    }

    // Create or use existing reconnection scheduler
    if (!this.reconnectionScheduler) {
      this.reconnectionScheduler = createReconnectionScheduler({
        maxAttempts: this.config.maxReconnectAttempts,
        backoffBase: this.config.reconnectBackoffBase,
        backoffMax: this.config.reconnectBackoffMax,
        jitter: this.config.reconnectJitter,
        onReconnect: async () => {
          await this.establishConnection();
        },
        onMaxAttemptsExceeded: (error) => {
          const prevState = this._state;
          this._state = DurableConnectionState.FAILED;
          this.emit('state', this._state, prevState);
          this.emit('failed', error, true);
        },
        onBeforeAttempt: (attempt, max, delay) => {
          this.emit('reconnecting', attempt, max, delay);
        }
      });
    }

    // Schedule reconnection
    this.reconnectionScheduler.schedule();
  }
}
