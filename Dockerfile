# ---- Base ----
FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json* ./

# ---- Dependencies ----
FROM base AS dependencies
RUN npm config set registry https://registry.npmmirror.com/ && \
    npm install --ignore-scripts && \
    npm cache clean --force

# ---- Build ----
FROM dependencies AS build
COPY . .
RUN npm run build:web

# ---- Production ----
FROM nginx:alpine AS production
COPY --from=build /app/release/app/dist/renderer /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]