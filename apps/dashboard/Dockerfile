FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps apps
RUN npm ci
ARG VITE_API_URL=http://localhost:3005
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build --workspace @rollout-guard/dashboard

FROM nginx:1.27-alpine
COPY --from=build /app/apps/dashboard/dist /usr/share/nginx/html
EXPOSE 80
