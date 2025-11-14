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
   */
  async register(): Promise<Credentials> {
    const response = await this.fetchFn(`${this.baseUrl}/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
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
