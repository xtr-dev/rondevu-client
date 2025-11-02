/**
 * @rondevu/client - TypeScript client for Rondevu peer signaling server
 *
 * @example
 * ```typescript
 * import { RondevuClient } from '@rondevu/client';
 *
 * const client = new RondevuClient({
 *   baseUrl: 'https://rondevu.example.com'
 * });
 *
 * // Create an offer
 * const { code } = await client.createOffer('my-room', {
 *   info: 'peer-123',
 *   offer: signalingData
 * });
 *
 * // Discover peers
 * const { sessions } = await client.listSessions('my-room');
 *
 * // Send answer
 * await client.sendAnswer({
 *   code: sessions[0].code,
 *   answer: answerData,
 *   side: 'answerer'
 * });
 * ```
 */

export { RondevuClient } from './client';
export * from './types';
