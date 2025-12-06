/**
 * DurableChannel - Message queueing wrapper for RTCDataChannel
 *
 * Provides automatic message queuing during disconnections and transparent
 * flushing when the connection is re-established.
 */

import { EventEmitter } from '../event-emitter.js';
import {
  DurableChannelState
} from './types.js';
import type {
  DurableChannelConfig,
  DurableChannelEvents,
  QueuedMessage
} from './types.js';

/**
 * Default configuration for durable channels
 */
const DEFAULT_CONFIG = {
  maxQueueSize: 1000,
  maxMessageAge: 60000, // 1 minute
  ordered: true,
  maxRetransmits: undefined
} as const;

/**
 * Durable channel that survives WebRTC peer connection drops
 *
 * The DurableChannel wraps an RTCDataChannel and provides:
 * - Automatic message queuing during disconnections
 * - Queue flushing on reconnection
 * - Configurable queue size and message age limits
 * - RTCDataChannel-compatible API
 *
 * @example
 * ```typescript
 * const channel = new DurableChannel('chat', connection, {
 *   maxQueueSize: 500,
 *   maxMessageAge: 30000
 * });
 *
 * channel.on('message', (data) => {
 *   console.log('Received:', data);
 * });
 *
 * channel.on('open', () => {
 *   channel.send('Hello!');
 * });
 *
 * // Messages sent during disconnection are automatically queued
 * channel.send('This will be queued if disconnected');
 * ```
 */
export class DurableChannel extends EventEmitter<DurableChannelEvents> {
  readonly label: string;
  readonly config: DurableChannelConfig;

  private _state: DurableChannelState;
  private underlyingChannel?: RTCDataChannel;
  private messageQueue: QueuedMessage[] = [];
  private queueProcessing: boolean = false;
  private _bufferedAmountLowThreshold: number = 0;

  // Event handlers that need cleanup
  private openHandler?: () => void;
  private messageHandler?: (event: MessageEvent) => void;
  private errorHandler?: (event: Event) => void;
  private closeHandler?: () => void;
  private bufferedAmountLowHandler?: () => void;

  constructor(
    label: string,
    config?: DurableChannelConfig
  ) {
    super();
    this.label = label;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this._state = DurableChannelState.CONNECTING;
  }

  /**
   * Current channel state
   */
  get readyState(): DurableChannelState {
    return this._state;
  }

  /**
   * Buffered amount from underlying channel (0 if no channel)
   */
  get bufferedAmount(): number {
    return this.underlyingChannel?.bufferedAmount ?? 0;
  }

  /**
   * Buffered amount low threshold
   */
  get bufferedAmountLowThreshold(): number {
    return this._bufferedAmountLowThreshold;
  }

  set bufferedAmountLowThreshold(value: number) {
    this._bufferedAmountLowThreshold = value;
    if (this.underlyingChannel) {
      this.underlyingChannel.bufferedAmountLowThreshold = value;
    }
  }

  /**
   * Send data through the channel
   *
   * If the channel is open, sends immediately. Otherwise, queues the message
   * for delivery when the channel reconnects.
   *
   * @param data - Data to send
   */
  send(data: string | Blob | ArrayBuffer | ArrayBufferView): void {
    if (this._state === DurableChannelState.OPEN && this.underlyingChannel) {
      // Channel is open - send immediately
      try {
        this.underlyingChannel.send(data as any);
      } catch (error) {
        // Send failed - queue the message
        this.enqueueMessage(data);
        this.emit('error', error as Error);
      }
    } else if (this._state !== DurableChannelState.CLOSED) {
      // Channel is not open but not closed - queue the message
      this.enqueueMessage(data);
    } else {
      // Channel is closed - throw error
      throw new Error('Cannot send on closed channel');
    }
  }

  /**
   * Close the channel
   */
  close(): void {
    if (this._state === DurableChannelState.CLOSED ||
        this._state === DurableChannelState.CLOSING) {
      return;
    }

    this._state = DurableChannelState.CLOSING;

    if (this.underlyingChannel) {
      this.underlyingChannel.close();
    }

    this._state = DurableChannelState.CLOSED;
    this.emit('close');
  }

