FROM node:20-alpine

WORKDIR /app

# Install dependencies first (layer cache)
COPY package*.json ./
RUN npm ci --only=production

# Copy application source
COPY src/ ./src/

# Ensure data directory exists (will be overridden by volume)
RUN mkdir -p /data

EXPOSE 3456

CMD ["node", "src/server/index.js"]
