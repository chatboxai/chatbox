# WebSocket Security Reference

## Authentication

### JWT Authentication

```javascript
const io = require('socket.io')(3000);
const jwt = require('jsonwebtoken');

// Middleware for authentication
io.use((socket, next) => {
  const token = socket.handshake.auth.token;

  if (!token) {
    return next(new Error('Authentication error: No token provided'));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.userId;
    socket.username = decoded.username;
    next();
  } catch (err) {
    next(new Error('Authentication error: Invalid token'));
  }
});

io.on('connection', (socket) => {
  console.log(`User ${socket.username} connected`);

  socket.on('message', (data) => {
    // socket.userId is already verified
    saveMessage(socket.userId, data);
  });
});
```

### Query Parameter Authentication (Less Secure)

```javascript
// Use only for initial handshake, then upgrade to token
io.use((socket, next) => {
  const token = socket.handshake.query.token;

  if (!token) {
    return next(new Error('Authentication required'));
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return next(new Error('Invalid token'));
    socket.userId = decoded.userId;
    next();
  });
});
```

### Cookie Authentication

```javascript
const cookieParser = require('cookie-parser');

io.use((socket, next) => {
  const cookies = socket.handshake.headers.cookie;

  if (!cookies) {
    return next(new Error('No cookies'));
  }

  // Parse cookies
  cookieParser(process.env.COOKIE_SECRET)(
    socket.request,
    {},
    () => {
      const sessionId = socket.request.signedCookies.sessionId;

      if (!sessionId) {
        return next(new Error('No session'));
      }

      // Verify session in Redis/DB
      verifySession(sessionId).then(user => {
        socket.userId = user.id;
        next();
      }).catch(err => {
        next(new Error('Invalid session'));
      });
    }
  );
});
```

## Authorization

### Room-Based Authorization

```javascript
io.on('connection', (socket) => {
  socket.on('join-room', async (roomId) => {
    // Check if user has permission
    const hasAccess = await checkRoomAccess(socket.userId, roomId);

    if (!hasAccess) {
      socket.emit('error', { message: 'Access denied to room' });
      return;
    }

    socket.join(roomId);
    socket.emit('joined', { room: roomId });
  });

  socket.on('send-message', async ({ roomId, text }) => {
    // Verify user is in room
    if (!socket.rooms.has(roomId)) {
      socket.emit('error', { message: 'Not in room' });
      return;
    }

    // Check write permissions
    const canWrite = await checkWritePermission(socket.userId, roomId);

    if (!canWrite) {
      socket.emit('error', { message: 'No write permission' });
      return;
    }

    io.to(roomId).emit('message', {
      userId: socket.userId,
      text,
      timestamp: Date.now()
    });
  });
});
```

### Admin-Only Events

```javascript
const ADMIN_EVENTS = ['kick-user', 'ban-user', 'delete-message'];

io.use((socket, next) => {
  // Attach role to socket after auth
  getUserRole(socket.userId).then(role => {
    socket.role = role;
    next();
  });
});

io.on('connection', (socket) => {
  ADMIN_EVENTS.forEach(event => {
    socket.on(event, async (data) => {
      if (socket.role !== 'admin') {
        socket.emit('error', { message: 'Admin access required' });
        return;
      }

      // Execute admin action
      await handleAdminAction(event, data);
    });
  });
});
```

## Rate Limiting

### Per-Socket Rate Limiting

```javascript
const rateLimit = require('express-rate-limit');

class SocketRateLimiter {
  constructor(maxRequests = 100, windowMs = 60000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = new Map();
  }

  check(socketId) {
    const now = Date.now();
    const userRequests = this.requests.get(socketId) || [];

    // Remove expired requests
    const validRequests = userRequests.filter(
      time => now - time < this.windowMs
    );

    if (validRequests.length >= this.maxRequests) {
      return false; // Rate limit exceeded
    }

    validRequests.push(now);
    this.requests.set(socketId, validRequests);
    return true;
  }

  reset(socketId) {
    this.requests.delete(socketId);
  }
}

const limiter = new SocketRateLimiter(100, 60000); // 100 req/min

io.on('connection', (socket) => {
  socket.on('message', (data) => {
    if (!limiter.check(socket.id)) {
      socket.emit('error', { message: 'Rate limit exceeded' });
      return;
    }

    // Process message
    io.to(data.roomId).emit('message', data);
  });

  socket.on('disconnect', () => {
    limiter.reset(socket.id);
  });
});
```

### Redis-Based Distributed Rate Limiting

