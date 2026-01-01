/**
 * RPC Request Batcher with throttling
 *
 * Collects RPC requests over a short time window and sends them efficiently.
 *
 * Due to server authentication design (signature covers method+params),
 * authenticated requests are sent individually while unauthenticated
 * requests can be truly batched together.
 */

export interface RpcRequest {
    method: string
    params?: any
}

export interface RpcResponse {
    success: boolean
    result?: any
    error?: string
    errorCode?: string
}

export interface BatcherOptions {
    /** Delay in ms before flushing queued requests (default: 10) */
    delay?: number
    /** Maximum batch size for unauthenticated requests (default: 50) */
    maxBatchSize?: number
}

interface QueuedRequest {
    request: RpcRequest
    authHeaders: Record<string, string> | null
    resolve: (value: any) => void
    reject: (error: Error) => void
}

/**
 * RpcBatcher - Batches RPC requests with throttling
 *
 * @example
 * ```typescript
 * const batcher = new RpcBatcher('https://api.example.com', {
 *   delay: 10,
 *   maxBatchSize: 50
 * })
 *
 * // Requests made within the delay window are batched
 * const [result1, result2] = await Promise.all([
 *   batcher.add({ method: 'getOffer', params: {...} }, null),
 *   batcher.add({ method: 'getOffer', params: {...} }, null)
 * ])
 * ```
 */
export class RpcBatcher {
    private queue: QueuedRequest[] = []
    private flushTimer: ReturnType<typeof setTimeout> | null = null
    private readonly delay: number
    private readonly maxBatchSize: number

    constructor(
        private readonly baseUrl: string,
        options: BatcherOptions = {}
    ) {
        this.delay = options.delay ?? 10
        this.maxBatchSize = options.maxBatchSize ?? 50
    }

    /**
     * Add a request to the batch queue
     * @param request - The RPC request
     * @param authHeaders - Auth headers for authenticated requests, null for unauthenticated
     * @returns Promise that resolves with the request result
     */
    add(request: RpcRequest, authHeaders: Record<string, string> | null): Promise<any> {
        return new Promise((resolve, reject) => {
            this.queue.push({ request, authHeaders, resolve, reject })
            this.scheduleFlush()
        })
    }

    /**
     * Schedule a flush after the delay
     */
    private scheduleFlush(): void {
        if (this.flushTimer) return

        this.flushTimer = setTimeout(() => {
            this.flushTimer = null
            this.flush()
        }, this.delay)
    }

    /**
     * Flush all queued requests
     */
    private async flush(): Promise<void> {
        if (this.queue.length === 0) return

        const items = this.queue
        this.queue = []

        // Separate authenticated vs unauthenticated requests
        const unauthenticated: QueuedRequest[] = []
        const authenticated: QueuedRequest[] = []

        for (const item of items) {
            if (item.authHeaders) {
                authenticated.push(item)
            } else {
                unauthenticated.push(item)
            }
        }

        // Process unauthenticated requests in batches
        await this.processUnauthenticatedBatches(unauthenticated)

        // Process authenticated requests individually (each needs unique signature)
        await this.processAuthenticatedRequests(authenticated)
    }

    /**
     * Process unauthenticated requests in batches
     */
    private async processUnauthenticatedBatches(items: QueuedRequest[]): Promise<void> {
        if (items.length === 0) return

        // Split into chunks of maxBatchSize
        for (let i = 0; i < items.length; i += this.maxBatchSize) {
            const chunk = items.slice(i, i + this.maxBatchSize)
            await this.sendBatch(chunk, null)
        }
    }

    /**
     * Process authenticated requests individually
     * Each authenticated request needs its own HTTP call because
     * the signature covers the specific method+params
     */
    private async processAuthenticatedRequests(items: QueuedRequest[]): Promise<void> {
        // Send all authenticated requests in parallel, each as its own batch of 1
        await Promise.all(items.map(item => this.sendBatch([item], item.authHeaders)))
    }

    /**
     * Send a batch of requests
     */
    private async sendBatch(
        items: QueuedRequest[],
        authHeaders: Record<string, string> | null
    ): Promise<void> {
        try {
            const requests = items.map(item => item.request)

            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
            }

            if (authHeaders) {
                Object.assign(headers, authHeaders)
            }

            const response = await fetch(`${this.baseUrl}/rpc`, {
                method: 'POST',
                headers,
                body: JSON.stringify(requests), // Always send as array
            })

            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}: ${response.statusText}`)
                items.forEach(item => item.reject(error))
                return
            }

            const results: RpcResponse[] = await response.json()

            // Match responses to requests (server returns array in same order)
            items.forEach((item, index) => {
                const result = results[index]
                if (!result) {
                    item.reject(new Error('Missing response from server'))
                } else if (!result.success) {
                    item.reject(new Error(result.error || 'RPC call failed'))
                } else {
                    item.resolve(result.result)
                }
            })
        } catch (error) {
            // Network or parsing error - reject all
            items.forEach(item => item.reject(error as Error))
        }
    }

    /**
     * Flush immediately (useful for cleanup/testing)
     */
    async flushNow(): Promise<void> {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer)
            this.flushTimer = null
        }
        await this.flush()
    }
}
