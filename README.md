# Scope3 Segments Worker

A Cloudflare Worker that integrates with the Scope3 publisher API to fetch contextual segments for web pages and inject them for ad targeting.

## Features

- Proxy mode for accessing content via `/proxy/[URL]` URLs
- Route handler mode for seamless integration on your domain
- Segment generation based on page content
- HTML rewriting to load resources directly from source sites
- Intelligent caching of origin HTML with change detection
- Caching of segments to improve performance
- Automatic handling of protocol-relative URLs

## Getting Started

### Prerequisites

- Node.js and npm
- Cloudflare account
- Scope3 API key (optional, mock segments are provided without a key)

### Installation

1. Clone the repository
2. Install dependencies:

```bash
npm install
```

3. Configure your Scope3 API key (optional):

```bash
npx wrangler secret put SCOPE3_API_KEY
```

4. Create a KV namespace for caching:

```bash
npx wrangler kv namespace create SEGMENTS_CACHE
```

5. Update `wrangler.toml` with your KV namespace ID

### Development

Run the worker locally:

```bash
npm run dev
```

Access the local worker at: http://localhost:8787

### Testing

Run the test suites:

```bash
npm test
```

This will run both:
- `test/proxy-tests.js` - Tests URL proxy functionality
- `test/segment-tests.js` - Tests segment generation

### Available Scripts

- `npm run dev` - Run the main worker with example.com as upstream
- `npm run test` - Run the test suites
- `npm run deploy` - Deploy the worker to Cloudflare
- `npm run start` - Alias for dev
- `npm run debug` - Run the debug worker
- `npm run test-resource` - Run the test resource worker
- `npm run api-segments` - Run the API segments worker
- `npm run fixed-api` - Run a simplified API segments worker

## Usage

## Operation Modes

The worker can operate in two different modes:

### 1. Proxy Mode

Access any website through the worker by prepending `/proxy/` to the URL:

```
http://localhost:8787/proxy/https://example.com
```

The worker will:
1. Fetch the content from example.com
2. Generate or retrieve cached segments for the page
3. Inject segments as a JavaScript variable (`window.scope3_segments`)
4. Rewrite URLs to load resources directly from the source

### 2. Route Handler Mode

In this mode, the worker is deployed with Cloudflare routing rules that intercept requests to specific patterns:

```
# Example in wrangler.toml
[env.routes.routes]
pattern = "example.com/*"
zone_name = "example.com"
```

When a user visits a page that matches the pattern (e.g., https://example.com/any-page):
1. Cloudflare routes the request to the worker
2. The worker fetches the original content from the origin server
3. Generates or retrieves cached segments for the page
4. Injects segments as a JavaScript variable (`window.scope3_segments`)
5. Returns the modified content to the user

This mode is more seamless as it doesn't require changing URLs to access pages.

### API Mode

Get segments for a URL without proxying the content:

```
http://localhost:8787/api/segments?url=https://example.com
```

Returns JSON with segments:

```json
{
  "url": "https://example.com",
  "segments": ["example_domain", "test_content", "generic_web"],
  "source": "cache|api|mock",
  "timestamp": "2023-05-13T12:34:56.789Z"
}
```

## Configuration

Edit `wrangler.toml` to configure:

- `API_TIMEOUT`: Maximum wait time for API (default: 1000ms)
- `CACHE_TTL`: Cache lifetime for segments in seconds (default: 3600s / 1 hour)
- `HTML_CACHE_TTL`: Cache lifetime for HTML content in seconds (default: 86400s / 24 hours)

### Intelligent HTML Caching

The worker implements intelligent caching of origin HTML content with change detection:

1. **Initial Request**: When a page is first visited, the content is fetched and cached
2. **Conditional Requests**: For subsequent requests, the worker uses ETag and Last-Modified headers
3. **Change Detection**: If the origin reports the content hasn't changed (304 status), the cached version is used
4. **Automatic Updates**: If the content has changed, the cache is updated with the new version

This system reduces bandwidth and improves performance while ensuring content is always up-to-date.

## Troubleshooting

If you encounter issues with the main worker's `/api/segments` endpoint:

1. Use the fixed-api worker instead:
```bash
npm run fixed-api
```

2. Access the API at:
```
http://localhost:8787/api/segments?url=example.com
```

3. Check the console logs for detailed debugging information