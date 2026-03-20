# Stage 1: Install dependencies
FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Stage 2: Production image
FROM node:24-alpine

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY server.js ./
COPY public/ ./public/
COPY db/ ./db/
COPY package.json ./

USER appuser

EXPOSE 3000

CMD ["node", "server.js"]
