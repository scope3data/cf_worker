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
- **API Integration**: Call Scope3 API to get contextual segments
- **Content Extraction**: Parse HTML to extract page content
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
- **Content Extraction**: Extracts relevant content from pages to send to Scope3 API
- **Segment Injection**: Adds segments to the page as a JavaScript variable
- **URL Proxy Service**: Fetches and modifies external content

## Configuration Options

The following can be configured:
- `SCOPE3_API_ENDPOINT`: API endpoint URL (in code)
- `SCOPE3_API_KEY`: API key (stored as a secret)
- `CACHE_TTL`: Cache lifetime in seconds (default: 3600 - 1 hour)
- `API_TIMEOUT`: Maximum wait time for API in ms (default: 1000)

## Testing

The project includes two test suites:

1. **Proxy Tests**: Verifies URL handling and proxying functionality
   - Tests for various URL formats (HTTP, HTTPS, protocol-relative)
   - Tests for query parameter preservation
   - Tests for error handling

2. **Segment Tests**: Verifies segment generation functionality
   - Tests for segments on different site types
   - Tests for special domain handling (e.g., people.com)
   - Tests for API integration

## Best Practices

- Keep the content extraction lightweight to avoid page load delays
- Adjust the API timeout based on your performance requirements
- Monitor cache hit rates and adjust TTL as needed
- Run tests before deployment to ensure all functionality works correctly
- Rewrite URLs to avoid proxying resources for better performance