```javascript
const Redis = require('ioredis');
const redis = new Redis();

async function checkRateLimit(userId, maxRequests = 100, windowSec = 60) {
  const key = `rate_limit:${userId}`;
  const now = Date.now();
  const windowStart = now - (windowSec * 1000);

  const pipeline = redis.pipeline();

  // Remove old entries
  pipeline.zremrangebyscore(key, 0, windowStart);

  // Count requests in window
  pipeline.zcard(key);

  // Add current request
  pipeline.zadd(key, now, `${now}-${Math.random()}`);

  // Set expiry
  pipeline.expire(key, windowSec);

  const results = await pipeline.exec();
  const count = results[1][1];

  return count < maxRequests;
}

io.on('connection', (socket) => {
  socket.on('message', async (data) => {
    const allowed = await checkRateLimit(socket.userId, 50, 60);

    if (!allowed) {
      socket.emit('error', { message: 'Too many requests' });
      return;
    }

    io.to(data.roomId).emit('message', data);
  });
});
```

## CORS Configuration

```javascript
const io = require('socket.io')(3000, {
  cors: {
    origin: ['https://example.com', 'https://app.example.com'],
    methods: ['GET', 'POST'],
    credentials: true,
    allowedHeaders: ['Authorization']
  }
});

// Dynamic CORS
io.engine.on('initial_headers', (headers, req) => {
  headers['Access-Control-Allow-Origin'] = req.headers.origin;
});
```

## Input Validation

```javascript
const Joi = require('joi');

const messageSchema = Joi.object({
  roomId: Joi.string().uuid().required(),
  text: Joi.string().min(1).max(1000).required(),
  attachments: Joi.array().items(Joi.string().uri()).max(5).optional()
});

io.on('connection', (socket) => {
  socket.on('message', (data) => {
    // Validate input
    const { error, value } = messageSchema.validate(data);

    if (error) {
      socket.emit('error', {
        message: 'Invalid message format',
        details: error.details
      });
      return;
    }

    // Process validated data
    io.to(value.roomId).emit('message', {
      userId: socket.userId,
      ...value,
      timestamp: Date.now()
    });
  });
});
```

## XSS Protection

```javascript
const sanitizeHtml = require('sanitize-html');

function sanitizeMessage(text) {
  return sanitizeHtml(text, {
    allowedTags: [], // Strip all HTML
    allowedAttributes: {},
    disallowedTagsMode: 'escape'
  });
}

io.on('connection', (socket) => {
  socket.on('message', (data) => {
    const sanitized = {
      ...data,
      text: sanitizeMessage(data.text)
    };

    io.to(data.roomId).emit('message', sanitized);
  });
});
```

## DDoS Protection

### Connection Limiting

```javascript
const connectionLimits = new Map();
const MAX_CONNECTIONS_PER_IP = 10;

io.engine.on('connection', (rawSocket) => {
  const ip = rawSocket.request.headers['x-forwarded-for'] ||
              rawSocket.request.connection.remoteAddress;

  const currentConnections = connectionLimits.get(ip) || 0;

  if (currentConnections >= MAX_CONNECTIONS_PER_IP) {
    rawSocket.close(1008, 'Too many connections from IP');
    return;
  }

  connectionLimits.set(ip, currentConnections + 1);

  rawSocket.on('close', () => {
    const count = connectionLimits.get(ip) - 1;
    if (count <= 0) {
      connectionLimits.delete(ip);
    } else {
      connectionLimits.set(ip, count);
    }
  });
});
```

### Message Size Limits

```javascript
const io = require('socket.io')(3000, {
  maxHttpBufferSize: 1e6, // 1MB max message size
  pingTimeout: 60000,
  pingInterval: 25000
});

io.on('connection', (socket) => {
  socket.on('message', (data) => {
    if (JSON.stringify(data).length > 10000) {
      socket.emit('error', { message: 'Message too large' });
      return;
    }

    // Process message
  });
});
```

## Secure Session Management

```javascript
const sessions = new Map();

io.on('connection', (socket) => {
  const sessionId = generateSecureSessionId();

  sessions.set(socket.id, {
    sessionId,
    userId: socket.userId,
    createdAt: Date.now(),
    lastActivity: Date.now()
  });

  // Timeout inactive sessions
  const timeout = setTimeout(() => {
    socket.disconnect(true);
  }, 30 * 60 * 1000); // 30 minutes

  socket.on('message', () => {
    const session = sessions.get(socket.id);
    if (session) {
      session.lastActivity = Date.now();
      clearTimeout(timeout);
    }
  });

  socket.on('disconnect', () => {
    sessions.delete(socket.id);
    clearTimeout(timeout);
  });
});

function generateSecureSessionId() {
  return require('crypto').randomBytes(32).toString('hex');
}
```

## Audit Logging

```javascript
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'websocket-audit.log' })
  ]
});

io.on('connection', (socket) => {
  logger.info('Connection', {
    socketId: socket.id,
    userId: socket.userId,
    ip: socket.handshake.address,
    timestamp: Date.now()
  });

  socket.on('message', (data) => {
    logger.info('Message', {
      socketId: socket.id,
      userId: socket.userId,
      roomId: data.roomId,
      messageLength: data.text.length,
      timestamp: Date.now()
    });
  });

  socket.on('disconnect', (reason) => {
    logger.info('Disconnect', {
      socketId: socket.id,
      userId: socket.userId,
      reason,
      timestamp: Date.now()
    });
  });
});
```
