/* iTask API URL adapter.
 * Local static development (python http.server :5500) sends /api requests to Node :3000.
 * Nginx/Docker deployments keep same-origin /api proxying.
 */
(() => {
  "use strict";
  const localPython = ["5500"].includes(window.location.port);
  const apiOrigin = localPython ? `${window.location.protocol}//${window.location.hostname}:3000` : "";
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input === "string" && input.startsWith("/api/")) {
      input = `${apiOrigin}${input}`;
    } else if (input instanceof URL && input.pathname.startsWith("/api/")) {
      input = `${apiOrigin}${input.pathname}${input.search}${input.hash}`;
    } else if (typeof Request !== "undefined" && input instanceof Request &&
               new URL(input.url).origin === window.location.origin &&
               new URL(input.url).pathname.startsWith("/api/")) {
      const u = new URL(input.url);
      input = new Request(`${apiOrigin}${u.pathname}${u.search}${u.hash}`, input);
    }
    return originalFetch(input, init);
  };
})();
