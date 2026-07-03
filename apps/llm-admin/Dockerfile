# Standalone Dockerfile: buildable from just this directory (no monorepo
# workspace context needed), since this app has no @llmgateway/* dependencies
# and is deployed by copying this folder onto the target host. See README.md.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY public ./public

EXPOSE 7070
CMD ["node", "dist/server.js"]
