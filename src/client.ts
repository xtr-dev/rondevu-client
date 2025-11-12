import {
  RondevuClientOptions,
  CreateOfferRequest,
  CreateOfferResponse,
  AnswerRequest,
  AnswerResponse,
  PollRequest,
  PollOffererResponse,
  PollAnswererResponse,
  VersionResponse,
  HealthResponse,
  ErrorResponse,
  Side,
} from './types.js';

/**
 * HTTP API client for Rondevu peer signaling server
 */
export class RondevuAPI {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  /**
   * Creates a new Rondevu API client instance
   * @param options - Client configuration options
   */
  constructor(options: RondevuClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.fetchImpl = options.fetch || globalThis.fetch.bind(globalThis);
  }

  /**
   * Makes an HTTP request to the Rondevu server
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
    };

    if (options.body) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await this.fetchImpl(url, {
      ...options,
      headers,
    });

    const data = await response.json();

    if (!response.ok) {
      const error = data as ErrorResponse;
      throw new Error(error.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    return data as T;
  }

  /**
   * Gets server version information
   *
   * @returns Server version
   *
   * @example
   * ```typescript
   * const api = new RondevuAPI({ baseUrl: 'https://example.com' });
   * const { version } = await api.getVersion();
   * console.log('Server version:', version);
   * ```
   */
  async getVersion(): Promise<VersionResponse> {
    return this.request<VersionResponse>('/', {
      method: 'GET',
    });
  }

  /**
   * Creates a new offer
   *
   * @param request - Offer details including peer ID, signaling data, and optional custom code
   * @returns Unique offer code (UUID or custom code)
   *
   * @example
   * ```typescript
   * const api = new RondevuAPI({ baseUrl: 'https://example.com' });
   * const { code } = await api.createOffer({
   *   peerId: 'peer-123',
   *   offer: signalingData,
   *   code: 'my-custom-code' // optional
   * });
   * console.log('Offer code:', code);
   * ```
   */
  async createOffer(request: CreateOfferRequest): Promise<CreateOfferResponse> {
    return this.request<CreateOfferResponse>('/offer', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /**
   * Sends an answer or candidate to an existing offer
   *
   * @param request - Answer details including offer code and signaling data
   * @returns Success confirmation
   *
   * @example
   * ```typescript
   * const api = new RondevuAPI({ baseUrl: 'https://example.com' });
   *
   * // Send answer
   * await api.sendAnswer({
   *   code: offerCode,
   *   answer: answerData,
   *   side: 'answerer'
   * });
   *
   * // Send candidate
   * await api.sendAnswer({
   *   code: offerCode,
   *   candidate: candidateData,
   *   side: 'offerer'
   * });
   * ```
   */
  async sendAnswer(request: AnswerRequest): Promise<AnswerResponse> {
    return this.request<AnswerResponse>('/answer', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /**
   * Polls for offer data from the other peer
   *
   * @param code - Offer code
   * @param side - Which side is polling ('offerer' or 'answerer')
   * @returns Offer data including offers, answers, and candidates
   *
   * @example
   * ```typescript
   * const api = new RondevuAPI({ baseUrl: 'https://example.com' });
   *
   * // Offerer polls for answer
   * const offererData = await api.poll(offerCode, 'offerer');
   * if (offererData.answer) {
   *   console.log('Received answer:', offererData.answer);
   * }
   *
   * // Answerer polls for offer
   * const answererData = await api.poll(offerCode, 'answerer');
   * console.log('Received offer:', answererData.offer);
   * ```
   */
  async poll(
    code: string,
    side: Side
  ): Promise<PollOffererResponse | PollAnswererResponse> {
    const request: PollRequest = { code, side };
    return this.request<PollOffererResponse | PollAnswererResponse>('/poll', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /**
   * Checks server health and version
   *
   * @returns Health status, timestamp, and version
   *
   * @example
   * ```typescript
   * const api = new RondevuAPI({ baseUrl: 'https://example.com' });
   * const health = await api.health();
   * console.log('Server status:', health.status);
   * console.log('Server version:', health.version);
   * ```
   */
  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>('/health', {
      method: 'GET',
    });
  }

  /**
   * Ends a session by deleting the offer from the server
   *
   * @param code - The offer code
   * @returns Success confirmation
   *
   * @example
   * ```typescript
   * const api = new RondevuAPI({ baseUrl: 'https://example.com' });
   * await api.leave('my-offer-code');
   * ```
   */
  async leave(code: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>('/leave', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  }
}
