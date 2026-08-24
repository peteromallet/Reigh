/**
 * React 18 publishes a browser-specific `react-dom/server.browser.js`
 * runtime entry, but @types/react-dom does not publish a matching declaration
 * module. Keep the declaration tied to the canonical server API while the
 * Vite import remains explicitly browser-safe.
 */
declare module 'react-dom/server.browser' {
  export * from 'react-dom/server';
}
