# Rondevu WebRTC Local Test

Simple side-by-side demo for testing `WebRTCRondevuConnection` with **local signaling** (no server required).

## Quick Start

```bash
npm run dev
```

Opens browser at `http://localhost:3000`

## How It Works

This demo uses **local in-memory signaling** to test WebRTC connections between two peers on the same page. The `LocalSignaler` class simulates a signaling server by directly exchanging ICE candidates and SDP between peers.

### Architecture

- **LocalSignaler**: Implements the `Signaler` interface with local peer-to-peer communication
- **Host (Peer A)**: Creates the offer (offerer role)
- **Client (Peer B)**: Receives the offer and creates answer (answerer role)
- **ICE Exchange**: Candidates are automatically exchanged between peers through the linked signalers

## Usage Steps

1. **Create Host** (Peer A)
   - Click "1️⃣ Create Host Connection" on the left side
   - The host will create an offer and display it
   - Status changes to "Connecting"

2. **Create Client** (Peer B)
   - Click "2️⃣ Create Client Connection" on the right side
   - The client receives the host's offer automatically
   - Creates an answer and sends it back to the host
   - Both peers exchange ICE candidates

3. **Connection Established**
   - Watch the status indicators turn green ("Connected")
   - Activity logs show the connection progress

4. **Send Messages**
   - Type a message in either peer's input field
   - Click "📤 Send" or press Enter
   - Messages appear in the other peer's activity log

## Features

- ✅ **No signaling server required** - Everything runs locally
- ✅ **Automatic ICE candidate exchange** - Signalers handle candidate exchange
- ✅ **Real-time activity logs** - See exactly what's happening
- ✅ **Connection state indicators** - Visual feedback for connection status
- ✅ **Bidirectional messaging** - Send messages in both directions

## Code Structure

### demo.js

```javascript
// LocalSignaler - Implements local signaling
class LocalSignaler {
    addIceCandidate(candidate)  // Called when local peer has a candidate
    addListener(callback)        // Listen for remote candidates
    linkTo(remoteSignaler)      // Connect two signalers together
}

// Create and link signalers
const hostSignaler = new LocalSignaler('HOST', 'CLIENT')
const clientSignaler = new LocalSignaler('CLIENT', 'HOST')
hostSignaler.linkTo(clientSignaler)
clientSignaler.linkTo(hostSignaler)

// Create connections
const hostConnection = new WebRTCRondevuConnection({
    id: 'test-connection',
    host: 'client-peer',
    service: 'test.demo@1.0.0',
    offer: null,  // No offer = offerer role
    context: new WebRTCContext(hostSignaler)
})

const clientConnection = new WebRTCRondevuConnection({
    id: 'test-connection',
    host: 'host-peer',
    service: 'test.demo@1.0.0',
    offer: hostConnection.connection.localDescription,  // With offer = answerer role
    context: new WebRTCContext(clientSignaler)
})
```

### index.html

- Side-by-side layout for Host and Client
- Status indicators (disconnected/connecting/connected)
- SDP display areas (offer/answer)
- Message input and send buttons
- Activity logs for each peer

## Debugging

Open the browser console to see detailed logs:

- `[HOST]` - Logs from the host connection
- `[CLIENT]` - Logs from the client connection
- ICE candidate exchange
- Connection state changes
- Message send/receive events

## Comparison: Local vs Remote Signaling

### Local Signaling (This Demo)
```javascript
const signaler = new LocalSignaler('HOST', 'CLIENT')
signaler.linkTo(remoteSignaler)  // Direct link
```

**Pros**: No server, instant testing, no network latency
**Cons**: Only works for same-page testing

### Remote Signaling (Production)
```javascript
const api = new RondevuAPI('https://api.ronde.vu', credentials)
const signaler = new RondevuSignaler(api, offerId)
```

**Pros**: Real peer discovery, works across networks
**Cons**: Requires signaling server, network latency

## Next Steps

After testing locally, you can:

1. Switch to `RondevuSignaler` for real signaling server testing
2. Test across different browsers/devices
3. Test with STUN/TURN servers for NAT traversal
4. Implement production signaling with Rondevu API

## Files

- `index.html` - UI layout and styling
- `demo.js` - Local signaling implementation and WebRTC logic
- `README.md` - This file
