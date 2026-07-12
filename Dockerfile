# ---- build stage -----------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Install with the workspace layout first for layer-cache-friendly builds.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
COPY packages/demist/package.json packages/demist/
RUN npm ci --no-fund --no-audit

COPY . .
RUN npm run build

# ---- runtime stage ----------------------------------------------------------
FROM node:22-alpine
RUN addgroup -S demist && adduser -S demist -G demist
WORKDIR /app

COPY --from=build /app/packages/demist/bin ./bin
COPY --from=build /app/packages/demist/dist ./dist

ENV DEMIST_DIR=/workspace \
    DEMIST_HOST=0.0.0.0 \
    DEMIST_INSTALL_MODE=docker \
    NODE_ENV=production

RUN mkdir -p /workspace && chown demist:demist /workspace
USER demist
VOLUME /workspace
EXPOSE 4400

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch(\`http://127.0.0.1:\${process.env.DEMIST_PORT||4400}/api/health\`).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "bin/demist.mjs"]
