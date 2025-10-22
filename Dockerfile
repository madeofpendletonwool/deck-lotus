# Multi-stage build for minimal image size

# Stage 1: Build frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app/client

# Copy frontend package files
COPY client/package*.json ./

# Install ALL frontend dependencies (including dev, needed for build)
RUN npm install

# Copy frontend source
COPY client/ ./

# Build frontend
RUN npm run build

# Stage 2: Build backend dependencies
FROM node:20-alpine AS backend-builder

WORKDIR /app

# Copy backend package files
COPY package*.json ./

# Install backend dependencies
RUN npm install --omit=dev

# Stage 3: Final production image
FROM node:20-alpine

# Install bzip2 for MTGJSON decompression
RUN apk add --no-cache bzip2

WORKDIR /app

# Copy backend dependencies from builder
COPY --from=backend-builder /app/node_modules ./node_modules

# Copy backend source
COPY src ./src
COPY scripts ./scripts
COPY package*.json ./

# Copy built frontend from frontend-builder
COPY --from=frontend-builder /app/client/dist ./client/dist

# Copy favicon assets
COPY assets/favicon.ico ./client/dist/favicon.ico
COPY assets/favicon-16x16.png ./client/dist/favicon-16x16.png
COPY assets/favicon-32x32.png ./client/dist/favicon-32x32.png
COPY assets/apple-touch-icon.png ./client/dist/apple-touch-icon.png
COPY assets/android-chrome-192x192.png ./client/dist/android-chrome-192x192.png
COPY assets/android-chrome-512x512.png ./client/dist/android-chrome-512x512.png

# Create data directory
RUN mkdir -p /app/data

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/app/data/deck-lotus.db

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start server
CMD ["node", "src/server.js"]
