/**
 * Exponential backoff utility for connection reconnection
 */

export interface BackoffConfig {
    base: number // Base delay in milliseconds
    max: number // Maximum delay in milliseconds
    jitter: number // Jitter factor (0-1) to add randomness
}

export class ExponentialBackoff {
    private attempt: number = 0

    constructor(private config: BackoffConfig) {
        if (config.jitter < 0 || config.jitter > 1) {
            throw new Error('Jitter must be between 0 and 1')
        }
    }

    /**
     * Calculate the next delay based on the current attempt number
     * Formula: min(base * 2^attempt, max) with jitter
     */
    next(): number {
        const exponentialDelay = this.config.base * Math.pow(2, this.attempt)
        const cappedDelay = Math.min(exponentialDelay, this.config.max)

        // Add jitter: delay ± (jitter * delay)
        const jitterAmount = cappedDelay * this.config.jitter
        const jitter = (Math.random() * 2 - 1) * jitterAmount // Random value between -jitterAmount and +jitterAmount
        const finalDelay = Math.max(0, cappedDelay + jitter)

        this.attempt++
        return Math.round(finalDelay)
    }

    /**
     * Get the current attempt number
     */
    getAttempt(): number {
        return this.attempt
    }

    /**
     * Reset the backoff state
     */
    reset(): void {
        this.attempt = 0
    }

    /**
     * Peek at what the next delay would be without incrementing
     */
    peek(): number {
        const exponentialDelay = this.config.base * Math.pow(2, this.attempt)
        const cappedDelay = Math.min(exponentialDelay, this.config.max)
        return cappedDelay
    }
}
