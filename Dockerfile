# syntax=docker/dockerfile:1
FROM node:20-alpine

# Create app directory
WORKDIR /app

# Install dependencies first (cache-friendly layer)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY . .

# App listens on PORT env var (default 3000)
EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "server/server.js"]
