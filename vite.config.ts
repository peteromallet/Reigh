// Canonical Vite configuration lives in config/vite/. This forwarder exists so
// bare `vite`/`vite build` invocations resolve the same config as the npm
// scripts instead of failing on unresolved aliases.
export { default } from "./config/vite/vite.config";
