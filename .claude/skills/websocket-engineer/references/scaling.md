# Horizontal Scaling Reference

## Architecture Overview

```
┌─────────────┐
│Load Balancer│ (nginx/HAProxy with sticky sessions)
└──────┬──────┘
       │
   ┌───┴───┐
   │       │
┌──▼──┐ ┌──▼──┐
│WS #1│ │WS #2│ ... (Socket.IO servers)
└──┬──┘ └──┬──┘
   │       │
   └───┬───┘
       │
   ┌───▼───┐
   │ Redis │ (Pub/Sub adapter)
   └───────┘
```

## Redis Adapter Configuration

### Socket.IO with Redis

```javascript
const { createServer } = require('http');
const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

// Redis pub/sub client setup
const pubClient = createClient({
  host: 'localhost',
  port: 6379
});
const subClient = pubClient.duplicate();

Promise.all([pubClient.connect(), subClient.connect()]).then(() => {
  io.adapter(createAdapter(pubClient, subClient));
  console.log('Redis adapter connected');
});

// Now broadcasts work across all servers
io.emit('news', { hello: 'world' });

httpServer.listen(3000);
```

### Redis Streams for Reliable Delivery

```javascript
const { createAdapter } = require('@socket.io/redis-streams-adapter');

const redisClient = createClient({ url: 'redis://localhost:6379' });

redisClient.connect().then(() => {
  io.adapter(createAdapter(redisClient, {
    streamName: 'socket.io-stream',
    maxLen: 10000, // Keep last 10k messages
    readCount: 100 // Process 100 messages at a time
  }));
});
```

## Sticky Sessions

### Nginx Configuration

```nginx
upstream websocket_backend {
    ip_hash; # Sticky sessions based on IP
    server ws1.example.com:3000;
    server ws2.example.com:3000;
    server ws3.example.com:3000;
}

server {
    listen 80;
    server_name example.com;

    location /socket.io/ {
        proxy_pass http://websocket_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeouts
        proxy_connect_timeout 7d;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;
    }
}
```

### HAProxy Configuration

```haproxyconf
frontend websocket_frontend
    bind *:80
    mode http
    option httplog
    use_backend websocket_backend

backend websocket_backend
    mode http
    balance source # Sticky sessions by source IP
    hash-type consistent # Consistent hashing

    # Health checks
    option httpchk GET /health
    http-check expect status 200

    server ws1 10.0.1.1:3000 check
    server ws2 10.0.1.2:3000 check
    server ws3 10.0.1.3:3000 check
```

### Cookie-based Sticky Sessions

```javascript
// Server-side: Set affinity cookie
io.engine.on('connection', (rawSocket) => {
  const serverID = process.env.SERVER_ID || 'server1';
  rawSocket.request.res.setHeader(
    'Set-Cookie',
    `io=${serverID}; Path=/; HttpOnly; SameSite=Lax`
  );
});
```

```nginx
# Nginx: Use cookie for routing
upstream websocket_backend {
    server ws1.example.com:3000;
    server ws2.example.com:3000;
}

map $cookie_io $backend_server {
    "server1" ws1.example.com:3000;
    "server2" ws2.example.com:3000;
    default websocket_backend;
}

location /socket.io/ {
    proxy_pass http://$backend_server;
    # ... other proxy settings
}
```

## State Management

### Shared State in Redis

```javascript
const Redis = require('ioredis');
const redis = new Redis();

// Store user connection info
io.on('connection', async (socket) => {
  const userId = socket.handshake.auth.userId;

  // Track which server has this user
  await redis.hset('user:connections', userId, process.env.SERVER_ID);

  // Store user presence
  await redis.hset(`user:${userId}`, {
    socketId: socket.id,
    serverId: process.env.SERVER_ID,
    connectedAt: Date.now(),
    status: 'online'
  });

  socket.on('disconnect', async () => {
    await redis.hdel('user:connections', userId);
    await redis.del(`user:${userId}`);
  });
});

// Send message to specific user across cluster
async function sendToUser(userId, event, data) {
  const serverId = await redis.hget('user:connections', userId);

  if (serverId === process.env.SERVER_ID) {
    // User is on this server
    const sockets = await io.in(`user:${userId}`).fetchSockets();
    sockets.forEach(socket => socket.emit(event, data));
  } else {
    // User is on another server - use Redis to route
    io.to(`user:${userId}`).emit(event, data);
  }
}
```

## Connection Limits

### Per-Server Limits

```javascript
const MAX_CONNECTIONS = 50000;

io.engine.on('connection', (socket) => {
  const currentConnections = io.engine.clientsCount;

  if (currentConnections > MAX_CONNECTIONS) {
    socket.close(1008, 'Server at capacity');
    return;
  }
});
```

### Kubernetes Horizontal Pod Autoscaling

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: websocket-server-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: websocket-server
  minReplicas: 3
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Pods
    pods:
      metric:
        name: websocket_connections
      target:
        type: AverageValue
        averageValue: "40000" # Scale when avg > 40k connections/pod
```

## Graceful Shutdown

```javascript
const gracefulShutdown = () => {
  console.log('Shutting down gracefully...');

  // Stop accepting new connections
  io.close(() => {
    console.log('All connections closed');
    process.exit(0);
  });

  // Force close after 30 seconds
  setTimeout(() => {
    console.error('Forcing shutdown after timeout');
    process.exit(1);
  }, 30000);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
```

## Performance Optimization

### Node.js Clustering

```javascript
const cluster = require('cluster');
const os = require('os');

if (cluster.isMaster) {
  const numWorkers = os.cpus().length;

  console.log(`Master ${process.pid} starting ${numWorkers} workers`);

  for (let i = 0; i < numWorkers; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker) => {
    console.log(`Worker ${worker.process.pid} died, spawning new`);
    cluster.fork();
  });
} else {
  // Worker process runs Socket.IO server
  const io = require('./socket-server');
  io.listen(3000);
  console.log(`Worker ${process.pid} started`);
}
```

### uWebSockets.js for Maximum Performance

```javascript
const uWS = require('uWebSockets.js');

const app = uWS.App()
  .ws('/*', {
    compression: uWS.SHARED_COMPRESSOR,
    maxPayloadLength: 16 * 1024,
    idleTimeout: 60,

    open: (ws) => {
      console.log('Client connected');
    },

    message: (ws, message, isBinary) => {
      // Echo message
      ws.send(message, isBinary);
    },

    close: (ws, code, message) => {
      console.log('Client disconnected');
    }
  })
  .listen(9001, (token) => {
    if (token) {
      console.log('Listening on port 9001');
    }
  });
```
