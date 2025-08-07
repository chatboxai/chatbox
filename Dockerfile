# Stage 1: Build the application
FROM node:20-slim AS builder

WORKDIR /app

# Use a faster npm registry mirror
RUN npm config set registry https://registry.npmmirror.com/

# Copy all source code first
COPY . .

# Install all dependencies. The postinstall script will now have access to the required files.
RUN npm install

# Build the web (renderer) and main (backend) processes
RUN npm run build:web
RUN npm run build:main

# Prune dev dependencies to reduce the size of the final image
RUN npm prune --omit=dev

# Stage 2: Create the production image
FROM node:20-slim

WORKDIR /app

# Use a faster npm registry mirror
RUN npm config set registry https://registry.npmmirror.com/

# Install serve to host the frontend and concurrently to run both services
RUN npm install -g serve concurrently

# Copy the pruned application from the builder stage
COPY --from=builder /app .

# Expose the port the frontend will be served on (default for serve is 3000)
EXPOSE 3000

# Use concurrently to run both the backend and the frontend server.
# The backend is started with node, and the frontend is served with 'serve'.
CMD ["concurrently", "node release/app/dist/main/main.js", "serve -s release/app/dist/renderer -l 3000"]
