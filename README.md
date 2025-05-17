# Scope3 Segments Worker

A Cloudflare Worker that integrates with the Scope3 publisher API to fetch contextual segments for web pages and inject them for ad targeting.

## Features

- Proxy mode for accessing content via `/proxy/[URL]` URLs
- Segment generation based on page content
- Caching of segments to improve performance
- Bot detection and bypass

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

Run the test suite:

```bash
npm test
```

This runs `test/index-test.js` to verify the worker's core functionality.

### Available Scripts

- `npm run dev` - Run the worker with example.com as upstream
- `npm run test` - Run the test suite
- `npm run deploy` - Deploy the worker to Cloudflare

## Usage

### Operation Modes

The worker can operate in two different modes:

#### 1. Proxy Mode

Access any website through the worker by prepending `/proxy/` to the URL:

```
http://localhost:8787/proxy/https://example.com
```

The worker will:
1. Fetch the content from example.com
2. Generate or retrieve cached segments for the page
3. Inject segments as a JavaScript variable (`window.scope3.segments`)
4. Add a base tag to ensure resources load correctly from the original site

#### 2. Route Handler Mode

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
4. Injects segments as a JavaScript variable (`window.scope3.segments`)
5. Returns the modified content to the user

This mode is more seamless as it doesn't require changing URLs to access pages.

## Configuration

Edit `wrangler.toml` to configure:

- `API_TIMEOUT`: Maximum wait time for API (default: 200ms)
- `CACHE_TTL`: Cache lifetime for segments in seconds (default: 3600s / 1 hour)

## Segment Injection

The worker injects segments into the HTML document's head tag in this format:

```html
<script>
  window.scope3 = window.scope3 || {};
  window.scope3.segments = ["segment1", "segment2", "segment3"];
</script>
```

These segments can be used by ad systems to improve targeting.