# syntax=docker/dockerfile:1

# build: install all deps, generate the Prisma client, compile TypeScript
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# prisma.config.ts tolerates a missing DATABASE_URL, so generate works at build time
RUN npx prisma generate && npm run build

# runtime: production deps + compiled output only
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3001 \
    CHATBOT_CACHE_DIR=/app/cache
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/cache /app/uploads && chown -R node:node /app/cache /app/uploads
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/v1/pharmatrace').then(()=>process.exit(0)).catch(()=>process.exit(1))"
CMD ["node", "dist/main"]
