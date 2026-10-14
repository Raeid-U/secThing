FROM node:22-alpine AS development
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/platform/package.json packages/platform/package.json
RUN npm ci --no-audit --no-fund
COPY . .
EXPOSE 3000 8080

