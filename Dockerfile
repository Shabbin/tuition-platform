# ---- Base image ----
FROM node:18-alpine

# Set working dir
WORKDIR /app

# Install tiny tools used by the healthcheck
RUN apk add --no-cache curl

# Copy only package files first (leverages Docker layer caching)
COPY package*.json ./

# Install prod dependencies
# If you use npm, keep this. If you use yarn/pnpm, see notes below.
RUN npm ci --omit=dev

# Copy the rest of the source
COPY . .

# Expose the port your app uses (your code listens on 5000)
EXPOSE 5000

# Optional healthcheck hits /healthz (your server already has it)
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:5000/healthz || exit 1

# Start the server (server.js in your repo)
CMD ["node", "server.js"]
