/**
 * RPC Batcher - Throttles and batches RPC requests to reduce HTTP overhead
 */

export interface BatcherOptions {
    /**
     * Maximum number of requests to batch together
     * Default: 10
     */
    maxBatchSize?: number

    /**
     * Maximum time to wait before sending a batch (ms)
     * Default: 50ms
     */
    maxWaitTime?: number

    /**
     * Minimum time between batches (ms)
     * Default: 10ms
     */
    throttleInterval?: number
}

interface QueuedRequest {
    request: any
    resolve: (value: any) => void
    reject: (error: Error) => void
}

/**
 * Batches and throttles RPC requests to optimize network usage
 *
 * @example
 * ```typescript
 * const batcher = new RpcBatcher(
 *   (requests) => api.rpcBatch(requests),
 *   { maxBatchSize: 10, maxWaitTime: 50 }
 * )
 *
 * // These will be batched together if called within maxWaitTime
 * const result1 = await batcher.add(request1)
 * const result2 = await batcher.add(request2)
 * const result3 = await batcher.add(request3)
 * ```
 */
export class RpcBatcher {
    private queue: QueuedRequest[] = []
    private batchTimeout: ReturnType<typeof setTimeout> | null = null
    private lastBatchTime: number = 0
    private options: Required<BatcherOptions>
    private sendBatch: (requests: any[]) => Promise<any[]>

    constructor(
        sendBatch: (requests: any[]) => Promise<any[]>,
        options?: BatcherOptions
    ) {
        this.sendBatch = sendBatch
        this.options = {
            maxBatchSize: options?.maxBatchSize ?? 10,
            maxWaitTime: options?.maxWaitTime ?? 50,
            throttleInterval: options?.throttleInterval ?? 10,
        }
    }

    /**
     * Add an RPC request to the batch queue
     * Returns a promise that resolves when the request completes
     */
    async add(request: any): Promise<any> {
        return new Promise((resolve, reject) => {
            this.queue.push({ request, resolve, reject })

            // Send immediately if batch is full
            if (this.queue.length >= this.options.maxBatchSize) {
                this.flush()
                return
            }

            // Schedule batch if not already scheduled
            if (!this.batchTimeout) {
                this.batchTimeout = setTimeout(() => {
                    this.flush()
                }, this.options.maxWaitTime)
            }
        })
    }

    /**
     * Flush the queue immediately
     */
    async flush(): Promise<void> {
        // Clear timeout if set
        if (this.batchTimeout) {
            clearTimeout(this.batchTimeout)
            this.batchTimeout = null
        }

        // Nothing to flush
        if (this.queue.length === 0) {
            return
        }

        // Throttle: wait if we sent a batch too recently
        const now = Date.now()
        const timeSinceLastBatch = now - this.lastBatchTime
        if (timeSinceLastBatch < this.options.throttleInterval) {
            const waitTime = this.options.throttleInterval - timeSinceLastBatch
            await new Promise(resolve => setTimeout(resolve, waitTime))
        }

        // Extract requests from queue
        const batch = this.queue.splice(0, this.options.maxBatchSize)
        const requests = batch.map(item => item.request)

        this.lastBatchTime = Date.now()

        try {
            // Send batch request
            const results = await this.sendBatch(requests)

            // Resolve individual promises
            for (let i = 0; i < batch.length; i++) {
                batch[i].resolve(results[i])
            }
        } catch (error) {
            // Reject all promises in batch
            for (const item of batch) {
                item.reject(error as Error)
            }
        }
    }

    /**
     * Get current queue size
     */
    getQueueSize(): number {
        return this.queue.length
    }

    /**
     * Clear the queue without sending
     */
    clear(): void {
        if (this.batchTimeout) {
            clearTimeout(this.batchTimeout)
            this.batchTimeout = null
        }

        // Reject all pending requests
        for (const item of this.queue) {
            item.reject(new Error('Batch queue cleared'))
        }

        this.queue = []
    }
}