  /**
   * Attach to an underlying RTCDataChannel
   *
   * This is called when a WebRTC connection is established (or re-established).
   * The channel will flush any queued messages and forward events.
   *
   * @param channel - RTCDataChannel to attach to
   * @internal
   */
  attachToChannel(channel: RTCDataChannel): void {
    // Detach from any existing channel first
    this.detachFromChannel();

    this.underlyingChannel = channel;

    // Set buffered amount low threshold
    channel.bufferedAmountLowThreshold = this._bufferedAmountLowThreshold;

    // Setup event handlers
    this.openHandler = () => {
      this._state = DurableChannelState.OPEN;
      this.emit('open');

      // Flush queued messages
      this.flushQueue().catch(error => {
        this.emit('error', error);
      });
    };

    this.messageHandler = (event: MessageEvent) => {
      this.emit('message', event.data);
    };

    this.errorHandler = (event: Event) => {
      this.emit('error', new Error(`Channel error: ${event.type}`));
    };

    this.closeHandler = () => {
      if (this._state !== DurableChannelState.CLOSING &&
          this._state !== DurableChannelState.CLOSED) {
        // Unexpected close - transition to connecting (will reconnect)
        this._state = DurableChannelState.CONNECTING;
      }
    };

    this.bufferedAmountLowHandler = () => {
      this.emit('bufferedAmountLow');
    };

    // Attach handlers
    channel.addEventListener('open', this.openHandler);
    channel.addEventListener('message', this.messageHandler);
    channel.addEventListener('error', this.errorHandler);
    channel.addEventListener('close', this.closeHandler);
    channel.addEventListener('bufferedamountlow', this.bufferedAmountLowHandler);

    // If channel is already open, trigger open event
    if (channel.readyState === 'open') {
      this.openHandler();
    } else if (channel.readyState === 'connecting') {
      this._state = DurableChannelState.CONNECTING;
    }
  }

  /**
   * Detach from the underlying RTCDataChannel
   *
   * This is called when a WebRTC connection drops. The channel remains alive
   * and continues queuing messages.
   *
   * @internal
   */
  detachFromChannel(): void {
    if (!this.underlyingChannel) {
      return;
    }

    // Remove event listeners
    if (this.openHandler) {
      this.underlyingChannel.removeEventListener('open', this.openHandler);
    }
    if (this.messageHandler) {
      this.underlyingChannel.removeEventListener('message', this.messageHandler);
    }
    if (this.errorHandler) {
      this.underlyingChannel.removeEventListener('error', this.errorHandler);
    }
    if (this.closeHandler) {
      this.underlyingChannel.removeEventListener('close', this.closeHandler);
    }
    if (this.bufferedAmountLowHandler) {
      this.underlyingChannel.removeEventListener('bufferedamountlow', this.bufferedAmountLowHandler);
    }

    this.underlyingChannel = undefined;
    this._state = DurableChannelState.CONNECTING;
  }

  /**
   * Enqueue a message for later delivery
   */
  private enqueueMessage(data: string | Blob | ArrayBuffer | ArrayBufferView): void {
    // Prune old messages first
    this.pruneOldMessages();

    const message: QueuedMessage = {
      data,
      enqueuedAt: Date.now(),
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    };

    this.messageQueue.push(message);

    // Handle overflow
    const maxQueueSize = this.config.maxQueueSize ?? 1000;
    if (this.messageQueue.length > maxQueueSize) {
      const excess = this.messageQueue.length - maxQueueSize;
      this.messageQueue.splice(0, excess);
      this.emit('queueOverflow', excess);
      console.warn(
        `DurableChannel[${this.label}]: Dropped ${excess} messages due to queue overflow`
      );
    }
  }

  /**
   * Flush all queued messages through the channel
   */
  private async flushQueue(): Promise<void> {
    if (this.queueProcessing || !this.underlyingChannel ||
        this.underlyingChannel.readyState !== 'open') {
      return;
    }

    this.queueProcessing = true;

    try {
      // Prune old messages before flushing
      this.pruneOldMessages();

      // Send all queued messages
      while (this.messageQueue.length > 0) {
        const message = this.messageQueue.shift();
        if (!message) break;

        try {
          this.underlyingChannel.send(message.data as any);
        } catch (error) {
          // Send failed - re-queue message
          this.messageQueue.unshift(message);
          throw error;
        }

        // If buffer is getting full, wait for it to drain
        if (this.underlyingChannel.bufferedAmount > 16 * 1024 * 1024) { // 16MB
          await new Promise<void>((resolve) => {
            const checkBuffer = () => {
              if (!this.underlyingChannel ||
                  this.underlyingChannel.bufferedAmount < 8 * 1024 * 1024) {
                resolve();
              } else {
                setTimeout(checkBuffer, 100);
              }
            };
            checkBuffer();
          });
        }
      }
    } finally {
      this.queueProcessing = false;
    }
  }

  /**
   * Remove messages older than maxMessageAge from the queue
   */
  private pruneOldMessages(): void {
    const maxMessageAge = this.config.maxMessageAge ?? 60000;
    if (maxMessageAge === Infinity || maxMessageAge <= 0) {
      return;
    }

    const now = Date.now();
    const cutoff = now - maxMessageAge;

    const originalLength = this.messageQueue.length;
    this.messageQueue = this.messageQueue.filter(msg => msg.enqueuedAt >= cutoff);

    const pruned = originalLength - this.messageQueue.length;
    if (pruned > 0) {
      console.warn(
        `DurableChannel[${this.label}]: Pruned ${pruned} old messages (older than ${maxMessageAge}ms)`
      );
    }
  }

  /**
   * Get the current queue size
   *
   * @internal
   */
  getQueueSize(): number {
    return this.messageQueue.length;
  }
}
