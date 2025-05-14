# Deploying Scope3 Segments Worker to Cloudflare

This document provides step-by-step instructions for deploying the Scope3 Segments Worker to Cloudflare and configuring it for route handler mode.

## Prerequisites

- Cloudflare account with Workers subscription
- Scope3 API key (optional, mock segments are provided without a key)
- Domain configured on Cloudflare (for route handler mode)

## Deployment Steps

### 1. Login to Cloudflare Wrangler

If you haven't already, log in to Cloudflare through Wrangler:

```bash
npx wrangler login
```

Follow the prompts to authorize Wrangler to access your Cloudflare account.

### 2. Set up KV Namespaces

The worker uses two KV namespaces:
- `SEGMENTS_CACHE` - For caching Scope3 API segments
- `HTML_CACHE` - For intelligent caching of origin HTML with change detection

You can set up both namespaces easily using the provided setup script:

```bash
./setup-html-cache.sh
```

Or manually create them:

```bash
# Create segments cache namespace
npx wrangler kv namespace create SEGMENTS_CACHE

# Create HTML cache namespace
npx wrangler kv namespace create HTML_CACHE
```

After creating the namespaces, update the `wrangler.toml` file with the IDs:

```toml
# For segments cache
[[kv_namespaces]]
binding = "SEGMENTS_CACHE"
id = "your-segments-cache-id-here"

# For HTML cache
[[kv_namespaces]]
binding = "HTML_CACHE"
id = "your-html-cache-id-here"

# Also update IDs in each environment
[[env.development.kv_namespaces]]
binding = "SEGMENTS_CACHE"
id = "your-segments-cache-id-here"

[[env.development.kv_namespaces]]
binding = "HTML_CACHE"
id = "your-html-cache-id-here"

[[env.routes.kv_namespaces]]
binding = "SEGMENTS_CACHE"
id = "your-segments-cache-id-here"

[[env.routes.kv_namespaces]]
binding = "HTML_CACHE"
id = "your-html-cache-id-here"
```

### 3. Configure Scope3 API Key

Set up your Scope3 API key as a secret:

```bash
npx wrangler secret put SCOPE3_API_KEY
```

When prompted, enter your Scope3 API key. This will be encrypted and securely stored.

### 4. Configure Route Pattern (for Route Handler Mode)

In your `wrangler.toml` file, update the routes configuration with your domain:

```toml
[env.routes.routes]
pattern = "yourdomain.com/*"  # Replace with your domain
zone_name = "yourdomain.com"  # Replace with your domain
```

This tells Cloudflare to route all requests for yourdomain.com through the worker.

### 5. Deploy the Worker

For standard proxy mode:

```bash
npx wrangler deploy
```

For route handler mode:

```bash
npx wrangler deploy --env routes
```

### 6. Configure Worker Routes in Cloudflare Dashboard

After deployment, you need to configure your routes in the Cloudflare dashboard:

1. Log in to your Cloudflare account
2. Go to Workers & Pages
3. Find your worker (scope3-segments-worker or scope3-segments-worker-routes)
4. Click on "Triggers"
5. Add a Custom Domain or Route:
   - For a whole domain: `yourdomain.com/*`
   - For specific pages: `yourdomain.com/blog*`
   - For multiple patterns, add each one separately

> **Important**: Ensure your domain is proxied through Cloudflare (orange cloud icon) for the worker routes to function.

### 7. Test the Deployment

For proxy mode:
- Visit `https://scope3-segments-worker.yourdomain.workers.dev/proxy/https://example.com`

For route handler mode:
- Simply visit your domain: `https://yourdomain.com`
- The worker will intercept the request, fetch the original content, and inject segments

To verify it's working:
1. Open browser developer tools (F12)
2. Check the Console to see "Scope3 segments loaded" message
3. Type `window.scope3_segments` in the console to see the injected segments

## Monitoring and Troubleshooting

### Logs

View real-time logs while testing:

```bash
npx wrangler tail
```

### Analytics

Cloudflare provides analytics for your worker:
1. Go to the Cloudflare dashboard
2. Navigate to Workers & Pages > Your Worker > Analytics

### Common Issues

- **Segments not appearing**: Check if the SCOPE3_API_KEY is set correctly
- **Worker not triggering on route**: Ensure your domain is proxied through Cloudflare
- **403 or 500 errors**: Check the worker logs for specific error messages