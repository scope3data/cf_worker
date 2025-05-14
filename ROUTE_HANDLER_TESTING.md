# Testing Route Handler Mode

This document provides instructions for testing the Scope3 Segments Worker in route handler mode.

## What is Route Handler Mode?

Route handler mode allows the worker to intercept and process requests that match specific URL patterns in Cloudflare. This is more seamless than proxy mode as users don't need to modify URLs to access the enhanced pages.

## Local Testing

### Option 1: Using the Test Script

We've created a dedicated test script that simulates route handler mode:

```bash
npm run test:route
```

This script:
1. Sets up a local server with test content
2. Creates a simulated request that would match a Cloudflare route pattern
3. Passes this request to the worker's fetch handler
4. Verifies that segments are properly injected into the HTML

### Option 2: Using Wrangler Dev Mode

You can also test route handler mode using Wrangler's development server:

```bash
npm run dev:route
```

This will:
1. Start the worker in routes environment configuration
2. Simulate route matching behavior

To test:
1. Visit http://localhost:8787
2. The worker will operate in route handler mode, not proxy mode
3. It will fetch content from the origin (example.com by default)
4. Inject segments and return the modified content

## Cloudflare Deployment Testing

For full end-to-end testing of route handler mode:

1. Deploy the worker to Cloudflare:
   ```bash
   wrangler deploy --env routes
   ```

2. Configure your Cloudflare Dashboard:
   - Go to Workers & Pages > Your Worker > Triggers
   - Set up a Custom Domain or Route pattern (e.g., example.com/*)
   - Make sure the domain is proxied through Cloudflare

3. Visit a URL that matches your configured pattern
   - The page should load normally
   - Open browser dev tools and verify `window.scope3_segments` is defined
   - Check console logs for Scope3 segments loaded confirmation

## Troubleshooting

If segments aren't showing up in route handler mode:

1. Verify the worker is properly detecting route handler mode
   - Look for logs with `[ROUTING]` prefix
   - Check for "ROUTE HANDLER MODE" in the logs

2. Make sure you're testing with an HTML page
   - Non-HTML resources will pass through without modification
   - The Content-Type header must include "text/html"

3. Verify API connection
   - Check for any API timeout errors in logs
   - Ensure SCOPE3_API_KEY is properly set (if using real API)