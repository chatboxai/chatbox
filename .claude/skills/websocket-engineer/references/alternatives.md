# Real-Time Communication Alternatives

## Technology Comparison

| Feature | WebSocket | SSE | Long Polling | HTTP/2 Push | WebRTC |
|---------|-----------|-----|--------------|-------------|--------|
| Bidirectional | Yes | No | Yes | No | Yes |
| Real-time | Yes | Yes | Near | Yes | Yes |
| Browser Support | Excellent | Good | Universal | Good | Good |
| Proxy Issues | Some | Rare | Rare | Some | Some |
| Overhead | Low | Low | High | Medium | Medium |
| Use Case | Chat, games | Feeds, updates | Legacy | Assets | Audio/video |

## Server-Sent Events (SSE)

### When to Use SSE

- One-way server-to-client communication
- Live feeds, notifications, stock tickers
- Automatic reconnection needed
- Simpler than WebSockets
- Better firewall/proxy compatibility

### SSE Server (Node.js)

```javascript
const express = require('express');
const app = express();

app.get('/events', (req, res) => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Send initial connection message
  res.write('data: {"message": "Connected"}\n\n');

  // Send updates every 5 seconds
  const intervalId = setInterval(() => {
    const data = {
      timestamp: Date.now(),
      value: Math.random()
    };

    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }, 5000);

  // Cleanup on client disconnect
  req.on('close', () => {
    clearInterval(intervalId);
    res.end();
  });
});

app.listen(3000);
```

### SSE Client

```javascript
const eventSource = new EventSource('http://localhost:3000/events');

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Received:', data);
};

eventSource.onerror = (error) => {
  console.error('SSE error:', error);
  // Automatically reconnects
};

// Named events
eventSource.addEventListener('update', (event) => {
  console.log('Update:', event.data);
});

// Close connection
eventSource.close();
```

### SSE with Express

```javascript
const express = require('express');
const app = express();

class SSEManager {
  constructor() {
    this.clients = new Set();
  }

  addClient(res) {
    this.clients.add(res);
  }

  removeClient(res) {
    this.clients.delete(res);
  }

  broadcast(event, data) {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

    this.clients.forEach(client => {
      client.write(message);
    });
  }
}

const sseManager = new SSEManager();

app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  sseManager.addClient(res);

  req.on('close', () => {
    sseManager.removeClient(res);
  });
});

// Broadcast to all clients
setInterval(() => {
  sseManager.broadcast('update', {
    timestamp: Date.now(),
    activeClients: sseManager.clients.size
  });
}, 10000);

app.listen(3000);
```

## Long Polling

### When to Use Long Polling

- Legacy browser support needed
- Firewall/proxy blocks WebSockets
- Very infrequent updates
- Fallback mechanism

### Long Polling Server

```javascript
const express = require('express');
const app = express();

const pendingRequests = new Map();
const messages = [];

app.get('/poll', (req, res) => {
  const clientId = req.query.clientId;

  // If messages available, send immediately
  if (messages.length > 0) {
    res.json({ messages });
    messages.length = 0; // Clear messages
    return;
  }

  // Hold request until timeout or new message
  const timeout = setTimeout(() => {
    pendingRequests.delete(clientId);
    res.json({ messages: [] });
  }, 30000); // 30 second timeout

  pendingRequests.set(clientId, { res, timeout });

  req.on('close', () => {
    clearTimeout(timeout);
    pendingRequests.delete(clientId);
  });
});

app.post('/send', express.json(), (req, res) => {
  messages.push(req.body.message);

  // Respond to all pending requests
  pendingRequests.forEach(({ res, timeout }, clientId) => {
    clearTimeout(timeout);
    res.json({ messages });
    pendingRequests.delete(clientId);
  });

  messages.length = 0; // Clear messages
  res.json({ success: true });
});

app.listen(3000);
```

### Long Polling Client

