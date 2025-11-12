# Rondevu

🎯 **Simple WebRTC peer signaling**

Connect peers directly by ID with automatic WebRTC negotiation.

**Related repositories:**
- [rondevu-server](https://github.com/xtr-dev/rondevu-server) - HTTP signaling server
- [rondevu-demo](https://github.com/xtr-dev/rondevu-demo) - Interactive demo

---

## @xtr-dev/rondevu-client

[![npm version](https://img.shields.io/npm/v/@xtr-dev/rondevu-client)](https://www.npmjs.com/package/@xtr-dev/rondevu-client)

TypeScript client library for Rondevu peer signaling and WebRTC connection management. Handles automatic signaling, ICE candidate exchange, and connection establishment.

### Install

```bash
npm install @xtr-dev/rondevu-client
```

### Usage

#### Browser

```typescript
import { Rondevu } from '@xtr-dev/rondevu-client';

const rdv = new Rondevu({
  baseUrl: 'https://api.ronde.vu',
  rtcConfig: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  }
});

// Create an offer with custom ID
const connection = await rdv.offer('my-room-123');

// Or answer an existing offer
const connection = await rdv.answer('my-room-123');

// Use data channels
connection.on('connect', () => {
  const channel = connection.dataChannel('chat');
  channel.send('Hello!');
});

connection.on('datachannel', (channel) => {
  if (channel.label === 'chat') {
    channel.onmessage = (event) => {
      console.log('Received:', event.data);
    };
  }
});
```

#### Node.js

```typescript
import { Rondevu } from '@xtr-dev/rondevu-client';
import wrtc from '@roamhq/wrtc';
import fetch from 'node-fetch';

const rdv = new Rondevu({
  baseUrl: 'https://api.ronde.vu',
  fetch: fetch as any,
  wrtc: {
    RTCPeerConnection: wrtc.RTCPeerConnection,
    RTCSessionDescription: wrtc.RTCSessionDescription,
    RTCIceCandidate: wrtc.RTCIceCandidate,
  }
});

const connection = await rdv.offer('my-room-123');

connection.on('connect', () => {
  const channel = connection.dataChannel('chat');
  channel.send('Hello from Node.js!');
});
```

### API

**Main Methods:**
- `rdv.offer(id)` - Create an offer with custom ID
- `rdv.answer(id)` - Answer an existing offer by ID

**Connection Events:**
- `connect` - Connection established
- `disconnect` - Connection closed
- `error` - Connection error
- `datachannel` - New data channel received
- `stream` - Media stream received

**Connection Methods:**
- `connection.dataChannel(label)` - Get or create data channel
- `connection.addStream(stream)` - Add media stream
- `connection.close()` - Close connection

### Version Compatibility

The client automatically checks server compatibility via the `/health` endpoint. If the server version is incompatible, an error will be thrown during initialization.

### License

MIT
