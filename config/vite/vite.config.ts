import { defineConfig, createLogger } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import {
  manualVendorChunk,
  PREVIEW_ALLOWED_HOSTS,
  resolveVitePort,
} from "./policy";

const logger = createLogger();
const originalWarn = logger.warn.bind(logger);
logger.warn = (msg, options) => {
  if (msg.includes('postcss.parse') && msg.includes('from')) return;
  originalWarn(msg, options);
};

export default defineConfig(() => {
  const port = resolveVitePort(process.env.PORT);

  return {
    customLogger: logger,
    server: {
      host: "::",
      port: port,
    },
    preview: {
      host: "0.0.0.0",
      port: port,
      allowedHosts: [...PREVIEW_ALLOWED_HOSTS],
    },
    plugins: [
      react(),
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "../../src"),
        "@tbd/editor": path.resolve(__dirname, "../../packages/editor/src/index.ts"),
        "@tbd/schema": path.resolve(__dirname, "../../packages/schema/src/index.ts"),
        "@tbd/engine": path.resolve(__dirname, "../../packages/engine/src/index.ts"),
      },
      dedupe: ['react', 'react-dom', 'react-reconciler'],
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
