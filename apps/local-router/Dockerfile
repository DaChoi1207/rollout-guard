FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY apps/local-router/package.json apps/local-router/package.json
RUN npm ci || npm install
COPY apps/local-router apps/local-router
RUN npm run build --workspace @rollout-guard/local-router

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
COPY apps/local-router/package.json apps/local-router/package.json
RUN npm ci --omit=dev || npm install --omit=dev
COPY --from=build /app/apps/local-router/dist apps/local-router/dist
EXPOSE 8080
CMD ["node", "apps/local-router/dist/server.js"]
