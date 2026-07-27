FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps apps
RUN npm ci
RUN npm run build --workspace @rollout-guard/database
RUN npm run build --workspace @rollout-guard/rollout-worker

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/database/package.json apps/database/package.json
COPY --from=build /app/apps/database/dist apps/database/dist
COPY --from=build /app/apps/rollout-worker/package.json apps/rollout-worker/package.json
COPY --from=build /app/apps/rollout-worker/dist apps/rollout-worker/dist
CMD ["node", "apps/rollout-worker/dist/worker.js"]
