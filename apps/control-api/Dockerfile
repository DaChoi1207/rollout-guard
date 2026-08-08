FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps apps
RUN npm ci
RUN npm run build --workspace @rollout-guard/database
RUN npm run build --workspace @rollout-guard/control-api

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/database/package.json apps/database/package.json
COPY --from=build /app/apps/database/dist apps/database/dist
COPY --from=build /app/apps/database/migrations apps/database/migrations
COPY --from=build /app/apps/control-api/package.json apps/control-api/package.json
COPY --from=build /app/apps/control-api/dist apps/control-api/dist
EXPOSE 3005
CMD ["node", "apps/control-api/dist/server.js"]
