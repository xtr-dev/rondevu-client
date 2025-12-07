import { WebRTCRondevuConnection } from '../src/index.js'
import { WebRTCContext } from '../src/webrtc-context.js'

// Local signaling implementation for testing
class LocalSignaler {
    constructor(name, remoteName) {
        this.name = name
        this.remoteName = remoteName
        this.iceCandidates = []
        this.iceListeners = []
        this.remote = null
        this.remoteIceCandidates = []
        this.offerCallbacks = []
        this.answerCallbacks = []
    }

    // Link two signalers together
    linkTo(remoteSignaler) {
        this.remote = remoteSignaler
        this.remoteIceCandidates = remoteSignaler.iceCandidates
    }

    // Set local offer (called when offer is created)
    setOffer(offer) {
        console.log(`[${this.name}] Setting offer`)
        // Notify remote peer about the offer
        if (this.remote) {
            this.remote.offerCallbacks.forEach(callback => callback(offer))
        }
    }

    // Set local answer (called when answer is created)
    setAnswer(answer) {
        console.log(`[${this.name}] Setting answer`)
        // Notify remote peer about the answer
        if (this.remote) {
            this.remote.answerCallbacks.forEach(callback => callback(answer))
        }
    }

    // Listen for offers from remote peer
    addOfferListener(callback) {
        this.offerCallbacks.push(callback)
        return () => {
            const index = this.offerCallbacks.indexOf(callback)
            if (index > -1) {
                this.offerCallbacks.splice(index, 1)
            }
        }
    }

    // Listen for answers from remote peer
    addAnswerListener(callback) {
        this.answerCallbacks.push(callback)
        return () => {
            const index = this.answerCallbacks.indexOf(callback)
            if (index > -1) {
                this.answerCallbacks.splice(index, 1)
            }
        }
    }

    // Add local ICE candidate (called by local connection)
    addIceCandidate(candidate) {
        console.log(`[${this.name}] Adding ICE candidate:`, candidate.candidate)
        this.iceCandidates.push(candidate)

        // Immediately send to remote peer if linked
        if (this.remote) {
            setTimeout(() => {
                this.remote.iceListeners.forEach(listener => {
                    console.log(`[${this.name}] Sending ICE to ${this.remoteName}`)
                    listener(candidate)
                })
            }, 10)
        }
    }

    // Listen for remote ICE candidates
    addListener(callback) {
        console.log(`[${this.name}] Adding ICE listener`)
        this.iceListeners.push(callback)

        // Send any existing remote candidates
        this.remoteIceCandidates.forEach(candidate => {
            setTimeout(() => callback(candidate), 10)
        })

        return () => {
            const index = this.iceListeners.indexOf(callback)
            if (index > -1) {
                this.iceListeners.splice(index, 1)
            }
        }
    }
}

// Create signalers for host and client
const hostSignaler = new LocalSignaler('HOST', 'CLIENT')
const clientSignaler = new LocalSignaler('CLIENT', 'HOST')

// Link them together for bidirectional communication
hostSignaler.linkTo(clientSignaler)
clientSignaler.linkTo(hostSignaler)

// Store connections
let hostConnection = null
let clientConnection = null

// UI Update functions
function updateStatus(peer, state) {
    const statusEl = document.getElementById(`status-${peer}`)
    if (statusEl) {
        statusEl.className = `status ${state}`
        statusEl.textContent = state.charAt(0).toUpperCase() + state.slice(1)
    }
}

function addLog(peer, message) {
    const logEl = document.getElementById(`log-${peer}`)
    if (logEl) {
        const time = new Date().toLocaleTimeString()
        logEl.innerHTML += `<div class="log-entry">[${time}] ${message}</div>`
        logEl.scrollTop = logEl.scrollHeight
    }
}

