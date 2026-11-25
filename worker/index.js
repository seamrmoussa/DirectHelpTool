const API_ORIGIN = 'https://visa-be.directksa.com';

const ALLOWED_API_PREFIX = '/api/v1/admin/';

export default {
  async fetch(request, env) {
    const incomingUrl = new URL(request.url);

    // API Proxy
    if (incomingUrl.pathname.startsWith('/api/')) {
      // Restrict proxy access to the intended API path
      if (!incomingUrl.pathname.startsWith(ALLOWED_API_PREFIX)) {
        return new Response('Not Found', { status: 404 });
      }

      // Preserve original path and query parameters
      const upstreamUrl = new URL(incomingUrl.pathname + incomingUrl.search, API_ORIGIN);

      try {
        // Forward method, headers, authorization and body
        const upstreamRequest = new Request(upstreamUrl, request);

        const upstreamResponse = await fetch(upstreamRequest);

        // Prevent caching of potentially sensitive admin data
        const responseHeaders = new Headers(upstreamResponse.headers);
        responseHeaders.set('Cache-Control', 'no-store');

        return new Response(upstreamResponse.body, {
          status: upstreamResponse.status,
          statusText: upstreamResponse.statusText,
          headers: responseHeaders,
        });
      } catch (error) {
        console.error('API Proxy Error:', error);

        return new Response('Unable to connect to the API server', { status: 502 });
      }
    }

    // Serve Angular static files
    return env.ASSETS.fetch(request);
  },
};
