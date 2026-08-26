# check=skip=SecretsUsedInArgOrEnv
# VITE_SUPABASE_ANON_KEY is public Vite client config. Docker's stock secret
# check flags the ARG name, so scripts/quality/check-dockerfile-sensitive-env.mjs
# enforces the narrower rule this app needs: no sensitive Docker ENV layers.
# Pinned to satisfy package-lock.json's ^20.19.0 || >=22.12.0 engine constraint.
# Bumping the FROM tag is the ONLY Node-version authority for production —
# .nvmrc and engines.node must track this value.
FROM node:20.19.4-alpine@sha256:df02558528d3d3d0d621f112e232611aecfee7cbc654f6b375765f72bb262799 AS build
WORKDIR /app

# vendor/ is copied with package*.json because devDependency fake-indexeddb
# is "file:vendor/fake-indexeddb" — npm ci needs it present at install time.
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci --no-audit --no-fund

COPY . .

# Vite inlines ordinary browser client config into the JS bundle. Extension
# rollout controls are intentionally absent here; the runtime stage writes
# those from non-VITE service variables whenever the container starts.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_API_TARGET_URL
ARG VITE_APP_ENV
RUN VITE_SUPABASE_URL="$VITE_SUPABASE_URL" \
    VITE_SUPABASE_ANON_KEY="$VITE_SUPABASE_ANON_KEY" \
    VITE_API_TARGET_URL="$VITE_API_TARGET_URL" \
    VITE_APP_ENV="$VITE_APP_ENV" \
    NODE_OPTIONS="--max-old-space-size=4096" npm run build

FROM node:20.19.4-alpine@sha256:df02558528d3d3d0d621f112e232611aecfee7cbc654f6b375765f72bb262799 AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
LABEL org.opencontainers.image.base.digest="sha256:df02558528d3d3d0d621f112e232611aecfee7cbc654f6b375765f72bb262799"

# `npm run serve` is `vite preview`, which loads config/vite/vite.config.ts
# at runtime. That config imports @vitejs/plugin-react-swc (a devDependency),
# so we need the full install — copying node_modules from the build stage
# is simpler and more reliable than reinstalling with pinned versions here.
COPY package.json package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --chown=node:node config ./config
# `config/vite/astridBridgeProxy.ts` imports the shared protocol constants
# while Vite loads its TypeScript config at preview startup. Keep that exact
# source carrier in the minimal runtime image; copying only `dist/` is not
# sufficient for `vite preview`.
COPY --chown=node:node src/tools/video-editor/data/astridBridgeWire.ts ./src/tools/video-editor/data/astridBridgeWire.ts
COPY scripts/runtime ./scripts/runtime
COPY --chown=node:node --from=build /app/dist ./dist

EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/runtime-config/v1/extensions.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error(String(r.status))})"
# Generate the public rollout document from runtime-only (non-VITE) variables
# immediately before preview starts. The writer uses same-directory rename, so
# the server can never observe a partial JSON file.
USER node
CMD ["sh", "-c", "node scripts/runtime/write-extension-release-config.mjs && exec npm run serve"]
