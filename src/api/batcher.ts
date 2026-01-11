/**
 * RPC Request Batcher with throttling
 *
 * Collects RPC requests over a short time window and sends them in a single
 * HTTP request. Each request includes its own auth credentials in the JSON body,
 * allowing true batching of authenticated requests.
 */

export interface RpcRequest {
    method: string
    params?: any
}

/**
 * Per-request authentication credentials
 */
export interface RequestAuth {
    publicKey: string
    timestamp: number
    nonce: string
    signature: string
}

/**
 * Wire format for requests sent to server
 */
interface WireRequest {
    method: string
    params?: any
    auth?: RequestAuth
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
    /** Maximum batch size (default: 50) */
    maxBatchSize?: number
}

interface QueuedRequest {
    request: RpcRequest
    auth: RequestAuth | null
    resolve: (value: any) => void
    reject: (error: Error) => void
}

/**
 * RpcBatcher - Batches RPC requests with throttling
 *
 * All requests (authenticated and unauthenticated) are batched together
 * into a single HTTP request. Auth credentials are included per-request
 * in the JSON body.
 *
 * @example
 * ```typescript
 * const batcher = new RpcBatcher('https://api.example.com', {
 *   delay: 10,
 *   maxBatchSize: 50
 * })
 *
 * // Requests made within the delay window are batched into ONE HTTP call
 * const [result1, result2] = await Promise.all([
 *   batcher.add({ method: 'publish', params: {...} }, auth1),
 *   batcher.add({ method: 'discover', params: {...} }, auth2)
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
     * @param auth - Per-request auth credentials, null for unauthenticated
     * @returns Promise that resolves with the request result
     */
    add(request: RpcRequest, auth: RequestAuth | null): Promise<any> {
        return new Promise((resolve, reject) => {
            this.queue.push({ request, auth, resolve, reject })
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

        // Split into chunks of maxBatchSize and send each chunk
        for (let i = 0; i < items.length; i += this.maxBatchSize) {
            const chunk = items.slice(i, i + this.maxBatchSize)
            await this.sendBatch(chunk)
        }
    }

    /**
     * Send a batch of requests in a single HTTP call
     * Each request includes its own auth credentials in the JSON body
     */
    private async sendBatch(items: QueuedRequest[]): Promise<void> {
        try {
            // Build wire requests with per-request auth
            const wireRequests: WireRequest[] = items.map(item => {
                const wireReq: WireRequest = {
                    method: item.request.method,
                    params: item.request.params,
                }
                if (item.auth) {
                    wireReq.auth = item.auth
                }
                return wireReq
            })

            const response = await fetch(`${this.baseUrl}/rpc`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(wireRequests),
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
