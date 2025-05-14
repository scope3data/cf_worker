# Scope3 Segments Worker

A Cloudflare Worker that integrates with the Scope3 publisher API to fetch contextual segments for web pages and inject them for ad targeting.

## Features

- Proxy mode for accessing content via `/proxy/[URL]` URLs
- Segment generation based on page content
- HTML rewriting to load resources directly from source sites
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

### Proxy Mode

Access any website through the worker by prepending `/proxy/` to the URL:

```
http://localhost:8787/proxy/https://example.com
```

The worker will:
1. Fetch the content from example.com
2. Generate or retrieve cached segments for the page
3. Inject segments as a JavaScript variable (`window.scope3_segments`)
4. Rewrite URLs to load resources directly from the source

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
- `CACHE_TTL`: Cache lifetime in seconds (default: 3600s / 1 hour)

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