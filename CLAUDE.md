# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Cloudflare Worker project that integrates with the Scope3 publisher real-time API. The worker fetches segments based on page content and injects them into the page for ad targeting, with caching and timeout handling to ensure good performance.

## Project Structure

- `src/index.js`: Main Cloudflare Worker code
- `wrangler.toml`: Configuration for Cloudflare Workers
- `test/`: Test suites for verifying functionality
  - `proxy-tests.js`: Tests for URL proxy functionality
  - `segment-tests.js`: Tests for segment generation
- Dependencies:
  - `wrangler`: CLI tool for developing and deploying Cloudflare Workers

## Development Commands

### Setup
```bash
# Install dependencies
npm install

# Configure Scope3 API key
npx wrangler secret put SCOPE3_API_KEY

# Create KV namespace for caching
npx wrangler kv namespace create SEGMENTS_CACHE
# Then update wrangler.toml with the KV namespace ID
```

### Running the Project
```bash
# Run the worker locally
npm run dev

# Deploy to Cloudflare
npm run deploy

# Run tests
node test/proxy-tests.js
node test/segment-tests.js
```

## Core Requirements

### URL Proxy Functionality
- **Direct Proxy Mode**: Access content via `/proxy/[URL]` routes
- **Protocol Handling**: Support HTTP, HTTPS, and protocol-relative URLs
- **Resource Handling**: Rewrite URLs in HTML to load resources directly from source site
- **Error Handling**: Gracefully handle invalid URLs and connection failures

### Segment Generation
- **API Integration**: Call Scope3 API using OpenRTB format to get contextual segments
- **OpenRTB Request**: Build OpenRTB-compliant request objects that include:
  - Site information (domain, page URL)
  - Page metadata (etag, last-modified)
  - Device information (type, OS, user agent)
  - Geo information (country, region, coordinates)
- **Fallback Generation**: Provide mock segments when API key is missing or API call fails
- **Special Case Handling**: Support predefined segments for specific domains
- **Caching**: Cache results to avoid repeated API calls

### HTML Modification
- **Segment Injection**: Inject segments as JavaScript variable `window.scope3_segments`
- **URL Rewriting**: Rewrite URLs to avoid proxying resources
- **Performance**: Maintain minimal impact on page load time

## Architecture

The worker uses a multi-layered approach:

1. **Request Interception**: Intercepts HTML page requests only
2. **Caching**: Checks for cached segments using Cloudflare KV
3. **API Integration**: If no cache, extracts page content and calls Scope3 API
4. **Timeout Handling**: Aborts API calls after a threshold to prevent slow page loads
5. **HTML Modification**: Injects segments into the page for ad systems to use

## Key Components

- **Cache System**: Using Cloudflare KV, segments are cached with a configurable TTL
- **Timeout Mechanism**: API calls are limited to a configurable timeout (default 1000ms)
- **OpenRTB Request Builder**: Creates standardized OpenRTB request objects for the Scope3 API
- **Segment Injection**: Adds segments to the page as a JavaScript variable
- **URL Proxy Service**: Fetches and modifies external content

## Configuration Options

The following can be configured:
- `SCOPE3_API_ENDPOINT`: API endpoint URL (in code)
- `SCOPE3_API_KEY`: API key (stored as a secret)
- `CACHE_TTL`: Cache lifetime in seconds (default: 3600 - 1 hour)
- `API_TIMEOUT`: Maximum wait time for API in ms (default: 1000)

## Testing

### Running Tests

```bash
# Run all tests
node test/run-test.js

# Run specific unit tests
node test/index-test.js
node test/open-rtb-test.js
```

The project includes several test suites:

1. **Comprehensive Tests**: Full test suite that validates all worker functionality
   - Tests URL handling and proxying
   - Tests segment generation and injection
   - Tests OpenRTB request generation and API integration

2. **OpenRTB Tests**: Specific tests for the OpenRTB request format
   - Validates the structure and content of OpenRTB requests
   - Verifies correct handling of device information
   - Ensures proper geo data handling
   - Tests request variations (different device types, browsers, etc.)

3. **Integration Tests**: Verifies end-to-end functionality
   - Tests for various URL formats (HTTP, HTTPS, protocol-relative)
   - Tests for segment inclusion and formatting
   - Tests for error handling and timeouts

## API Integration

### OpenRTB Request Format

The worker uses the OpenRTB format to communicate with the Scope3 API. The main structure includes:

```javascript
{
  "site": {
    "domain": "example.com",
    "page": "https://example.com/article",
    "ext": {
      "scope3": {
        "etag": "W/\"12345\"",
        "last_modified": "Wed, 21 Oct 2023 07:28:00 GMT"
      }
    }
  },
  "imp": [
    {
      "id": "1"
    }
  ],
  "device": {
    "devicetype": 2, // 1=mobile, 2=desktop, 5=tablet
    "geo": {
      "country": "US",
      "region": "CA",
      "city": "San Francisco",
      "zip": "94107",
      "lat": 37.7749,
      "lon": -122.4194,
      "utcoffset": "America/Los_Angeles"
    },
    "ua": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36...",
    "os": "Windows",
    "make": "Google",
    "model": "Chrome"
  }
}
```

### API Response Processing

The API responds with segment data that is processed and structured as:

```javascript
{
  "global": [], // Global segments
  "1": ["segment1", "segment2"] // Slot-specific segments
}
```

This structure is then injected into the page as `window.scope3.segments`.

## Cache System

The caching system uses a hash of the OpenRTB request as the cache key:

```javascript
const cacheKey = `${apiHost}:${requestHash}`;
```

This ensures that:
- Similar requests get the same cached response
- Changes in page content (via etags) trigger new API calls
- The cache is properly scoped to the API endpoint being used

## Best Practices

- Adjust the API timeout based on your performance requirements (default 1000ms)
- Monitor cache hit rates and adjust TTL as needed (default 1 hour)
- Run tests before deployment to ensure all functionality works correctly
- Implement proper error handling for API failures
- Use the Cloudflare Cache API effectively to reduce API calls
- Rewrite URLs to avoid proxying resources for better performance