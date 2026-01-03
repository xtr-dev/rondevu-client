/**
 * End-to-end test for Rondevu peer-to-peer connections
 *
 * Tests the full connection flow:
 * 1. Alice creates offers with tags
 * 2. Bob discovers and connects to Alice's offers
 * 3. Both peers exchange messages via WebRTC data channel
 *
 * Usage:
 *   npx tsx test/e2e-local.ts [apiUrl]
 *
 * Examples:
 *   npx tsx test/e2e-local.ts                    # Uses default api.ronde.vu
 *   npx tsx test/e2e-local.ts http://localhost:3000
 */

import { Rondevu } from '../src/core/rondevu.js'
import { NodeWebRTCAdapter } from '../src/webrtc/node.js'

// Use @roamhq/wrtc for WebRTC in Node.js
import wrtc from '@roamhq/wrtc'

const API_URL = process.argv[2] || 'https://api.ronde.vu'
const TEST_TAG = `test-e2e-${Date.now()}`

console.log('='.repeat(60))
console.log('Rondevu E2E Test')
console.log('='.repeat(60))
console.log(`API URL: ${API_URL}`)
console.log(`Test Tag: ${TEST_TAG}`)
console.log('='.repeat(60))
console.log()

// Create WebRTC adapter for Node.js
const webrtcAdapter = new NodeWebRTCAdapter({
    RTCPeerConnection: wrtc.RTCPeerConnection,
    RTCIceCandidate: wrtc.RTCIceCandidate,
})

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}

async function main() {
    let alice: Rondevu | null = null
    let bob: Rondevu | null = null
    let bobConnection: any = null

    try {
        // ============================================
        // Step 1: Create Alice (the offerer/publisher)
        // ============================================
        console.log('[1/6] Creating Alice (offerer)...')
        alice = await Rondevu.connect({
            apiUrl: API_URL,
            debug: true,
            webrtcAdapter,
        })
        console.log(`      Alice credential: ${alice.getName()}`)
        console.log()

        // ============================================
        // Step 2: Alice creates offers with tags
        // ============================================
        console.log('[2/6] Alice creating offers...')
        await alice.offer({
            tags: [TEST_TAG],
            maxOffers: 1,
        })
        console.log(`      Offers created with tag: ${TEST_TAG}`)
        console.log()

        // Start filling offers
        await alice.startFilling()

        // Set up Alice's connection handler
        const aliceReceivedMessages: string[] = []
        let aliceConnection: any = null
        let aliceConnected = false

        alice.on('connection:opened', (offerId, connection) => {
            console.log(`      [Alice] Connection opened: ${offerId}`)
            aliceConnection = connection

            connection.on('message', (data: string) => {
                console.log(`      [Alice] Received: ${data}`)
                aliceReceivedMessages.push(data)
            })

            connection.on('error', (error: Error) => {
                console.error('      [Alice] Error:', error.message)
            })

            // Check if already connected or wait for connected event
            if (connection.getState() === 'connected') {
                console.log('      [Alice] Already connected!')
                aliceConnected = true
            } else {
                connection.on('connected', () => {
                    console.log('      [Alice] Data channel connected!')
                    aliceConnected = true
                })
            }
        })

        // Give Alice time to create and publish offer
        await sleep(2000)

        // ============================================
        // Step 3: Create Bob (the answerer/consumer)
        // ============================================
        console.log('[3/6] Creating Bob (answerer)...')
        bob = await Rondevu.connect({
            apiUrl: API_URL,
            debug: true,
            webrtcAdapter,
        })
        console.log(`      Bob credential: ${bob.getName()}`)
        console.log()

        // ============================================
        // Step 4: Bob connects to Alice via tags
        // ============================================
        console.log('[4/6] Bob connecting to Alice...')
        const bobReceivedMessages: string[] = []

        bobConnection = await bob.connect({
            tags: [TEST_TAG],
        })

        let bobConnected = false

        bobConnection.on('message', (data: string) => {
            console.log(`      [Bob] Received: ${data}`)
            bobReceivedMessages.push(data)
        })

        bobConnection.on('error', (error: Error) => {
            console.error('      [Bob] Error:', error.message)
        })

        // Check if already connected or wait for connected event
        if (bobConnection.getState() === 'connected') {
            console.log('      [Bob] Already connected!')
            bobConnected = true
        } else {
            bobConnection.on('connected', () => {
                console.log('      [Bob] Data channel connected!')
                bobConnected = true
            })
        }

        console.log()

        // Wait for both sides to be connected before exchanging messages
        console.log('[5/6] Waiting for both peers to be connected...')
        const connectTimeout = 15000
        const connectStart = Date.now()
        while (Date.now() - connectStart < connectTimeout) {
            if (aliceConnected && bobConnected) {
                break
            }
            await sleep(100)
        }

        if (!aliceConnected || !bobConnected) {
            throw new Error(`Connection timeout: Alice=${aliceConnected}, Bob=${bobConnected}`)
        }

        // Small delay to ensure data channels are fully ready
        await sleep(500)

        // Now exchange messages
        console.log('      Exchanging messages...')
        if (aliceConnection) {
            aliceConnection.send('Hello from Alice!')
        }
        bobConnection.send('Hello from Bob!')

        // Wait for messages to be exchanged (up to 10 seconds)
        const timeout = 10000
        const startTime = Date.now()

        while (Date.now() - startTime < timeout) {
            if (aliceReceivedMessages.length > 0 && bobReceivedMessages.length > 0) {
                break
            }
            await sleep(100)
        }

        console.log()

        // ============================================
        // Step 6: Verify results
        // ============================================
        console.log('[6/6] Verifying results...')
        console.log()

        const aliceReceivedBobMessage = aliceReceivedMessages.includes('Hello from Bob!')
        const bobReceivedAliceMessage = bobReceivedMessages.includes('Hello from Alice!')

        console.log('Results:')
        console.log(`  Alice received Bob's message: ${aliceReceivedBobMessage ? '✅' : '❌'}`)
        console.log(`  Bob received Alice's message: ${bobReceivedAliceMessage ? '✅' : '❌'}`)
        console.log()

        if (aliceReceivedBobMessage && bobReceivedAliceMessage) {
            console.log('='.repeat(60))
            console.log('✅ TEST PASSED: Peer-to-peer connection successful!')
            console.log('='.repeat(60))
            process.exitCode = 0
        } else {
            console.log('='.repeat(60))
            console.log('❌ TEST FAILED: Messages not exchanged')
            console.log('='.repeat(60))
            console.log()
            console.log('Debug info:')
            console.log(`  Alice received: ${JSON.stringify(aliceReceivedMessages)}`)
            console.log(`  Bob received: ${JSON.stringify(bobReceivedMessages)}`)
            process.exitCode = 1
        }
    } catch (error) {
        console.error()
        console.error('='.repeat(60))
        console.error('❌ TEST FAILED: Error occurred')
        console.error('='.repeat(60))
        console.error()
        console.error('Error:', error)
        process.exitCode = 1
    } finally {
        // Cleanup
        console.log()
        console.log('Cleaning up...')

        if (bobConnection) {
            try {
                bobConnection.close()
            } catch {
                // Ignore cleanup errors
            }
        }
        if (alice) {
            try {
                alice.stopFilling()
            } catch {
                // Ignore cleanup errors
            }
            try {
                alice.disconnectAll()
            } catch {
                // Ignore cleanup errors
            }
        }
        if (bob) {
            try {
                bob.disconnectAll()
            } catch {
                // Ignore cleanup errors
            }
        }

        // Give time for cleanup
        await sleep(1000)
        console.log('Done.')
    }
}

main()
