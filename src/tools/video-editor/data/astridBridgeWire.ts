/** Public, non-secret parts of the Reigh/Astrid local bridge handshake. */
export const ASTRID_BRIDGE_PROTOCOL_VERSION = 'v1';
export const ASTRID_BRIDGE_PROTOCOL_HEADER = 'X-Astrid-Bridge-Version';
/** Shared end-to-end deadline for browser requests and both Vite proxy sockets. */
export const ASTRID_BRIDGE_REQUEST_TIMEOUT_MS = 10_000;
