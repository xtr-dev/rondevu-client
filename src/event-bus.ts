/**
 * Type-safe EventBus with event name to payload type mapping
 */

type EventHandler<T = any> = (data: T) => void;

/**
 * EventBus - Type-safe event emitter with inferred event data types
 *
 * @example
 * interface MyEvents {
 *   'user:connected': { userId: string; timestamp: number };
 *   'user:disconnected': { userId: string };
 *   'message:received': string;
 * }
 *
 * const bus = new EventBus<MyEvents>();
 *
 * // TypeScript knows data is { userId: string; timestamp: number }
 * bus.on('user:connected', (data) => {
 *   console.log(data.userId, data.timestamp);
 * });
 *
 * // TypeScript knows data is string
 * bus.on('message:received', (data) => {
 *   console.log(data.toUpperCase());
 * });
 */
export class EventBus<TEvents extends Record<string, any>> {
  private handlers: Map<keyof TEvents, Set<EventHandler>>;

  constructor() {
    this.handlers = new Map();
  }

  /**
   * Subscribe to an event
   */
  on<K extends keyof TEvents>(event: K, handler: EventHandler<TEvents[K]>): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  /**
   * Subscribe to an event once (auto-unsubscribe after first call)
   */
  once<K extends keyof TEvents>(event: K, handler: EventHandler<TEvents[K]>): void {
    const wrappedHandler = (data: TEvents[K]) => {
      handler(data);
      this.off(event, wrappedHandler);
    };
    this.on(event, wrappedHandler);
  }

  /**
   * Unsubscribe from an event
   */
  off<K extends keyof TEvents>(event: K, handler: EventHandler<TEvents[K]>): void {
    const eventHandlers = this.handlers.get(event);
    if (eventHandlers) {
      eventHandlers.delete(handler);
      if (eventHandlers.size === 0) {
        this.handlers.delete(event);
      }
    }
  }

  /**
   * Emit an event with data
   */
  emit<K extends keyof TEvents>(event: K, data: TEvents[K]): void {
    const eventHandlers = this.handlers.get(event);
    if (eventHandlers) {
      eventHandlers.forEach(handler => handler(data));
    }
  }

  /**
   * Remove all handlers for a specific event, or all handlers if no event specified
   */
  clear<K extends keyof TEvents>(event?: K): void {
    if (event !== undefined) {
      this.handlers.delete(event);
    } else {
      this.handlers.clear();
    }
  }
}