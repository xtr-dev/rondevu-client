import { EventEmitter } from './event-emitter.js';
import { RondevuAPI } from './client.js';
import { RondevuConnectionParams, WebRTCPolyfill } from './types.js';

/**
 * Represents a WebRTC connection with automatic signaling and ICE exchange
 */
export class RondevuConnection extends EventEmitter {
  readonly id: string;
  readonly role: 'offerer' | 'answerer';
  readonly remotePeerId: string;

  private pc: RTCPeerConnection;
  private client: RondevuAPI;
  private localPeerId: string;
  private dataChannels: Map<string, RTCDataChannel>;
  private pollingInterval?: ReturnType<typeof setInterval>;
  private pollingIntervalMs: number;
  private connectionTimeoutMs: number;
  private connectionTimer?: ReturnType<typeof setTimeout>;
  private isPolling: boolean = false;
  private isClosed: boolean = false;
  private wrtc?: WebRTCPolyfill;
  private RTCIceCandidate: typeof RTCIceCandidate;

  constructor(params: RondevuConnectionParams, client: RondevuAPI) {
    super();
    this.id = params.id;
    this.role = params.role;
    this.pc = params.pc;
    this.localPeerId = params.localPeerId;
    this.remotePeerId = params.remotePeerId;
    this.client = client;
    this.dataChannels = new Map();
    this.pollingIntervalMs = params.pollingInterval;
    this.connectionTimeoutMs = params.connectionTimeout;
    this.wrtc = params.wrtc;

    // Use injected WebRTC polyfill or fall back to global
    this.RTCIceCandidate = params.wrtc?.RTCIceCandidate || globalThis.RTCIceCandidate;

    this.setupEventHandlers();
    this.startConnectionTimeout();
  }

