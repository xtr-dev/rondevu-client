/**
 * AsyncLock provides a mutual exclusion primitive for asynchronous operations.
 * Ensures only one async operation can proceed at a time while queuing others.
 */
export class AsyncLock {
    private locked = false
    private queue: Array<() => void> = []

    /**
     * Acquire the lock. If already locked, waits until released.
     * @returns Promise that resolves when lock is acquired
     */
    async acquire(): Promise<void> {
        if (!this.locked) {
            this.locked = true
            return
        }

        // Lock is held, wait in queue
        return new Promise<void>(resolve => {
            this.queue.push(resolve)
        })
    }

    /**
     * Release the lock. If others are waiting, grants lock to next in queue.
     */
    release(): void {
        const next = this.queue.shift()
        if (next) {
            // Grant lock to next waiter
            next()
        } else {
            // No waiters, mark as unlocked
            this.locked = false
        }
    }

    /**
     * Run a function with the lock acquired, automatically releasing after.
     * This is the recommended way to use AsyncLock to prevent forgetting to release.
     *
     * @param fn - Async function to run with lock held
     * @returns Promise resolving to the function's return value
     *
     * @example
     * ```typescript
     * const lock = new AsyncLock()
     * const result = await lock.run(async () => {
     *     // Critical section - only one caller at a time
     *     return await doSomething()
     * })
     * ```
     */
    async run<T>(fn: () => Promise<T>): Promise<T> {
        await this.acquire()
        try {
            return await fn()
        } finally {
            this.release()
        }
    }

    /**
     * Check if lock is currently held
     */
    isLocked(): boolean {
        return this.locked
    }

    /**
     * Get number of operations waiting for the lock
     */
    getQueueLength(): number {
        return this.queue.length
    }
}
