import {
  RondevuClientOptions,
  ListTopicsResponse,
  ListSessionsResponse,
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
} from './types';

/**
 * HTTP client for Rondevu peer signaling and discovery server
 */
export class RondevuClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  /**
   * Creates a new Rondevu client instance
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
   * @returns Server version (git commit hash)
   *
   * @example
   * ```typescript
   * const client = new RondevuClient({ baseUrl: 'https://example.com' });
   * const { version } = await client.getVersion();
   * console.log('Server version:', version);
   * ```
   */
  async getVersion(): Promise<VersionResponse> {
    return this.request<VersionResponse>('/', {
      method: 'GET',
    });
  }

  /**
   * Lists all topics with peer counts
   *
   * @param page - Page number (starting from 1)
   * @param limit - Results per page (max 1000)
   * @returns List of topics with pagination info
   *
   * @example
   * ```typescript
   * const client = new RondevuClient({ baseUrl: 'https://example.com' });
   * const { topics, pagination } = await client.listTopics();
   * console.log(`Found ${topics.length} topics`);
   * ```
   */
  async listTopics(page = 1, limit = 100): Promise<ListTopicsResponse> {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
    });
    return this.request<ListTopicsResponse>(`/topics?${params}`, {
      method: 'GET',
    });
  }

  /**
   * Discovers available peers for a given topic
   *
   * @param topic - Topic identifier
   * @returns List of available sessions
   *
   * @example
   * ```typescript
   * const client = new RondevuClient({ baseUrl: 'https://example.com' });
   * const { sessions } = await client.listSessions('my-room');
   * const otherPeers = sessions.filter(s => s.peerId !== myPeerId);
   * ```
   */
  async listSessions(topic: string): Promise<ListSessionsResponse> {
    return this.request<ListSessionsResponse>(`/${encodeURIComponent(topic)}/sessions`, {
      method: 'GET',
    });
  }

  /**
   * Announces peer availability and creates a new session
   *
   * @param topic - Topic identifier for grouping peers (max 1024 characters)
   * @param request - Offer details including peer ID and signaling data
   * @returns Unique session code (UUID)
   *
   * @example
   * ```typescript
   * const client = new RondevuClient({ baseUrl: 'https://example.com' });
   * const { code } = await client.createOffer('my-room', {
   *   peerId: 'peer-123',
   *   offer: signalingData
   * });
   * console.log('Session code:', code);
   * ```
   */
  async createOffer(
    topic: string,
    request: CreateOfferRequest
  ): Promise<CreateOfferResponse> {
    return this.request<CreateOfferResponse>(
      `/${encodeURIComponent(topic)}/offer`,
      {
        method: 'POST',
        body: JSON.stringify(request),
      }
    );
  }

  /**
   * Sends an answer or candidate to an existing session
   *
   * @param request - Answer details including session code and signaling data
   * @returns Success confirmation
   *
   * @example
   * ```typescript
   * const client = new RondevuClient({ baseUrl: 'https://example.com' });
   *
   * // Send answer
   * await client.sendAnswer({
   *   code: sessionCode,
   *   answer: answerData,
   *   side: 'answerer'
   * });
   *
   * // Send candidate
   * await client.sendAnswer({
   *   code: sessionCode,
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
   * Polls for session data from the other peer
   *
   * @param code - Session UUID
   * @param side - Which side is polling ('offerer' or 'answerer')
   * @returns Session data including offers, answers, and candidates
   *
   * @example
   * ```typescript
   * const client = new RondevuClient({ baseUrl: 'https://example.com' });
   *
   * // Offerer polls for answer
   * const offererData = await client.poll(sessionCode, 'offerer');
   * if (offererData.answer) {
   *   console.log('Received answer:', offererData.answer);
   * }
   *
   * // Answerer polls for offer
   * const answererData = await client.poll(sessionCode, 'answerer');
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
   * Checks server health
   *
   * @returns Health status and timestamp
   *
   * @example
   * ```typescript
   * const client = new RondevuClient({ baseUrl: 'https://example.com' });
   * const health = await client.health();
   * console.log('Server status:', health.status);
   * ```
   */
  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>('/health', {
      method: 'GET',
    });
  }
}
