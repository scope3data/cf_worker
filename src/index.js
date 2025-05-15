/**
 * Scope3 Publisher API Cloudflare Worker
 * 
 * This worker intercepts HTML page requests, fetches segments from the Scope3 API,
 * and injects them directly into the page before returning it to the browser.
 */

// Import HTML cache integration functionality
const htmlCacheIntegration = require('./html-cache-integration');

// Import refactored modules
const config = require('./config');
const { extractPageContent } = require('./modules/content-utils');
const { 
  getTargetUrl, 
  isLikelyHtmlUrl, 
  isHtmlRequest, 
  filterHeaders,
  cleanMalformedUrl
} = require('./modules/url-utils');
const { 
  injectSegmentsIntoPage, 
  createTestPage, 
  createContentTestPage 
} = require('./modules/html-processor');
const { 
  getScope3SegmentsWithTimeout, 
  getCachedSegments, 
  cacheSegments 
} = require('./modules/segments');

/**
 * Main worker fetch handler
 */
export default {
  async fetch(request, env, ctx) {
    try {
      console.log(`[REQ-DEBUG] Request URL: ${request.url}, Method: ${request.method}`);
      console.log(`[REQ-DEBUG] Host header: ${request.headers.get('host')}`);
      
      // Dump ALL request headers to diagnose the issue
      const allHeaders = {};
      for (const [key, value] of request.headers.entries()) {
        allHeaders[key] = value;
      }
      console.log(`[REQ-DEBUG] All headers: ${JSON.stringify(allHeaders, null, 2)}`);
      
      // Additional diagnostics for the URL
      console.log(`[REQ-DEBUG] URL stringified: ${String(request.url)}`);
      console.log(`[REQ-DEBUG] URL constructor param: ${request.url.constructor ? request.url.constructor.name : 'unknown'}`);
      
      // Construct the URL directly from the Request object if available
      const directUrl = new URL(request.url);
      console.log(`[REQ-DEBUG] URL constructed directly: ${directUrl.toString()}`);
      
      // CRITICAL FIX: The request.url is somehow getting corrupted
      if (request.url && typeof request.url === 'string') {
        // Check for malformed URL patterns
        const urlStr = request.url.toString();
        
        // Case 1: http://http//proxy/ pattern
        if (urlStr.includes('http://http//proxy/')) {
          console.log(`[CRITICAL-FIX] Detected malformed "http://http//proxy/" pattern`);
          
          // Extract target URL
          const targetPart = urlStr.split('http://http//proxy/')[1];
          if (targetPart) {
            const host = request.headers.get('host') || 'localhost:8787';
            const fixedUrl = `http://${host}/proxy/${targetPart}`;
            console.log(`[CRITICAL-FIX] Redirecting to fixed URL: ${fixedUrl}`);
            return Response.redirect(fixedUrl, 302);
          }
        }
        
        // Case 2: Verify the URL structure looks legitimate 
        if (urlStr.includes('/proxy/')) {
          const host = request.headers.get('host') || 'localhost:8787';
          const pathParts = urlStr.split('/proxy/');
          
          // Check if the beginning looks malformed
          if (pathParts[0] && !pathParts[0].includes(host)) {
            console.log(`[CRITICAL-FIX] URL prefix doesn't match host: ${pathParts[0]} vs ${host}`);
            
            // If we can extract the meaningful part, rebuild the URL
            if (pathParts[1]) {
              const fixedUrl = `http://${host}/proxy/${pathParts[1]}`;
              console.log(`[CRITICAL-FIX] Rebuilding URL as: ${fixedUrl}`);
              return Response.redirect(fixedUrl, 302);
            }
          }
        }
      }
      
      // Check if the request URL is already malformed before we do anything
      try {
        const initialUrl = new URL(request.url);
        console.log(`[REQ-DEBUG] Initial URL parsed successfully: protocol=${initialUrl.protocol}, host=${initialUrl.host}, pathname=${initialUrl.pathname}`);
      } catch (e) {
        console.error(`[REQ-DEBUG] Initial URL is invalid: ${e.message}`);
      }
      
      // Only log environment variables on the first request
      // Use a static variable on the class instead of global
      if (!this.envLogged) {
        console.log('[ENV] Available environment variables:', Object.keys(env));
        console.log('[ENV] API_TIMEOUT available:', !!env.API_TIMEOUT);
        console.log('[ENV] SCOPE3_API_KEY available:', !!env.SCOPE3_API_KEY);
        console.log('[ENV] HTML_CACHE available:', !!env.HTML_CACHE);
        console.log('[ENV] SEGMENTS_CACHE available:', !!env.SEGMENTS_CACHE);
        
        // Set the flag to avoid logging on subsequent requests
        this.envLogged = true;
      }
      
      // We're removing special case handling for static URLs.
      // Instead, we'll fix the root cause by ensuring URLs are correctly rewritten in the HTML processor.
      
      // Basic URL checking - keep it simple
      const urlString = request.url;
      console.log(`[DEBUG-URL] Raw URL: ${urlString}`);
      
      // Special case handling for double static paths
      if (urlString.includes('/static/')) {
        console.log(`[STATIC-RESOURCE] Checking for double static path in URL: ${urlString}`);
        
        try {
          // Parse the URL to work with its components
          const url = new URL(urlString);
          
          // Check for common double static path patterns:
          // 1. Direct pattern: /static/static/
          // 2. With version: /static/3.73.0/static/ (or any other version)
          const doubleStaticRegex = /\/static\/([^\/]+\/)?static\//;
          
          if (doubleStaticRegex.test(url.pathname)) {
            console.log(`[STATIC-RESOURCE] Detected double static pattern in path: ${url.pathname}`);
            
            // Extract the corrected path by fixing the double static pattern
            // This handles both /static/static/ and /static/VERSION/static/ patterns
            const correctedPath = url.pathname.replace(doubleStaticRegex, '/static/');
            
            // For determining the origin host, look at any referer header first
            const referer = request.headers.get('referer') || '';
            let originHost = 'people.com'; // Default fallback
            
            // Try to extract the original host from referer if it exists
            if (referer && referer.includes('/proxy/')) {
              const proxyUrlMatch = referer.match(/\/proxy\/(https?:\/\/[^\/]+)/);
              if (proxyUrlMatch && proxyUrlMatch[1]) {
                const proxyUrl = new URL(proxyUrlMatch[1]);
                originHost = proxyUrl.host;
                console.log(`[STATIC-RESOURCE] Extracted origin host from referer: ${originHost}`);
              }
            }
            
            // Build the corrected URL pointing directly to the origin
            const correctedUrl = `https://${originHost}${correctedPath}${url.search}`;
            console.log(`[STATIC-RESOURCE] Redirecting double static path to: ${correctedUrl}`);
            
            return Response.redirect(correctedUrl, 302);
          }
        } catch (e) {
          console.error(`[STATIC-RESOURCE] Error handling double static path: ${e.message}`);
        }
      }
      
      // IMPORTANT: Get requested host from headers - don't overwrite this with parsed URL
      // This is critical to avoid "http://http" malformed redirects
      const requestedHost = request.headers.get('host') || 'localhost:8787';
      let requestedProtocol = 'http:';
      
      console.log(`[HOST-DEBUG] Using host from headers: ${requestedHost}`);
      
      try {
        const url = new URL(request.url);
        // NOTE: Don't replace requestedHost with url.host - the headers are more reliable
        requestedProtocol = url.protocol;
        console.log(`[HOST-DEBUG] Protocol from URL: ${requestedProtocol}`);
      } catch (e) {
        console.error(`[DEBUG-URL] Error parsing URL: ${e.message}`);
      }
      
      // Check for proxy URLs and handle them
      if (urlString.includes('/proxy/')) {
        // Find the position of /proxy/
        const proxyIndex = urlString.indexOf('/proxy/');
        
        if (proxyIndex >= 0) {
          // Extract everything after /proxy/
          const targetUrlPart = urlString.substring(proxyIndex + 7); // Skip /proxy/
          
          // Ensure it has a protocol
          let finalTargetUrl;
          if (targetUrlPart.startsWith('http://') || targetUrlPart.startsWith('https://')) {
            // DO NOT modify proxy URLs to avoid double prefixing
            finalTargetUrl = targetUrlPart;
          } else if (targetUrlPart.startsWith('//')) {
            finalTargetUrl = 'https:' + targetUrlPart;
          } else {
            finalTargetUrl = 'https://' + targetUrlPart;
          }
          
          console.log(`[PROXY-CRITICAL] Extracted target URL: ${finalTargetUrl}`);
          
          // CRITICAL: Save the original host and don't let it get overridden
          // This is needed for handleProxyRequest to know the correct host
          request.hscHost = request.headers.get('host') || 'localhost:8787';
          console.log(`[CRITICAL-FIX] Saving host before proxy: ${request.hscHost}`);
          
          // Instead of immediately returning the response, go through the handleProxyRequest
          // function to ensure Scope3 API is called
          return await handleProxyRequest(finalTargetUrl, env, ctx, request);
        }
      }
      
      let url;
      try {
        url = new URL(request.url);
        
        // NOT USED: We're using requestedHost from headers now
        // These variables caused the malformed URL bug when they overrode requestedHost
        // const requestHost = url.host;
        // const requestProtocol = url.protocol;

        // Handle special paths with quick checks
        const simplePath = url.pathname.toLowerCase();
        
        // Test page endpoint
        if (simplePath === '/test' || 
            simplePath === '/' && (url.hostname === 'localhost' || url.hostname.includes('127.0.0.1'))) {
          console.log(`[TEST] Displaying test page for path: ${url.pathname}`);
          return createTestPage();
        }

        // Special debug page for troubleshooting URL/API issues
        if (simplePath === '/debug') {
          console.log(`[DEBUG] Redirecting to the test page`);
          // Safely create the redirect URL to avoid "http://http" issue
          const safeHost = request.headers.get('host') || url.host;
          const redirectUrl = new URL(`/test`, `http://${safeHost}`);
          console.log(`[DEBUG] Redirecting to test page: ${redirectUrl.toString()}`);
          return Response.redirect(redirectUrl.toString(), 302);
        }

        // Direct handler for example.com segments, bypassing the normal handler
        if (simplePath === '/api/example') {
          console.log(`[API-DIRECT] Handling direct example.com request`);
          return new Response(JSON.stringify({
            url: "https://example.com",
            segments: ["api_example", "direct_endpoint", "test_data"],
            source: "direct api endpoint",
            timestamp: new Date().toISOString()
          }), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'no-cache'
            }
          });
        }

        // Test different content types for segment generation
        if (simplePath.startsWith('/test-content/')) {
          const contentType = url.pathname.split('/').pop();
          const response = createContentTestPage(contentType);

          // Get segments for this test content
          const html = await response.clone().text();
          const pageData = extractPageContent(html, request.url);
          const segments = await getScope3SegmentsWithTimeout(pageData, env, ctx, true); // Force API call
          console.log(`[TEST-CONTENT] Received segments for ${contentType}: ${JSON.stringify(segments)}`);

          // Inject segments into the page
          return injectSegmentsIntoPage(response, segments);
        }

        // Handle API endpoint to fetch segments for a specific URL
        if (simplePath.includes('/api/segments')) {
          console.log(`[ROUTING] Detected API segments request at path: ${url.pathname}`);
          
          try {
            return handleApiRequest(request, env, ctx);
          } catch (error) {
            console.error(`[ROUTING] Error in handleApiRequest: ${error}`);
            return new Response(JSON.stringify({
              error: `Error in API handler: ${error.message}`,
              stack: error.stack
            }), {
              status: 500,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
              }
            });
          }
        }

        // Handle malformed URLs (including those with spaces or http://http// pattern)
        if (request.url.includes('http://http//') || 
            request.url.includes('https://http//') ||
            request.url.includes(' ')) {
          
          console.log(`[REQUEST] Detected malformed URL pattern: ${request.url}`);
          
          // Clean the URL (handles spaces and malformed protocol patterns)
          let cleanedUrl = cleanMalformedUrl(request.url);
          console.log(`[REQUEST] Fetching resource from cleaned URL: ${cleanedUrl}`);
          return fetch(cleanedUrl);
        }

        // Handle protocol-relative URLs
        if (url.pathname.startsWith('//')) {
          console.log(`[REQUEST] Detected protocol-relative URL in path: ${url.pathname}`);
          
          // Get the referrer to determine if this was from a proxy
          const referer = request.headers.get('referer') || '';
          console.log(`[REQUEST] Referrer for protocol-relative URL: ${referer}`);
          
          let resourceUrl;
          if (referer.includes('/proxy/')) {
            console.log(`[REQUEST] Protocol-relative URL is from a proxied page`);
            
            // Extract the original proxied domain
            try {
              const proxyUrlMatch = referer.match(/\/proxy\/(https?:\/\/[^\/]+)/);
              if (proxyUrlMatch && proxyUrlMatch[1]) {
                const proxiedDomain = proxyUrlMatch[1];
                console.log(`[REQUEST] Extracted proxied domain: ${proxiedDomain}`);
                
                // Use the proxied domain as the base for the resource
                resourceUrl = `${new URL(proxiedDomain).protocol}${url.pathname}`;
              } else {
                // No domain match, use a default
                resourceUrl = `https:${url.pathname}`;
              }
            } catch (error) {
              console.error(`[REQUEST] Error parsing protocol-relative URL: ${error}`);
              resourceUrl = `https:${url.pathname}`;
            }
          } else {
            // Not from a proxy, just add https protocol
            resourceUrl = `https:${url.pathname}`;
          }
          
          console.log(`[REQUEST] Fetching resource from: ${resourceUrl}`);
          return fetch(resourceUrl);
        }

        // Determine if worker is operating as a proxy or as a route handler
        // Handle proxy requests directly if URL starts with /proxy/
        if (url.pathname.startsWith('/proxy/')) {
          console.log(`[ROUTING] Detected direct proxy request: ${url.pathname}`);
          console.log(`[FIXED-WORKER] Request URL: ${request.url}`);
          console.log(`[FIXED-WORKER] Host header: ${request.headers.get('host')}`);
          console.log(`[FIXED-WORKER] Detected proxy request: ${url.pathname}`);
          
          // Use the optimized proxy handler which handles spaces and malformed URLs
          try {
            // Import the proxy handler module that handles sanitized URLs
            const { handleProxyRequest } = require('./proxy-handler');
            return handleProxyRequest(request, env, ctx);
          } catch (proxyError) {
            console.error(`[ROUTING] Error using proxy handler: ${proxyError}`);
            
            // Fall back to traditional approach on error
            
            // Extract the target URL - everything after /proxy/
            const targetPath = url.pathname.slice(7); // Remove /proxy/
            
            // Check for nested /proxy/ patterns which indicate malformed URLs
            if (targetPath.includes('/proxy/')) {
              console.log(`[ROUTING] Detected nested proxy in URL: ${targetPath}`);
              
              // Extract the real target after the second /proxy/
              const nestedProxyIndex = targetPath.indexOf('/proxy/');
              if (nestedProxyIndex >= 0) {
                const realTargetUrl = targetPath.substring(nestedProxyIndex + 7);
                console.log(`[ROUTING] Extracted nested target URL: ${realTargetUrl}`);
                
                // Use the host extracted from headers, which is more reliable
                const proxyHost = request.headers.get('host') || 'localhost:8787';
                console.log(`[ROUTING] Using host from headers: ${proxyHost}`);
                
                // Use a completely different approach - create an absolute URL
                const redirectUrl = new URL(`/proxy/${realTargetUrl}`, `http://${proxyHost}`);
                const finalRedirectUrl = redirectUrl.toString();
                console.log(`[CRITICAL-FIX] Final redirect URL: ${finalRedirectUrl}`);
                
                return Response.redirect(finalRedirectUrl, 302);
              }
            }
            
            // Clean and sanitize the target path
            let sanitizedPath = targetPath.replace(/\s+/g, '%20');
            
            // Make sure we have a valid URL with protocol
            let targetUrl;
            if (sanitizedPath.startsWith('http://') || sanitizedPath.startsWith('https://')) {
              // URL already has protocol - do NOT modify or clean to avoid double prefixing
              targetUrl = sanitizedPath;
              console.log(`[ROUTING-DEBUG] Using target with existing protocol: ${targetUrl}`);
            } else if (sanitizedPath.startsWith('//')) {
              // Protocol-relative URL
              targetUrl = 'https:' + sanitizedPath;
              console.log(`[ROUTING-DEBUG] Using target with protocol-relative URL: ${targetUrl}`);
            } else {
              // No protocol, assume https
              targetUrl = 'https://' + sanitizedPath;
              console.log(`[ROUTING-DEBUG] Using target with added protocol: ${targetUrl}`);
            }
            
            // Include query parameters from original request
            if (url.search) {
              targetUrl += url.search;
              console.log(`[ROUTING-DEBUG] Added query params: ${url.search}`);
            }
            
            // Final validation through URL constructor
            try {
              const validUrl = new URL(targetUrl);
              targetUrl = validUrl.toString();
            } catch (e) {
              console.error(`[ROUTING] Error validating target URL: ${e.message}`);
              // Continue with best effort
            }
            
            console.log(`[ROUTING] Proxying to target URL: ${targetUrl}`);
            // Save host information for handleProxyRequest
            request.hscHost = request.headers.get('host') || 'localhost:8787';
            console.log(`[CRITICAL-FIX] Saving host before proxy: ${request.hscHost}`);
            return handleProxyRequest(targetUrl, env, ctx, request);
          }
        } 
        
        // Standard getTargetUrl logic for other cases
        const targetUrl = getTargetUrl(request);
        if (targetUrl) {
          // PROXY MODE: Worker is being used explicitly as a proxy
          // Save host information for handleProxyRequest
          request.hscHost = request.headers.get('host') || 'localhost:8787';
          console.log(`[CRITICAL-FIX] Saving host before proxy: ${request.hscHost}`);
          return handleProxyRequest(targetUrl, env, ctx, request);
        } else {
          // ROUTE HANDLER MODE: Worker is intercepting requests via Cloudflare Routes
          if (isHtmlRequest(request)) {
            try {
              // In a Cloudflare route, 'request' is already the original page request
              // Use HTML cache integration to fetch from origin with intelligent caching
              console.log(`[HANDLER] Fetching origin content with HTML cache for: ${request.url}`);
              
              try {
                // Use the fetchOriginWithCache function from our integration module
                // This will handle conditional requests, caching, and cache-hit responses
                const response = await htmlCacheIntegration.fetchOriginWithCache(
                  request, 
                  request.url, 
                  env, 
                  ctx
                );
                
                // Check if the response includes cache headers (to log the cache status)
                const cacheStatus = response.headers.get('X-HTML-Cache');
                if (cacheStatus) {
                  console.log(`[HANDLER] HTML cache status: ${cacheStatus}`);
                  if (cacheStatus.includes('HIT')) {
                    console.log(`[HANDLER] HTML content loaded from cache: ${cacheStatus}`);
                  }
                }
                
                // Only process HTML responses
                const contentType = response.headers.get('content-type') || '';
                if (!contentType.includes('text/html')) {
                  return response;
                }
                
                // Check if we have cached segments for this URL
                const cacheKey = `url:${url.pathname}`;
                let segments = await getCachedSegments(cacheKey, env);
                
                if (!segments) {
                  // No cached segments, need to fetch the content and call Scope3
                  const html = await response.clone().text();
                  const pageData = extractPageContent(html, request.url);
                  
                  // Get segments from Scope3 API with timeout
                  segments = await getScope3SegmentsWithTimeout(pageData, env, ctx, true); // Force API call
                  console.log(`[HANDLER] Received segments: ${JSON.stringify(segments)}`);
                  
                  // Cache the segments if we got a valid response
                  if (segments && segments.length > 0) {
                    // Extract publication date from the page data if available
                    const publishDate = pageData.url_published;
                    await cacheSegments(cacheKey, segments, env, publishDate);
                    console.log(`[HANDLER] Cached segments for URL: ${request.url}`);
                  } else {
                    // If we didn't get segments, use an empty array
                    console.log(`[HANDLER] No segments received, using empty array`);
                    segments = [];
                  }
                }
                
                // Inject segments into the page
                return injectSegmentsIntoPage(response, segments);
              } catch (cacheError) {
                console.error(`[HANDLER] Error using HTML cache: ${cacheError}`);
                
                // Fallback to direct fetch if cache fails
                console.log(`[HANDLER] Falling back to direct origin fetch`);
                
                // Create a new simple request with minimal headers to avoid size issues
                const originRequest = new Request(request.url, {
                  method: 'GET',
                  headers: filterHeaders(request.headers),
                  redirect: 'follow'
                });
                
                // Fetch directly from the origin server
                const response = await fetch(originRequest);
                
                // Only process HTML responses
                const contentType = response.headers.get('content-type') || '';
                if (!contentType.includes('text/html')) {
                  return response;
                }
                
                // Check if we have cached segments for this URL
                const cacheKey = `url:${url.pathname}`;
                let segments = await getCachedSegments(cacheKey, env);
                
                if (!segments) {
                  // No cached segments, need to fetch the content and call Scope3
                  const html = await response.clone().text();
                  const pageData = extractPageContent(html, request.url);
                  
                  // Get segments from Scope3 API with timeout
                  segments = await getScope3SegmentsWithTimeout(pageData, env, ctx, true); // Force API call
                  console.log(`[HANDLER] Received segments: ${JSON.stringify(segments)}`);
                  
                  // Cache the segments if we got a valid response
                  if (segments && segments.length > 0) {
                    // Extract publication date from the page data if available
                    const publishDate = pageData.url_published;
                    await cacheSegments(cacheKey, segments, env, publishDate);
                    console.log(`[HANDLER] Cached segments for URL: ${request.url}`);
                  } else {
                    // If we didn't get segments, use an empty array
                    console.log(`[HANDLER] No segments received, using empty array`);
                    segments = [];
                  }
                }
                
                // Inject segments into the page
                return injectSegmentsIntoPage(response, segments);
              }
            } catch (error) {
              console.error('Error processing request:', error);

              // Return the original response if there's an error
              return fetch(request);
            }
          }
        }

        // Pass through all other requests
        return fetch(request);

      } catch (error) {
        console.error(`[ERROR] URL parsing error: ${error.message}`);
        return new Response(`Error: ${error.message}`, { status: 400 });
      }
    } catch (error) {
      console.error(`[ERROR] Unhandled error in main fetch handler: ${error.message}`);
      // Return a generic error page that won't break the client
      return new Response(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Error</title>
          <style>
            body { font-family: sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
            .error { background: #f8d7da; border: 1px solid #f5c6cb; padding: 15px; border-radius: 4px; }
            h1 { color: #721c24; }
            a { color: #0078d7; text-decoration: none; }
            a:hover { text-decoration: underline; }
          </style>
        </head>
        <body>
          <div class="error">
            <h1>Something went wrong</h1>
            <p>We encountered an error processing your request.</p>
            <p><a href="/test">Go to the test page</a></p>
          </div>
        </body>
        </html>
      `, {
        status: 500,
        headers: { 'Content-Type': 'text/html;charset=UTF-8' }
      });
    }
  }
};

/**
 * Handle explicit proxy requests (when a target URL is provided)
 */
async function handleProxyRequest(targetUrl, env, ctx, originalRequest = null) {
  // Get the host from the original request if available
  const safeHost = originalRequest?.hscHost || 
                  originalRequest?.headers?.get('host') || 
                  'localhost:8787';
  console.log(`[PROXY-HOST-DEBUG] Using safe host for proxying: ${safeHost}`);
  console.log(`[PROXY] Handling proxy request for target: ${targetUrl}`);
  console.log(`[PROXY-DEBUG] Target URL validation: ${new URL(targetUrl).toString()}`);

  try {
    // Create a new request with minimal headers but accepting all content types
    const proxyRequest = new Request(targetUrl, {
      method: 'GET',
      headers: {
        'Accept': '*/*',  // Accept all content types
        'User-Agent': 'Scope3-Segments-Worker'
      }
    });

    console.log(`[PROXY] Fetching content from target URL: ${targetUrl}`);

    // Use the HTML cache for fetching if it's available
    let response;
    let html;
    let cacheStatus = 'BYPASS';

    // Only use HTML cache for HTML content
    if (isLikelyHtmlUrl(targetUrl)) {
      try {
        // Use the HTML cache to fetch content with intelligent caching
        const fetchResult = await htmlCacheIntegration.fetchHtmlWithIntelligentCache(
          targetUrl, 
          proxyRequest, 
          env, 
          ctx
        );
        
        response = fetchResult.response;
        html = fetchResult.html;
        cacheStatus = fetchResult.cacheStatus || 'UNKNOWN';
        
        console.log(`[PROXY] HTML content fetched with cache status: ${cacheStatus}`);
      } catch (cacheError) {
        console.error(`[PROXY] Error using HTML cache, falling back to direct fetch: ${cacheError}`);
        // Fall back to direct fetch if HTML cache fails
        response = await fetch(proxyRequest);
      }
    } else {
      // Non-HTML content goes through direct fetch
      response = await fetch(proxyRequest);
    }

    console.log(`[PROXY] Response status: ${response.status}, Content-Type: ${response.headers.get('content-type') || 'unknown'}`);

    // Only process HTML responses, pass through all other content types
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      console.log(`[PROXY] Non-HTML content type: ${contentType}, passing through unmodified`);

      // For non-HTML responses, add CORS headers but otherwise pass them through
      const headers = new Headers(response.headers);
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Content-Type');

      // Create a new response with the same body but modified headers
      return new Response(response.body, {
        headers: headers,
        status: response.status,
        statusText: response.statusText
      });
    }

    // For HTML responses, extract content, get segments, and inject them
    console.log(`[PROXY] Preparing to inject segments with original URL: ${targetUrl}`);

    // Get the HTML content
    html = html || await response.text();

    // Add metadata to track the original URL in the response
    const originalUrl = targetUrl;
    console.log(`[PROXY] Original URL for proxied request: ${originalUrl}`);

    // Check the cache for segments
    const cacheKey = `url:${targetUrl}`;
    let segments = await getCachedSegments(cacheKey, env);

    if (!segments) {
      // Extract content from the HTML
      const pageData = extractPageContent(html, targetUrl);

      // Get segments from Scope3 API with timeout
      segments = await getScope3SegmentsWithTimeout(pageData, env, ctx);
      console.log(`[PROXY] Received segments: ${JSON.stringify(segments)}`);

      // Cache the segments if we got a valid response
      if (segments && segments.length > 0) {
        await cacheSegments(cacheKey, segments, env);
        console.log(`[PROXY] Cached segments for target URL: ${targetUrl}`);
      }
    } else {
      console.log(`[PROXY] Using cached segments for target URL: ${targetUrl}`);
    }

    // Create a new Response with the HTML content
    const htmlResponse = new Response(html, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText
    });

    // Inject the segments into the HTML, passing the original URL for relative URL resolution
    return injectSegmentsIntoPage(htmlResponse, segments, targetUrl);
  } catch (error) {
    console.error(`[PROXY] Error handling proxy request: ${error}`);
    
    // Return a helpful error page for the user
    return new Response(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Proxy Error</title>
        <style>
          body { font-family: sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
          .error { background: #f8d7da; border: 1px solid #f5c6cb; padding: 15px; border-radius: 4px; }
          h1 { color: #721c24; }
          pre { background: #f5f5f5; padding: 10px; border-radius: 4px; overflow-x: auto; }
          .url { font-family: monospace; word-break: break-all; }
          a { color: #0078d7; text-decoration: none; }
          a:hover { text-decoration: underline; }
        </style>
      </head>
      <body>
        <div class="error">
          <h1>Error Proxying Content</h1>
          <p>We encountered an error while trying to proxy the following URL:</p>
          <p class="url">${targetUrl}</p>
          <p><strong>Error:</strong> ${error.message}</p>
          <pre>${error.stack || 'No stack trace available'}</pre>
          <p><a href="/test">&laquo; Back to Test Page</a></p>
        </div>
      </body>
      </html>
    `, {
      status: 500,
      headers: { 'Content-Type': 'text/html;charset=UTF-8' }
    });
  }
}

/**
 * Handle API requests to fetch segments
 */
async function handleApiRequest(request, env, ctx) {
  console.log(`[API] Handling API request: ${request.url}`);
  
  // Parse the request URL for query parameters
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get('url');
  
  if (!targetUrl) {
    console.log(`[API] Missing URL parameter in API request`);
    
    // Return a simple error
    return new Response(JSON.stringify({
      error: 'Missing URL parameter',
      example: `${url.origin}/api/segments?url=https://example.com`
    }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
  
  try {
    // Normalize the target URL and make sure it's valid
    let normalizedUrl;
    try {
      // Handle different URL formats
      if (targetUrl.startsWith('http://') || targetUrl.startsWith('https://')) {
        normalizedUrl = targetUrl;
      } else if (targetUrl.startsWith('//')) {
        normalizedUrl = `https:${targetUrl}`;
      } else {
        normalizedUrl = `https://${targetUrl}`;
      }
      
      // Validate URL by constructing a URL object
      new URL(normalizedUrl);
      
      console.log(`[API] Normalized target URL: ${normalizedUrl}`);
    } catch (urlError) {
      console.error(`[API] Invalid URL parameter: ${targetUrl}, error: ${urlError}`);
      
      return new Response(JSON.stringify({
        error: 'Invalid URL parameter',
        details: urlError.message
      }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    // Check cache first
    const cacheKey = `url:${normalizedUrl}`;
    const cachedSegments = await getCachedSegments(cacheKey, env);
    
    if (cachedSegments) {
      console.log(`[API] Using cached segments for ${normalizedUrl}`);
      
      // Return the cached segments
      return new Response(JSON.stringify({
        url: normalizedUrl,
        segments: cachedSegments,
        source: 'cache',
        timestamp: new Date().toISOString()
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'max-age=60' // Allow browsers to cache for 1 minute
        }
      });
    }
    
    // Fetch the content first to extract meaningful content
    const fetchResponse = await fetch(normalizedUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Scope3-Segments-Worker',
        'Accept': 'text/html,application/xhtml+xml'
      }
    });
    
    if (!fetchResponse.ok) {
      console.error(`[API] Error fetching target URL: ${normalizedUrl}, status: ${fetchResponse.status}`);
      
      // Return an error response
      return new Response(JSON.stringify({
        error: 'Error fetching target URL',
        status: fetchResponse.status,
        url: normalizedUrl
      }), {
        status: 502, // Bad Gateway
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    // Check if it's HTML content
    const contentType = fetchResponse.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      console.log(`[API] Target URL is not HTML content: ${contentType}`);
      
      // Return a helpful error
      return new Response(JSON.stringify({
        error: 'Target URL is not HTML content',
        contentType: contentType,
        url: normalizedUrl
      }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    // Get the HTML content
    const html = await fetchResponse.text();
    
    // Extract content from the HTML
    const pageData = extractPageContent(html, normalizedUrl);
    
    // Get segments from Scope3 API with timeout and forced API call
    const segments = await getScope3SegmentsWithTimeout(pageData, env, ctx, true);
    console.log(`[API] Received segments for ${normalizedUrl}: ${JSON.stringify(segments)}`);
    
    // Cache the segments
    if (segments && segments.length > 0) {
      await cacheSegments(cacheKey, segments, env);
      console.log(`[API] Cached segments for target URL: ${normalizedUrl}`);
    }
    
    // Return the segments as JSON
    return new Response(JSON.stringify({
      url: normalizedUrl,
      segments: segments,
      source: 'api',
      timestamp: new Date().toISOString()
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'max-age=60' // Allow browsers to cache for 1 minute
      }
    });
  } catch (error) {
    console.error(`[API] Error in API handler: ${error}`);
    
    // Return a generic error response
    return new Response(JSON.stringify({
      error: 'Error processing request',
      details: error.message,
      url: targetUrl
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}