// Create Host (Offerer)
async function createHost() {
    try {
        addLog('a', 'Creating host connection (offerer)...')

        const hostContext = new WebRTCContext(hostSignaler)

        hostConnection = new WebRTCRondevuConnection({
            id: 'test-connection',
            host: 'client-peer',
            service: 'test.demo@1.0.0',
            offer: null,
            context: hostContext,
        })

        // Listen for state changes
        hostConnection.events.on('state-change', state => {
            console.log('[HOST] State changed:', state)
            updateStatus('a', state)
            addLog('a', `State changed to: ${state}`)
        })

        // Listen for messages
        hostConnection.events.on('message', message => {
            console.log('[HOST] Received message:', message)
            addLog('a', `📨 Received: ${message}`)
        })

        addLog('a', '✅ Host connection created')
        updateStatus('a', 'connecting')

        // Wait for host to be ready (offer created and set)
        await hostConnection.ready
        addLog('a', '✅ Host offer created')

        // Get the offer
        const offer = hostConnection.connection.localDescription
        document.getElementById('offer-a').value = JSON.stringify(offer, null, 2)

        addLog('a', 'Offer ready to send to client')
    } catch (error) {
        console.error('[HOST] Error:', error)
        addLog('a', `❌ Error: ${error.message}`)
        updateStatus('a', 'disconnected')
    }
}

// Create Client (Answerer)
async function createClient() {
    try {
        addLog('b', 'Creating client connection (answerer)...')

        // Get offer from host
        if (!hostConnection) {
            alert('Please create host first!')
            return
        }

        const offer = hostConnection.connection.localDescription
        if (!offer) {
            alert('Host offer not ready yet!')
            return
        }

        addLog('b', 'Got offer from host')

        const clientContext = new WebRTCContext(clientSignaler)

        clientConnection = new WebRTCRondevuConnection({
            id: 'test-connection',
            host: 'host-peer',
            service: 'test.demo@1.0.0',
            offer: offer,
            context: clientContext,
        })

        // Listen for state changes
        clientConnection.events.on('state-change', state => {
            console.log('[CLIENT] State changed:', state)
            updateStatus('b', state)
            addLog('b', `State changed to: ${state}`)
        })

        // Listen for messages
        clientConnection.events.on('message', message => {
            console.log('[CLIENT] Received message:', message)
            addLog('b', `📨 Received: ${message}`)
        })

        addLog('b', '✅ Client connection created')
        updateStatus('b', 'connecting')

        // Wait for client to be ready
        await clientConnection.ready
        addLog('b', '✅ Client answer created')

        // Get the answer
        const answer = clientConnection.connection.localDescription
        document.getElementById('answer-b').value = JSON.stringify(answer, null, 2)

        // Set answer on host
        addLog('b', 'Setting answer on host...')
        await hostConnection.connection.setRemoteDescription(answer)
        addLog('b', '✅ Answer set on host')
        addLog('a', '✅ Answer received from client')
    } catch (error) {
        console.error('[CLIENT] Error:', error)
        addLog('b', `❌ Error: ${error.message}`)
        updateStatus('b', 'disconnected')
    }
}

// Send test message from host to client
function sendFromHost() {
    if (!hostConnection) {
        alert('Please create host first!')
        return
    }

    const message = document.getElementById('message-a').value || 'Hello from Host!'
    addLog('a', `📤 Sending: ${message}`)
    hostConnection
        .sendMessage(message)
        .then(success => {
            if (success) {
                addLog('a', '✅ Message sent successfully')
            } else {
                addLog('a', '⚠️ Message queued (not connected)')
            }
        })
        .catch(error => {
            addLog('a', `❌ Error sending: ${error.message}`)
        })
}

// Send test message from client to host
function sendFromClient() {
    if (!clientConnection) {
        alert('Please create client first!')
        return
    }

    const message = document.getElementById('message-b').value || 'Hello from Client!'
    addLog('b', `📤 Sending: ${message}`)
    clientConnection
        .sendMessage(message)
        .then(success => {
            if (success) {
                addLog('b', '✅ Message sent successfully')
            } else {
                addLog('b', '⚠️ Message queued (not connected)')
            }
        })
        .catch(error => {
            addLog('b', `❌ Error sending: ${error.message}`)
        })
}

// Attach event listeners when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Clear all textareas on load
    document.getElementById('offer-a').value = ''
    document.getElementById('answer-b').value = ''

    // Make functions globally available (for console testing)
    window.createHost = createHost
    window.createClient = createClient
    window.sendFromHost = sendFromHost
    window.sendFromClient = sendFromClient

    console.log('🚀 Local signaling test loaded')
    console.log('Steps:')
    console.log('1. Click "Create Host" (Peer A)')
    console.log('2. Click "Create Client" (Peer B)')
    console.log('3. Wait for connection to establish')
    console.log('4. Send messages between peers')
})
