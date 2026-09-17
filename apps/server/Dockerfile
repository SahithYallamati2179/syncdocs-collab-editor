# Sync server image.
#
# Built from the repository root so the workspace lockfile is available:
#   docker build -f apps/server/Dockerfile -t syncdocs-server .
#
# The web app is NOT in this image. It is a Next.js app that belongs on a
# static/serverless host; this container exists because a WebSocket relay needs
# a long-lived process, which serverless platforms cannot give it.

# ---------- build ----------
FROM node:20-alpine AS build

WORKDIR /app

# Copy only the manifests first so a dependency install is cached independently
# of source changes.
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/

# The lockfile covers every workspace, so restricting the install to the server
# workspace keeps the image from pulling in Next, TipTap and the rest of the
# front-end tree.
RUN npm ci --workspace @collab/server --include-workspace-root

COPY apps/server/tsconfig.json apps/server/
COPY apps/server/src apps/server/src

RUN npm run build --workspace @collab/server

# Drop dev dependencies (typescript, tsx, @types/*) from what gets copied on.
RUN npm prune --omit=dev --workspace @collab/server --include-workspace-root

# ---------- run ----------
FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/apps/server/package.json ./apps/server/package.json
COPY --from=build --chown=node:node /app/apps/server/dist ./apps/server/dist

# The default file driver writes here. The directory has to be created while we
# are still root and handed over, because /app itself is root-owned and the
# unprivileged user cannot mkdir inside it at runtime. Without this the server
# starts and serves /health quite happily, while every persist fails with
# EACCES and documents live only in memory.
RUN mkdir -p /app/.data && chown -R node:node /app/.data

# Run as the unprivileged user the base image already provides.
USER node

# Host platforms inject their own PORT; config.ts already reads it.
ENV PORT=1234
EXPOSE 1234

# The server already serves this, and it needs no auth, so it doubles as the
# platform health check.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||1234)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/server/dist/index.js"]
