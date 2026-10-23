# Match server for Fly.io. Runs the TypeScript directly with tsx: the sim is shared with the game,
# so there is no separate build step (same setup as Super Tennis Deluxo's server).
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY src/sim ./src/sim
COPY src/net/protocol.ts ./src/net/protocol.ts
COPY server ./server
EXPOSE 8787
CMD ["npx", "tsx", "server/index.ts"]
