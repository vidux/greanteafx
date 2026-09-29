# GreanTeaFX render service. Build from the backend/ directory:
#   docker build -t greanteafx-backend .
#   docker run -p 4000:4000 -e GREANTEAFX_CORS_ORIGIN=https://your-frontend.example -v greanteafx-data:/data greanteafx-backend
#
# Debian (glibc), not Alpine: node-web-audio-api ships glibc-only Linux binaries.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
# The native audio binary links libasound.so.2 at load time, even though rendering is offline.
RUN apt-get update \
  && apt-get install -y --no-install-recommends libasound2 \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data/assets && chown -R node:node /data
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4000 \
    GREANTEAFX_ASSET_DIR=/data/assets
COPY --from=build --chown=node:node /app ./
USER node
EXPOSE 4000
# Honours $PORT, which Cloud Run and similar platforms set.
CMD ["sh", "-c", "exec npx next start -p ${PORT}"]
