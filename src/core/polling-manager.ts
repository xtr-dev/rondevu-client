/**
 * PollingManager - Centralized polling for WebRTC signaling
 *
 * Provides a single shared polling timer that emits events for:
 * - poll:answer - When an offer receives an answer
 * - poll:ice - When new ICE candidates are available
 *
 * Connections subscribe to these events and filter by offerId in their callbacks.
 */

import { EventEmitter } from 'eventemitter3'
import { RondevuAPI, IceCandidate } from '../api/client.js'

export interface PollAnswerEvent {
    offerId: string
    answererPublicKey: string
    sdp: string
    answeredAt: number
    matchedTags?: string[]
}

export interface PollIceEvent {
    offerId: string
    candidates: IceCandidate[]
}

export interface PollingManagerEvents {
    'poll:answer': (data: PollAnswerEvent) => void
    'poll:ice': (data: PollIceEvent) => void
    'poll:error': (error: Error) => void
    'poll:started': () => void
    'poll:stopped': () => void
}

export interface PollingManagerOptions {
    api: RondevuAPI
    intervalMs?: number
    debugEnabled?: boolean
}

/**
 * Centralized polling manager that emits global events
 * Connections subscribe to events and filter by offerId
 */
export class PollingManager extends EventEmitter<PollingManagerEvents> {
    private static readonly DEFAULT_INTERVAL_MS = 1000

    private readonly api: RondevuAPI
    private readonly intervalMs: number
    private readonly debugEnabled: boolean

    private pollingInterval: ReturnType<typeof setInterval> | null = null
    private lastPollTimestamp = 0
    private running = false

    constructor(options: PollingManagerOptions) {
        super()
        this.api = options.api
        this.intervalMs = options.intervalMs ?? PollingManager.DEFAULT_INTERVAL_MS
        this.debugEnabled = options.debugEnabled ?? false
    }

    /**
     * Start polling
     */
    start(): void {
        if (this.running) {
            this.debug('Already running')
            return
        }

        console.log('[PollingManager] Starting polling manager')
        this.debug('Starting polling manager')
        this.running = true

        // Poll immediately
        this.poll()

        // Start interval
        this.pollingInterval = setInterval(() => {
            this.poll()
        }, this.intervalMs)

        this.emit('poll:started')
    }

    /**
     * Stop polling
     */
    stop(): void {
        if (!this.running) return

        this.debug('Stopping polling manager')
        this.running = false

        if (this.pollingInterval) {
            clearInterval(this.pollingInterval)
            this.pollingInterval = null
        }

        this.emit('poll:stopped')
    }

    /**
     * Check if polling is active
     */
    isRunning(): boolean {
        return this.running
    }

    /**
     * Get the last poll timestamp
     */
    getLastPollTimestamp(): number {
        return this.lastPollTimestamp
    }

    /**
     * Perform a single poll
     */
    private async poll(): Promise<void> {
        if (!this.running) return

        try {
            const result = await this.api.poll(this.lastPollTimestamp)

            // Emit answer events
            for (const answer of result.answers) {
                this.debug(`Poll: answer for ${answer.offerId}`)
                this.emit('poll:answer', {
                    offerId: answer.offerId,
                    answererPublicKey: answer.answererPublicKey,
                    sdp: answer.sdp,
                    answeredAt: answer.answeredAt,
                    matchedTags: answer.matchedTags,
                })

                // Update last poll timestamp
                if (answer.answeredAt > this.lastPollTimestamp) {
                    this.lastPollTimestamp = answer.answeredAt
                }
            }

            // Emit ICE candidate events (grouped by offerId)
            for (const [offerId, candidates] of Object.entries(result.iceCandidates)) {
                if (candidates.length > 0) {
                    this.debug(`Poll: ${candidates.length} ICE candidates for ${offerId}`)
                    this.emit('poll:ice', {
                        offerId,
                        candidates: candidates as IceCandidate[],
                    })

                    // Update last poll timestamp from candidates
                    for (const candidate of candidates as IceCandidate[]) {
                        if (candidate.createdAt > this.lastPollTimestamp) {
                            this.lastPollTimestamp = candidate.createdAt
                        }
                    }
                }
            }
        } catch (error) {
            this.debug('Poll error:', error)
            this.emit('poll:error', error instanceof Error ? error : new Error(String(error)))
        }
    }

    /**
     * Debug logging
     */
    private debug(...args: unknown[]): void {
        if (this.debugEnabled) {
            console.log('[PollingManager]', ...args)
        }
    }
}