  /**
   * Setup RTCPeerConnection event handlers
   */
  private setupEventHandlers(): void {
    // ICE candidate gathering
    this.pc.onicecandidate = (event) => {
      if (event.candidate && !this.isClosed) {
        this.sendIceCandidate(event.candidate).catch((err) => {
          this.emit('error', new Error(`Failed to send ICE candidate: ${err.message}`));
        });
      }
    };

    // Connection state changes
    this.pc.onconnectionstatechange = () => {
      this.handleConnectionStateChange();
    };

    // Remote data channels
    this.pc.ondatachannel = (event) => {
      this.handleRemoteDataChannel(event.channel);
    };

    // Remote media streams
    this.pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        this.emit('stream', event.streams[0]);
      }
    };

    // ICE connection state changes
    this.pc.oniceconnectionstatechange = () => {
      const state = this.pc.iceConnectionState;

      if (state === 'failed' || state === 'closed') {
        this.emit('error', new Error(`ICE connection ${state}`));
        if (state === 'failed') {
          this.close();
        }
      }
    };
  }

  /**
   * Handle RTCPeerConnection state changes
   */
  private handleConnectionStateChange(): void {
    const state = this.pc.connectionState;

    switch (state) {
      case 'connected':
        this.clearConnectionTimeout();
        this.stopPolling();
        this.emit('connect');
        break;

      case 'disconnected':
        this.emit('disconnect');
        break;

      case 'failed':
        this.emit('error', new Error('Connection failed'));
        this.close();
        break;

      case 'closed':
        this.emit('disconnect');
        break;
    }
  }

  /**
   * Send an ICE candidate to the remote peer via signaling server
   */
  private async sendIceCandidate(candidate: RTCIceCandidate): Promise<void> {
    try {
      await this.client.sendAnswer({
        code: this.id,
        candidate: JSON.stringify(candidate.toJSON()),
        side: this.role,
      });
    } catch (err: any) {
      throw new Error(`Failed to send ICE candidate: ${err.message}`);
    }
  }

  /**
   * Start polling for remote session data (answer/candidates)
   */
  startPolling(): void {
    if (this.isPolling || this.isClosed) {
      return;
    }

    this.isPolling = true;

    // Poll immediately
    this.poll().catch((err) => {
      this.emit('error', new Error(`Poll error: ${err.message}`));
    });

    // Set up interval polling
    this.pollingInterval = setInterval(() => {
      this.poll().catch((err) => {
        this.emit('error', new Error(`Poll error: ${err.message}`));
      });
    }, this.pollingIntervalMs);
  }

  /**
   * Stop polling
   */
  private stopPolling(): void {
    this.isPolling = false;
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = undefined;
    }
  }

  /**
   * Poll the signaling server for remote data
   */
  private async poll(): Promise<void> {
    if (this.isClosed) {
      this.stopPolling();
      return;
    }

    try {
      const response = await this.client.poll(this.id, this.role);

      if (this.role === 'offerer') {
        const offererResponse = response as { answer: string | null; answerCandidates: string[] };

        // Apply answer if received and not yet applied
        if (offererResponse.answer && !this.pc.currentRemoteDescription) {
          await this.pc.setRemoteDescription({
            type: 'answer',
            sdp: offererResponse.answer,
          });
        }

        // Apply ICE candidates
        if (offererResponse.answerCandidates && offererResponse.answerCandidates.length > 0) {
          for (const candidateStr of offererResponse.answerCandidates) {
            try {
              const candidate = JSON.parse(candidateStr);
              await this.pc.addIceCandidate(new this.RTCIceCandidate(candidate));
            } catch (err) {
              console.warn('Failed to add ICE candidate:', err);
            }
          }
        }
      } else {
        // Answerer role
        const answererResponse = response as { offer: string; offerCandidates: string[] };

        // Apply ICE candidates from offerer
        if (answererResponse.offerCandidates && answererResponse.offerCandidates.length > 0) {
          for (const candidateStr of answererResponse.offerCandidates) {
            try {
              const candidate = JSON.parse(candidateStr);
              await this.pc.addIceCandidate(new this.RTCIceCandidate(candidate));
            } catch (err) {
              console.warn('Failed to add ICE candidate:', err);
            }
          }
        }
      }
    } catch (err: any) {
      // Session not found or expired
      if (err.message.includes('404') || err.message.includes('not found')) {
        this.emit('error', new Error('Session not found or expired'));
        this.close();
      }
      throw err;
    }
  }

  /**
   * Handle remotely created data channel
   */
  private handleRemoteDataChannel(channel: RTCDataChannel): void {
    this.dataChannels.set(channel.label, channel);
    this.emit('datachannel', channel);
  }

  /**
   * Get or create a data channel
   */
  dataChannel(label: string, options?: RTCDataChannelInit): RTCDataChannel {
    let channel = this.dataChannels.get(label);

    if (!channel) {
      channel = this.pc.createDataChannel(label, options);
      this.dataChannels.set(label, channel);
    }

    return channel;
  }

  /**
   * Add a local media stream to the connection
   */
  addStream(stream: MediaStream): void {
    stream.getTracks().forEach(track => {
      this.pc.addTrack(track, stream);
    });
  }

  /**
   * Get the underlying RTCPeerConnection for advanced usage
   */
  getPeerConnection(): RTCPeerConnection {
    return this.pc;
  }

  /**
   * Start connection timeout
   */
  private startConnectionTimeout(): void {
    this.connectionTimer = setTimeout(() => {
      if (this.pc.connectionState !== 'connected') {
        this.emit('error', new Error('Connection timeout'));
        this.close();
      }
    }, this.connectionTimeoutMs);
  }

  /**
   * Clear connection timeout
   */
  private clearConnectionTimeout(): void {
    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer);
      this.connectionTimer = undefined;
    }
  }

  /**
   * Close the connection and cleanup resources
   */
  close(): void {
    if (this.isClosed) {
      return;
    }

    this.isClosed = true;

    this.stopPolling();
    this.clearConnectionTimeout();

    // Close all data channels
    this.dataChannels.forEach(dc => {
      if (dc.readyState === 'open' || dc.readyState === 'connecting') {
        dc.close();
      }
    });
    this.dataChannels.clear();

    // Close peer connection
    if (this.pc.connectionState !== 'closed') {
      this.pc.close();
    }

    this.emit('disconnect');
  }
}
