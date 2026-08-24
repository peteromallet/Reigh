/**
 * The browser talks to Astrid through Vite's same-origin `/api/astrid` proxy.
 * JSON writes include an Origin header even though they are same-origin. The
 * bridge quite correctly rejects arbitrary dev-server ports, so the trusted
 * proxy may consume that header only when it proves it names this exact
 * loopback HTTP listener. Cross-origin and non-loopback origins continue
 * downstream and are rejected by the bridge.
 */
export function isSameOriginLoopbackRequest(
  originHeader: string | undefined,
  hostHeader: string | undefined,
): boolean {
  if (!originHeader || !hostHeader) return false;

  let origin: URL;
  try {
    origin = new URL(originHeader);
  } catch {
    return false;
  }

  if (origin.protocol !== 'http:') return false;
  const hostname = origin.hostname.toLowerCase();
  if (hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '[::1]') {
    return false;
  }

  return origin.host.toLowerCase() === hostHeader.trim().toLowerCase();
}
