/**
 * Reconnection utilities for durable connections
 *
 * This module provides utilities for managing reconnection logic with
 * exponential backoff and jitter.
 */

/**
 * Calculate exponential backoff delay with jitter
 *
 * @param attempt - Current attempt number (0-indexed)
 * @param base - Base delay in milliseconds
 * @param max - Maximum delay in milliseconds
 * @param jitter - Jitter factor (0-1), e.g., 0.2 for ±20%
 * @returns Delay in milliseconds with jitter applied
 *
 * @example
 * ```typescript
 * calculateBackoff(0, 1000, 30000, 0.2) // ~1000ms ± 20%
 * calculateBackoff(1, 1000, 30000, 0.2) // ~2000ms ± 20%
 * calculateBackoff(2, 1000, 30000, 0.2) // ~4000ms ± 20%
 * calculateBackoff(5, 1000, 30000, 0.2) // ~30000ms ± 20% (capped at max)
 * ```
 */
export function calculateBackoff(
  attempt: number,
  base: number,
  max: number,
  jitter: number
): number {
  // Calculate exponential delay: base * 2^attempt
  const exponential = base * Math.pow(2, attempt);

  // Cap at maximum
  const capped = Math.min(exponential, max);

  // Apply jitter: ± (jitter * capped)
  const jitterAmount = capped * jitter;
  const randomJitter = (Math.random() * 2 - 1) * jitterAmount;

  // Return delay with jitter, ensuring it's not negative
  return Math.max(0, capped + randomJitter);
}

/**
 * Configuration for reconnection scheduler
 */
export interface ReconnectionSchedulerConfig {
  /** Maximum number of reconnection attempts */
  maxAttempts: number;

  /** Base delay for exponential backoff */
  backoffBase: number;

  /** Maximum delay between attempts */
  backoffMax: number;

  /** Jitter factor for randomizing delays */
  jitter: number;

  /** Callback invoked for each reconnection attempt */
  onReconnect: () => Promise<void>;

  /** Callback invoked when max attempts exceeded */
  onMaxAttemptsExceeded: (error: Error) => void;

  /** Optional callback invoked before each attempt */
  onBeforeAttempt?: (attempt: number, maxAttempts: number, delay: number) => void;
}

/**
 * Reconnection scheduler state
 */
export interface ReconnectionScheduler {
  /** Current attempt number */
  attempt: number;

  /** Whether scheduler is active */
  active: boolean;

  /** Schedule next reconnection attempt */
  schedule: () => void;

  /** Cancel scheduled reconnection */
  cancel: () => void;

  /** Reset attempt counter */
  reset: () => void;
}

/**
 * Create a reconnection scheduler
 *
 * @param config - Scheduler configuration
 * @returns Reconnection scheduler instance
 *
 * @example
 * ```typescript
 * const scheduler = createReconnectionScheduler({
 *   maxAttempts: 10,
 *   backoffBase: 1000,
 *   backoffMax: 30000,
 *   jitter: 0.2,
 *   onReconnect: async () => {
 *     await connect();
 *   },
 *   onMaxAttemptsExceeded: (error) => {
 *     console.error('Failed to reconnect:', error);
 *   },
 *   onBeforeAttempt: (attempt, max, delay) => {
 *     console.log(`Reconnecting in ${delay}ms (${attempt}/${max})...`);
 *   }
 * });
 *
 * // Start reconnection
 * scheduler.schedule();
 *
 * // Cancel reconnection
 * scheduler.cancel();
 * ```
 */
export function createReconnectionScheduler(
  config: ReconnectionSchedulerConfig
): ReconnectionScheduler {
  let attempt = 0;
  let active = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = () => {
    // Cancel any existing timer
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }

    // Check if max attempts exceeded
    if (attempt >= config.maxAttempts) {
      active = false;
      config.onMaxAttemptsExceeded(
        new Error(`Max reconnection attempts exceeded (${config.maxAttempts})`)
      );
      return;
    }

    // Calculate delay
    const delay = calculateBackoff(
      attempt,
      config.backoffBase,
      config.backoffMax,
      config.jitter
    );

    // Notify before attempt
    if (config.onBeforeAttempt) {
      config.onBeforeAttempt(attempt + 1, config.maxAttempts, delay);
    }

    // Mark as active
    active = true;

    // Schedule reconnection
    timer = setTimeout(async () => {
      attempt++;
      try {
        await config.onReconnect();
        // Success - reset scheduler
        attempt = 0;
        active = false;
      } catch (error) {
        // Failure - schedule next attempt
        schedule();
      }
    }, delay);
  };

  const cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    active = false;
  };

  const reset = () => {
    cancel();
    attempt = 0;
  };

  return {
    get attempt() {
      return attempt;
    },
    get active() {
      return active;
    },
    schedule,
    cancel,
    reset
  };
}
