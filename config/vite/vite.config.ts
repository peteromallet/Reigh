import fs from "fs";
import { defineConfig, createLogger } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import {
  manualVendorChunk,
  PREVIEW_ALLOWED_HOSTS,
  resolveVitePort,
} from "./policy";
import { createRemoteFontModePlugin } from "./remoteFonts";
import { isSameOriginLoopbackRequest } from "./astridProxySecurity";

export { createRemoteFontModePlugin, stripRemoteFontLinks } from "./remoteFonts";

const logger = createLogger();
const originalWarn = logger.warn.bind(logger);
logger.warn = (msg, options) => {
  if (msg.includes('postcss.parse') && msg.includes('from')) return;
  originalWarn(msg, options);
};

export default defineConfig(() => {
  const port = resolveVitePort(process.env.PORT);
  const disableRemoteFonts = process.env.VITE_DISABLE_REMOTE_FONTS === "1";
  const astridBridgePort = process.env.VITE_ASTRID_BRIDGE_PORT ?? "17333";
  const astridBridgeTokenFile = process.env.ASTRID_REQUEST_TOKEN_FILE
    ?? "/tmp/astrid-real-bridge.token";
  const astridBridgeProtocolVersion = process.env.ASTRID_BRIDGE_PROTOCOL_VERSION ?? "v1";
  const readAstridBridgeToken = (): string | null => {
    const configured = process.env.ASTRID_BRIDGE_TOKEN?.trim();
    if (configured) return configured;
    try {
      const fromFile = fs.readFileSync(astridBridgeTokenFile, "utf8").trim();
      return fromFile.length > 0 ? fromFile : null;
    } catch {
      return null;
    }
  };
  const generatedRegistryPath = path.resolve(
    __dirname,
    "../../node_modules/@banodoco/timeline-composition/typescript/src/registry.generated.ts",
  );
  const generatedRegistryFallbackPath = path.resolve(
    __dirname,
    "../../src/tools/video-editor/lib/registry.generated.fallback.ts",
  );
  const themeApiPath = path.resolve(
    __dirname,
    "../../node_modules/@banodoco/timeline-composition/typescript/src/theme-api.ts",
  );
  const themeApiFallbackPath = path.resolve(
    __dirname,
    "../../src/tools/video-editor/lib/theme-api.fallback.tsx",
  );
  const timelineSchemaPath = path.resolve(
    __dirname,
    "../../node_modules/@banodoco/timeline-schema/typescript/dist/src/index.js",
  );
  const timelineSchemaFallbackPath = path.resolve(
    __dirname,
    "../../src/tools/video-editor/lib/timeline-schema.fallback.ts",
  );

  return {
    customLogger: logger,
    server: {
      host: "::",
      port: port,
      // Astrid local bridge. The browser receives same-origin `/api/astrid`
      // only; the server-side proxy reads the operator/per-run secret and
      // injects release authentication + protocol negotiation downstream.
      // Token bytes never enter browser JS, storage, cookies, URLs, or logs.
      proxy: {
        "/api/astrid": {
          target: `http://127.0.0.1:${astridBridgePort}`,
          changeOrigin: true,
          rewrite: (incomingPath) => incomingPath.replace(/^\/api\/astrid/, ""),
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyRequest, incomingRequest) => {
              const incomingOrigin = typeof incomingRequest.headers.origin === "string"
                ? incomingRequest.headers.origin
                : undefined;
              if (isSameOriginLoopbackRequest(incomingOrigin, incomingRequest.headers.host)) {
                proxyRequest.removeHeader("Origin");
              }
              const token = readAstridBridgeToken();
              if (token) {
                proxyRequest.setHeader("Authorization", `Bearer ${token}`);
              }
              proxyRequest.setHeader("X-Astrid-Bridge-Version", astridBridgeProtocolVersion);
            });
          },
        },
      },
      // Sprint 5: allow Vite to read from the sibling banodoco-workspace
      // (timeline-theme-2rp file: link).
      fs: {
        allow: [path.resolve(__dirname, "../../../..")],
      },
    },
    preview: {
      host: "0.0.0.0",
      port: port,
      allowedHosts: [...PREVIEW_ALLOWED_HOSTS],
    },
    plugins: [
      createRemoteFontModePlugin(disableRemoteFonts),
      react(),
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "../../src"),
        "@reigh/editor-sdk": path.resolve(__dirname, "../../src/sdk/index.ts"),
        // Sprint 5: deduplicate React / Remotion / @banodoco/* across the
        // linked timeline-composition + timeline-theme-* packages so a
        // single React runtime drives the @remotion/player preview.
        "react": path.resolve(__dirname, "../../node_modules/react"),
        "react-dom": path.resolve(__dirname, "../../node_modules/react-dom"),
        "remotion": path.resolve(__dirname, "../../node_modules/remotion"),
        "@remotion/layout-utils": path.resolve(__dirname, "../../node_modules/@remotion/layout-utils"),
        "@banodoco/timeline-composition/registry.generated": fs.existsSync(generatedRegistryPath)
          ? generatedRegistryPath
          : generatedRegistryFallbackPath,
        "@banodoco/timeline-composition/theme-api": fs.existsSync(themeApiPath)
          ? themeApiPath
          : themeApiFallbackPath,
        "@banodoco/timeline-schema": fs.existsSync(timelineSchemaPath)
          ? timelineSchemaPath
          : timelineSchemaFallbackPath,
        "@banodoco/timeline-composition": path.resolve(__dirname, "../../node_modules/@banodoco/timeline-composition"),
        // Workspace-primitive aliases (mirrors banodoco shell webpack-alias.mjs).
        // Vendored into reigh-app/vendor/ so the Docker build context can resolve them
        // — the original ../../../../banodoco-workspace paths sit outside the build context.
        "@workspace-effects": path.resolve(__dirname, "../../vendor/banodoco-effects"),
        "@workspace-animations": path.resolve(__dirname, "../../vendor/banodoco-animations"),
        "@workspace-transitions": path.resolve(__dirname, "../../vendor/banodoco-transitions"),
      },
      dedupe: ['react', 'react-dom', 'react-reconciler', 'remotion', '@banodoco/timeline-composition', '@banodoco/timeline-theme-2rp'],
    },
    build: {
      outDir: "dist",
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks: manualVendorChunk,
        }
      }
    },
    optimizeDeps: {
      exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"],
    },
  };
});
