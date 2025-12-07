/**
 * Binnable - A cleanup function that can be synchronous or asynchronous
 *
 * Used to unsubscribe from events, close connections, or perform other cleanup operations.
 */
export type Binnable = () => void | Promise<void>

/**
 * Create a cleanup function collector (garbage bin)
 *
 * Collects cleanup functions and provides a single `clean()` method to execute all of them.
 * Useful for managing multiple cleanup operations in a single place.
 *
 * @returns A function that accepts cleanup functions and has a `clean()` method
 *
 * @example
 * ```typescript
 * const bin = createBin();
 *
 * // Add cleanup functions
 * bin(
 *   () => console.log('Cleanup 1'),
 *   () => connection.close(),
 *   () => clearInterval(timer)
 * );
 *
 * // Later, clean everything
 * bin.clean(); // Executes all cleanup functions
 * ```
 */
export const createBin = () => {
    const bin: Binnable[] = []
    return Object.assign((...rubbish: Binnable[]) => bin.push(...rubbish), {
        /**
         * Execute all cleanup functions and clear the bin
         */
        clean: (): void => {
            bin.forEach(binnable => binnable())
            bin.length = 0
        },
    })
}
