export interface Credentials {
  peerId: string;
  secret: string;
}

// Fetch-compatible function type
export type FetchFunction = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export class RondevuAuth {
  private fetchFn: FetchFunction;

  constructor(
    private baseUrl: string,
    fetchFn?: FetchFunction
  ) {
    // Use provided fetch or fall back to global fetch
    this.fetchFn = fetchFn || ((...args) => {
      if (typeof globalThis.fetch === 'function') {
        return globalThis.fetch(...args);
      }
      throw new Error(
        'fetch is not available. Please provide a fetch implementation in the constructor options.'
      );
    });
  }

  /**
   * Register a new peer and receive credentials
   * @param customPeerId - Optional custom peer ID (1-128 characters). If not provided, a random ID will be generated.
   * @throws Error if registration fails (e.g., peer ID already in use)
   */
  async register(customPeerId?: string): Promise<Credentials> {
    const body: { peerId?: string } = {};
    if (customPeerId !== undefined) {
      body.peerId = customPeerId;
    }

    const response = await this.fetchFn(`${this.baseUrl}/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(`Registration failed: ${error.error || response.statusText}`);
    }

    const data = await response.json();
    return {
      peerId: data.peerId,
      secret: data.secret,
    };
  }

  /**
   * Create Authorization header value
   */
  static createAuthHeader(credentials: Credentials): string {
    return `Bearer ${credentials.peerId}:${credentials.secret}`;
  }
}
