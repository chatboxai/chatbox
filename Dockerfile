# Build: ChatBridge server + frontend
FROM node:20-slim

WORKDIR /app

# Prisma requires OpenSSL at runtime
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Skip Electron binary download — server-only build
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

# Install pnpm — node:20-slim has /usr/local/bin in PATH so this works
RUN npm install -g pnpm@10.33.0

# Copy workspace manifests and pnpm config first for layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY release/app/package.json release/app/
COPY patches/ patches/

# Install root/frontend dependencies (skip postinstall — Electron native modules not needed for web build)
RUN pnpm install --frozen-lockfile --ignore-scripts || pnpm install --ignore-scripts

# Copy all source
COPY . .

# Build web frontend — use vite directly with renderer-only config.
# electron-vite builds main+preload+renderer but main/preload fail in Docker
# because Electron native deps aren't installed (--ignore-scripts).
# We only need the renderer for the web deployment.
RUN npx vite build --config vite.web.config.ts

# Build third-party demo apps
RUN cd apps/chess && npm install && npm run build
RUN cd apps/weather && npm install && npm run build
RUN cd apps/spotify && npm install && npm run build

# Build server and generate Prisma client
RUN cd server && npm install && npm run build && npx prisma generate

EXPOSE 3000

CMD ["sh", "-c", "cd /app/server && npx prisma migrate deploy && npx ts-node prisma/seed.ts && node dist/index.js"]
