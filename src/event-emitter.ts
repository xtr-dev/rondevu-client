/**
 * Simple EventEmitter implementation for browser and Node.js compatibility
 */
export class EventEmitter {
  private events: Map<string, Set<Function>>;

  constructor() {
    this.events = new Map();
  }

  /**
   * Register an event listener
   */
  on(event: string, listener: Function): this {
    if (!this.events.has(event)) {
      this.events.set(event, new Set());
    }
    this.events.get(event)!.add(listener);
    return this;
  }

  /**
   * Register a one-time event listener
   */
  once(event: string, listener: Function): this {
    const onceWrapper = (...args: any[]) => {
      this.off(event, onceWrapper);
      listener.apply(this, args);
    };
    return this.on(event, onceWrapper);
  }

  /**
   * Remove an event listener
   */
  off(event: string, listener: Function): this {
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
  emit(event: string, ...args: any[]): boolean {
    const listeners = this.events.get(event);
    if (!listeners || listeners.size === 0) {
      return false;
    }

    listeners.forEach(listener => {
      try {
        listener.apply(this, args);
      } catch (err) {
        console.error(`Error in ${event} event listener:`, err);
      }
    });

    return true;
  }

  /**
   * Remove all listeners for an event (or all events if not specified)
   */
  removeAllListeners(event?: string): this {
    if (event) {
      this.events.delete(event);
    } else {
      this.events.clear();
    }
    return this;
  }

  /**
   * Get listener count for an event
   */
  listenerCount(event: string): number {
    const listeners = this.events.get(event);
    return listeners ? listeners.size : 0;
  }
}
