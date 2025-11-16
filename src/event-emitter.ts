/**
 * Type-safe EventEmitter implementation for browser and Node.js compatibility
 *
 * @template EventMap - A type mapping event names to their handler signatures
 *
 * @example
 * ```typescript
 * interface MyEvents {
 *   'data': (value: string) => void;
 *   'error': (error: Error) => void;
 *   'ready': () => void;
 * }
 *
 * class MyClass extends EventEmitter<MyEvents> {
 *   doSomething() {
 *     this.emit('data', 'hello'); // Type-safe!
 *     this.emit('error', new Error('oops')); // Type-safe!
 *     this.emit('ready'); // Type-safe!
 *   }
 * }
 *
 * const instance = new MyClass();
 * instance.on('data', (value) => {
 *   console.log(value.toUpperCase()); // 'value' is typed as string
 * });
 * ```
 */
export class EventEmitter<EventMap extends Record<string, (...args: any[]) => void>> {
  private events: Map<keyof EventMap, Set<Function>> = new Map();

  /**
   * Register an event listener
   */
  on<K extends keyof EventMap>(event: K, listener: EventMap[K]): this {
    if (!this.events.has(event)) {
      this.events.set(event, new Set());
    }
    this.events.get(event)!.add(listener);
    return this;
  }

  /**
   * Register a one-time event listener
   */
  once<K extends keyof EventMap>(event: K, listener: EventMap[K]): this {
    const onceWrapper = (...args: Parameters<EventMap[K]>) => {
      this.off(event, onceWrapper as EventMap[K]);
      listener(...args);
    };
    return this.on(event, onceWrapper as EventMap[K]);
  }

  /**
   * Remove an event listener
   */
  off<K extends keyof EventMap>(event: K, listener: EventMap[K]): this {
    const listeners = this.events.get(event);
    if (listeners) {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.events.delete(event);
      }
    }
    return this;
  }

  /**
   * Emit an event
   */
  protected emit<K extends keyof EventMap>(
    event: K,
    ...args: Parameters<EventMap[K]>
  ): boolean {
    const listeners = this.events.get(event);
    if (!listeners || listeners.size === 0) {
      return false;
    }

    listeners.forEach(listener => {
      try {
        (listener as EventMap[K])(...args);
      } catch (err) {
        console.error(`Error in ${String(event)} event listener:`, err);
      }
    });

    return true;
  }

  /**
   * Remove all listeners for an event (or all events if not specified)
   */
  removeAllListeners<K extends keyof EventMap>(event?: K): this {
    if (event !== undefined) {
      this.events.delete(event);
    } else {
      this.events.clear();
    }
    return this;
  }

  /**
   * Get listener count for an event
   */
  listenerCount<K extends keyof EventMap>(event: K): number {
    const listeners = this.events.get(event);
    return listeners ? listeners.size : 0;
  }
}