```javascript
const clientId = Math.random().toString(36);

async function poll() {
  try {
    const response = await fetch(
      `http://localhost:3000/poll?clientId=${clientId}`,
      { signal: AbortSignal.timeout(35000) }
    );

    const data = await response.json();

    if (data.messages.length > 0) {
      console.log('Received messages:', data.messages);
    }

    // Immediately poll again
    poll();
  } catch (error) {
    console.error('Polling error:', error);
    // Retry after delay
    setTimeout(poll, 5000);
  }
}

poll();
```

## HTTP/2 Server Push (Deprecated)

Note: HTTP/2 Server Push is deprecated and removed from Chrome. Use 103 Early Hints instead.

```javascript
// Example for historical context only
const http2 = require('http2');
const fs = require('fs');

const server = http2.createSecureServer({
  key: fs.readFileSync('server.key'),
  cert: fs.readFileSync('server.crt')
});

server.on('stream', (stream, headers) => {
  if (headers[':path'] === '/') {
    // Push assets before HTML response
    stream.pushStream({ ':path': '/style.css' }, (err, pushStream) => {
      if (!err) {
        pushStream.respondWithFile('style.css');
      }
    });

    stream.respondWithFile('index.html');
  }
});

server.listen(3000);
```

## Decision Matrix

### Choose WebSocket When:

- Bidirectional communication needed
- Low latency critical (< 50ms)
- High message frequency (> 1 msg/sec)
- Gaming, chat, collaborative editing
- Binary data transfer
- Custom protocol needed

### Choose SSE When:

- One-way server-to-client only
- Stock tickers, live feeds
- News/notifications
- Simpler implementation preferred
- Better proxy compatibility needed
- Automatic reconnection important

### Choose Long Polling When:

- Legacy browser support required (IE8/9)
- WebSocket blocked by firewall
- Very infrequent updates
- Fallback mechanism only

### Choose HTTP Streaming When:

- Large data transfers
- File uploads with progress
- Video/audio streaming
- One-way data flow

### Choose WebRTC When:

- Peer-to-peer communication
- Audio/video calls
- Screen sharing
- File transfer between peers
- Low latency P2P needed

## Hybrid Approach

```javascript
// Socket.IO with automatic fallback
const io = require('socket.io')(3000, {
  transports: ['websocket', 'polling'], // Try WebSocket first
  upgrade: true,
  allowUpgrades: true
});

io.on('connection', (socket) => {
  console.log('Connected via:', socket.conn.transport.name);

  socket.conn.on('upgrade', () => {
    console.log('Upgraded to:', socket.conn.transport.name);
  });
});
```

## Performance Characteristics

### Latency (p99)

- WebSocket: 5-20ms
- SSE: 10-50ms
- Long Polling: 100-500ms
- HTTP/2: 20-100ms

### Throughput (messages/sec)

- WebSocket: 10,000+ per connection
- SSE: 1,000+ per connection
- Long Polling: 1-10 per connection

### Connection Limits (per server)

- WebSocket: 50,000-100,000
- SSE: 50,000-100,000
- Long Polling: 10,000-20,000

### Overhead (per message)

- WebSocket: 2-6 bytes
- SSE: ~20 bytes
- Long Polling: 500-2000 bytes (HTTP headers)

## Migration Path

### From Polling to WebSocket

```javascript
// Step 1: Support both
app.get('/api/messages', (req, res) => {
  // Legacy polling endpoint
  res.json({ messages: getRecentMessages() });
});

io.on('connection', (socket) => {
  // New WebSocket endpoint
  socket.on('subscribe', (channel) => {
    socket.join(channel);
  });
});

// Step 2: Gradually migrate clients
// Step 3: Deprecate polling endpoint
```

### From SSE to WebSocket

```javascript
// SSE provides read-only, add WebSocket for writes
app.get('/events', sseHandler);  // Keep for reads

io.on('connection', (socket) => {
  socket.on('action', (data) => {
    // Handle writes via WebSocket
    processAction(data);
  });
});

// Eventually migrate reads to WebSocket too
```

## Best Practices

1. Start with simplest solution (SSE for one-way)
2. Use Socket.IO for automatic fallbacks
3. Monitor actual requirements before over-engineering
4. Consider mobile/network constraints
5. Implement graceful degradation
6. Load test before production
7. Have fallback strategy
8. Monitor connection success rates
