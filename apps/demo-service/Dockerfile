FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY apps/demo-service/package.json apps/demo-service/package.json
RUN npm ci || npm install
COPY apps/demo-service apps/demo-service
RUN npm run build --workspace @rollout-guard/demo-service

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
COPY apps/demo-service/package.json apps/demo-service/package.json
RUN npm ci --omit=dev || npm install --omit=dev
COPY --from=build /app/apps/demo-service/dist apps/demo-service/dist
EXPOSE 3000
CMD ["node", "apps/demo-service/dist/server.js"]
