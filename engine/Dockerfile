FROM node:22-slim

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm install --production=false

# Install Playwright Chromium browser and its Linux dependencies.
RUN npx playwright install --with-deps chromium

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Remove dev dependencies
RUN npm prune --production

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "dist/index.js"]
