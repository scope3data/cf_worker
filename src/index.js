/**
 * Scope3 Publisher API Cloudflare Worker
 * 
 * This worker intercepts HTML page requests, fetches segments from the Scope3 API,
 * and injects them directly into the page before returning it to the browser.
 */

// Configuration
const SCOPE3_API_ENDPOINT = 'https://rtdp.scope3.com/publishers/qa';
const CACHE_TTL = 60 * 60; // Cache for 1 hour (in seconds)
const API_TIMEOUT = 1000; // Timeout after 1000ms (1 second) to allow API to respond

// For testing - Set to your API key to test with the real API (remove in production)
const TEST_API_KEY = '';

/**
 * Main worker fetch handler
 */
export default {
  async fetch(request, env, ctx) {
    try {
      // For debugging: Log environment variables
      console.log('[ENV] Available environment variables:', Object.keys(env));
      console.log('[ENV] API_TIMEOUT available:', !!env.API_TIMEOUT);
      console.log('[ENV] SCOPE3_API_KEY available:', !!env.SCOPE3_API_KEY);
      
      // EXTREMELY HIGH PRIORITY: Check URL before any parsing
      // Direct string matching for /proxy/ to avoid any URL parsing issues
      const urlString = request.url;
      console.log(`[DEBUG-URL] Raw URL: ${urlString}`);
      
      if (urlString.includes('/proxy/')) {
        console.log(`[PROXY-CRITICAL] Detected proxy pattern in raw URL: ${urlString}`);
        
        // Find the position of /proxy/
        const proxyIndex = urlString.indexOf('/proxy/');
        if (proxyIndex >= 0) {
          // Extract everything after /proxy/
          const targetUrlPart = urlString.substring(proxyIndex + 7); // Skip /proxy/
          
          // Ensure it has a protocol
          let finalTargetUrl;
          if (targetUrlPart.startsWith('http://') || targetUrlPart.startsWith('https://')) {
            finalTargetUrl = targetUrlPart;
          } else if (targetUrlPart.startsWith('//')) {
            finalTargetUrl = 'https:' + targetUrlPart;
          } else {
            finalTargetUrl = 'https://' + targetUrlPart;
          }
          
          console.log(`[PROXY-CRITICAL] Extracted target URL: ${finalTargetUrl}`);
          
          // Instead of immediately returning the response, go through the handleProxyRequest
          // function to ensure Scope3 API is called
          return await handleProxyRequest(finalTargetUrl, env, ctx);
        }
      }
      
      let url;
      try {
        url = new URL(request.url);

        // CRITICAL: Handle proxy URLs at the very start to bypass other handlers
        if (url.pathname.startsWith('/proxy/')) {
          console.log(`[PROXY-DIRECT] Handling direct proxy request: ${url.pathname}`);
          
          // Get everything after /proxy/
          const targetPath = url.pathname.substring(7); // Skip "/proxy/" prefix
          
          // Make sure URL has protocol
          let targetUrl;
          if (targetPath.startsWith('http://') || targetPath.startsWith('https://')) {
            targetUrl = targetPath; // Already has protocol
          } else if (targetPath.startsWith('//')) {
            targetUrl = 'https:' + targetPath; // Protocol-relative URL
          } else {
            targetUrl = 'https://' + targetPath; // Add https protocol
          }
          
          // Include any query parameters from original request
          targetUrl += url.search || '';
          
          console.log(`[PROXY-DIRECT] Proxying to: ${targetUrl}`);
          
          // Create a request to the target URL
          const proxyRequest = new Request(targetUrl, {
            method: 'GET',
            headers: {
              'Accept': '*/*',
              'User-Agent': 'Scope3-Segments-Worker'
            }
          });
          
          try {
            const response = await fetch(proxyRequest);
            
            // Copy headers but add CORS headers
            const headers = new Headers(response.headers);
            headers.set('Access-Control-Allow-Origin', '*');
            headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
            headers.set('Access-Control-Allow-Headers', 'Content-Type');
            
            // Return the proxied response
            return new Response(response.body, {
              headers: headers,
              status: response.status,
              statusText: response.statusText
            });
          } catch (error) {
            console.error(`[PROXY-DIRECT] Error fetching resource: ${error.message}`);
            return new Response(`Error fetching resource: ${error.message}`, { status: 500 });
          }
        }
        
        // Handle protocol-relative URLs in the request path
        if (url.pathname === '//' || url.pathname.startsWith('//')) {
          console.log(`[REQUEST] Detected protocol-relative URL in path: ${url.pathname}`);
          
          // Special case for resources loaded from proxied pages
          // Check referrer to see if this is a resource from a proxied page
          const referrer = request.headers.get('Referer') || '';
          console.log(`[REQUEST] Referrer for protocol-relative URL: ${referrer}`);
          
          if (referrer && referrer.includes('/proxy/')) {
            console.log(`[REQUEST] Protocol-relative URL is from a proxied page`);
            
            try {
              // Extract the domain from the referrer
              const referrerUrl = new URL(referrer);
              const proxyMatch = referrerUrl.pathname.match(/\/proxy\/(.*)/);
              
              if (proxyMatch) {
                // Extract domain from the proxied URL - get everything after /proxy/
                const proxiedDomain = proxyMatch[1];
                console.log(`[REQUEST] Extracted proxied domain: ${proxiedDomain}`);
                
                // Build correct URL for this resource
                const pathWithoutLeadingSlashes = url.pathname.replace(/^\/+/, '');
                let targetDomain;
                
                // Handle different formats of the proxied domain
                if (proxiedDomain.startsWith('http')) {
                  // If full URL was specified in the proxy path
                  try {
                    // Extract the full domain from proxied URL
                    const originalUrl = new URL(proxiedDomain);
                    
                    // Clean up common patterns like https://https:// which can happen with naive URL extraction
                    if (originalUrl.hostname === 'https:' || originalUrl.hostname === 'http:') {
                      // We have a malformed URL like https://https://example.com
                      console.log(`[REQUEST] Detected malformed nested URL in: ${proxiedDomain}`);
                      
                      // Extract the real URL after the protocol part
                      const cleanedUrl = proxiedDomain.replace(/^https?:\/\/(https?:\/\/|https?:)/, '$1');
                      console.log(`[REQUEST] Cleaned URL: ${cleanedUrl}`);
                      
                      // If it starts with https: without //, add the slashes
                      if (cleanedUrl.match(/^https?:/)) {
                        targetDomain = cleanedUrl.replace(/^(https?:)(?!\/\/)/, '$1//');
                      } else {
                        targetDomain = 'https://' + cleanedUrl;
                      }
                    } else {
                      // Normal URL
                      targetDomain = originalUrl.protocol + '//' + originalUrl.host;
                    }
                  } catch (e) {
                    console.error(`[REQUEST] Error parsing proxied domain: ${e.message}`);
                    targetDomain = 'https://' + proxiedDomain;
                  }
                } else {
                  targetDomain = 'https://' + proxiedDomain;
                }
                
                const resourceUrl = `${targetDomain}/${pathWithoutLeadingSlashes}${url.search || ''}`;
                console.log(`[REQUEST] Fetching resource from: ${resourceUrl}`);
                
                // Fetch the resource directly
                const resourceResponse = await fetch(new Request(resourceUrl, {
                  headers: {
                    'Accept': '*/*',
                    'User-Agent': 'Scope3-Segments-Worker'
                  }
                }));
                
                // Return with CORS headers
                const headers = new Headers(resourceResponse.headers);
                headers.set('Access-Control-Allow-Origin', '*');
                headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
                headers.set('Access-Control-Allow-Headers', 'Content-Type');
                
                return new Response(resourceResponse.body, {
                  headers,
                  status: resourceResponse.status,
                  statusText: resourceResponse.statusText
                });
              }
            } catch (error) {
              console.error(`[REQUEST] Error handling protocol-relative resource: ${error.message}`);
            }
          }
          
          // Regular protocol-relative URL handling (existing code)
          // Extract hostname and path from pathname
          const pathWithoutLeadingSlashes = url.pathname.replace(/^\/+/, '');

          // Return test page for direct protocol-relative URL in root path
          if (pathWithoutLeadingSlashes === '') {
            console.log(`[REQUEST] Empty protocol-relative URL, returning test page directly`);
            return createTestPage();
          }

          // Special handling for common test endpoints
          if (pathWithoutLeadingSlashes === 'test') {
            console.log(`[REQUEST] Protocol-relative test URL, returning test page directly`);
            return createTestPage();
          }

          // Special handling for test-content paths
          if (pathWithoutLeadingSlashes.startsWith('test-content/')) {
            console.log(`[REQUEST] Protocol-relative test content URL: ${pathWithoutLeadingSlashes}`);
            const contentType = pathWithoutLeadingSlashes.split('/').pop();
            const response = createContentTestPage(contentType);
            return response;
          }

          // Special handling for API test endpoint
          if (pathWithoutLeadingSlashes === 'api-test') {
            console.log(`[REQUEST] Protocol-relative API test URL`);
            // Extract query parameters from the original URL
            const testUrl = url.searchParams.get('url') || 'https://example.com';

            // Call the API test endpoint directly
            return handleApiTestRequest(testUrl, env);
          }

          // Special case: Don't redirect API or debug endpoints
          if (pathWithoutLeadingSlashes.startsWith('api/') ||
              pathWithoutLeadingSlashes.startsWith('debug-')) {
            console.log(`[REQUEST] Not redirecting API or debug endpoint: ${pathWithoutLeadingSlashes}`);
            // Continue processing without redirection
            return null;
          }

          // If pathname starts with //, treat it as protocol-relative and convert
          const newUrl = `https://${pathWithoutLeadingSlashes}${url.search || ''}`;
          console.log(`[REQUEST] Redirecting protocol-relative URL to: ${newUrl}`);
          return Response.redirect(newUrl, 302);
        }
      } catch (urlError) {
        console.error(`[REQUEST] Error parsing URL: ${urlError.message}`);
        // If URL is invalid, just show the test page directly
        console.log(`[REQUEST] Error parsing URL, displaying test page directly`);
        return createTestPage();
      }

      // Define a cleaned path variable we can use throughout the handler
      const pathWithoutLeadingSlashes = url.pathname.replace(/^\/+/, '');

      // Log every request that comes in
      // Only log main requests, not resource requests
      if (url.pathname.startsWith('/proxy/') || url.pathname === '/test' || url.pathname === '/api/segments') {
        console.log(`[REQUEST] ${request.method} ${url.pathname}${url.search || ''}`);
      }

    // Handle CORS preflight requests - with enhanced CORS support
    if (request.method === 'OPTIONS') {
      console.log(`[CORS] Handling preflight request for ${url.pathname}`);
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, HEAD',
          'Access-Control-Allow-Headers': 'Content-Type, Accept, X-Requested-With, Origin',
          'Access-Control-Max-Age': '86400',
          'Access-Control-Allow-Credentials': 'true',
          'Vary': 'Origin'
        }
      });
    }

    // Skip resource handling for our specific endpoints
    if (url.pathname === '/api-test' ||
        url.pathname === '/test' ||
        url.pathname.startsWith('/test-content/') ||
        url.pathname === '/test-resource.json' ||
        url.pathname === '/api/segments' ||
        url.pathname.startsWith('/proxy/')) {
      // These have their own handlers below
      console.log(`[ROUTING] Handling specific endpoint: ${url.pathname}`);
      // Do nothing here - just skip the resource handling block
    }
    // Resources are everything else - for static content requests, forward them to the original site
    else {
      // Make sure URL is properly formatted
      const urlPath = url.pathname;
      console.log(`[RESOURCE] Handling resource: ${urlPath}`);

      // Get the referrer to determine the origin domain and protocol
      const referrer = request.headers.get('Referer') || '';
      let originDomain = '';
      // Extract protocol from referrer for protocol-relative URL handling
      let referrerProtocol = 'https:'; // Default to https

      if (referrer) {
        try {
          const referrerUrl = new URL(referrer);
          referrerProtocol = referrerUrl.protocol; // Includes the colon
          console.log(`[RESOURCE] Using referrer protocol: ${referrerProtocol} for protocol-relative URLs`);
        } catch (e) {
          console.error(`[RESOURCE] Error parsing referrer protocol: ${e}`);
        }
      }

      // Handle protocol-relative URLs (starting with //)
      // First, determine if this URL path is protocol-relative
      const fullUrl = request.url;
      const urlPathClean = urlPath.replace(/^\/+/, ''); // Remove leading slashes

      // More comprehensive detection of protocol-relative URLs
      // Check if the path itself is a domain-like string after removing leading slashes
      const isDomainLike = /^[a-zA-Z0-9][-a-zA-Z0-9.]*\.[a-zA-Z]{2,}(\/|$)/.test(urlPathClean);

      // Also check common patterns for CDNs and static resources
      const isCommonCDN = urlPathClean.startsWith('static.') ||
                          urlPathClean.startsWith('cdn.') ||
                          urlPathClean.startsWith('assets.') ||
                          urlPathClean.startsWith('media.') ||
                          urlPathClean.startsWith('img.') ||
                          urlPathClean.startsWith('s3.') ||
                          urlPathClean.startsWith('images.');

      // Check if URL looks like a protocol-relative URL
      const isProtocolRelative = isDomainLike || isCommonCDN ||
                                 fullUrl.includes('//static') ||
                                 fullUrl.includes('//cdn') ||
                                 fullUrl.includes('//assets') ||
                                 fullUrl.includes('//media') ||
                                 fullUrl.includes('//img') ||
                                 fullUrl.includes('//images') ||
                                 fullUrl.includes('//www.');

      // Only handle it as protocol-relative if it really looks like one
      if (isProtocolRelative) {
        console.log(`[RESOURCE] Detected protocol-relative URL: ${fullUrl}`);
        console.log(`[RESOURCE] Clean path: ${urlPathClean}, Domain-like: ${isDomainLike}, Common CDN: ${isCommonCDN}`);

        // We'll use the referrerProtocol that was already extracted above
        console.log(`[RESOURCE] Will use protocol '${referrerProtocol}' for protocol-relative URLs`);

        // Optionally, could construct the full URL here using referrerProtocol:
        // const fullResourceUrl = `${referrerProtocol}//${urlPathClean}`;
        // console.log(`[RESOURCE] Full protocol-relative URL would be: ${fullResourceUrl}`);

        // We'll pass this through to be handled by the base tag instead
        // The URL rewriting logic in injectSegmentsIntoPage will handle the conversion
      }

      // Variables referrer, originDomain, and referrerProtocol already defined above

      if (referrer) {
        try {
          const referrerUrl = new URL(referrer);
          referrerProtocol = referrerUrl.protocol; // Includes the colon
          console.log(`[RESOURCE] Using referrer protocol: ${referrerProtocol} for protocol-relative URLs`);
        } catch (e) {
          console.error(`[RESOURCE] Error parsing referrer protocol: ${e}`);
        }
      }

      try {
        if (referrer) {
          console.log(`[RESOURCE] Referrer: ${referrer}`);
          const referrerUrl = new URL(referrer);
          // Check if the referrer contains /proxy/ path
          // Match the entire URL after /proxy/, not just the domain part
          const proxyMatch = referrerUrl.pathname.match(/\/proxy\/(.+)$/);
          if (proxyMatch) {
            try {
              // Try to extract a full URL
              const encodedUrl = proxyMatch[1];
              const decodedUrl = decodeURIComponent(encodedUrl);
              const parsedUrl = new URL(decodedUrl);
              originDomain = `${parsedUrl.protocol}//${parsedUrl.host}`;
              console.log(`[RESOURCE] Extracted origin domain from referrer: ${originDomain}`);
            } catch (err) {
              console.error(`[RESOURCE] Error parsing URL from referrer: ${err.message}`);
            }
          }
        }
      } catch (e) {
        console.error('Error parsing referrer:', e);
      }

      if (originDomain) {
        // Construct the full URL to the resource on the original site
        const resourceUrl = `${originDomain}${url.pathname}${url.search || ''}`;
        console.log(`[RESOURCE] Fetching from original domain: ${resourceUrl}`);

        // Create a new request with minimal headers
        const resourceRequest = new Request(resourceUrl, {
          method: 'GET',
          headers: {
            'Accept': '*/*',
            'User-Agent': 'Scope3-Segments-Worker'
          }
        });

        try {
          const response = await fetch(resourceRequest);
          console.log(`[RESOURCE] Response status: ${response.status}, Content-Type: ${response.headers.get('content-type') || 'unknown'}`);

          // Copy headers but add CORS headers
          const headers = new Headers(response.headers);
          headers.set('Access-Control-Allow-Origin', '*');
          headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
          headers.set('Access-Control-Allow-Headers', 'Content-Type');

          // Log the content type being returned
          const contentType = response.headers.get('content-type');
          console.log(`[RESOURCE] Returning ${contentType} resource to client`);

          return new Response(response.body, {
            headers: headers,
            status: response.status,
            statusText: response.statusText
          });
        } catch (error) {
          console.error(`[RESOURCE] Error fetching resource: ${error.message}`);
          return new Response(`Error fetching resource: ${error.message}`, { status: 500 });
        }
      } else {
        console.log(`[RESOURCE] No origin domain found in referrer, cannot fetch resource`);
      }
    } // End of resource handling

    // For testing, return a simple HTML page at /test or if the URL is in localhost
    if (url.pathname === '/test' ||
        url.pathname === '/' && (url.hostname === 'localhost' || url.hostname.includes('127.0.0.1'))) {
      console.log(`[TEST] Displaying test page for path: ${url.pathname}`);
      return createTestPage();
    }

    // Special debug page for troubleshooting URL/API issues
    if (url.pathname === '/debug') {
      console.log(`[DEBUG] Redirecting to the test page`);

      // Redirect to the test page
      return Response.redirect(`${url.protocol}//${url.host}/test`, 302);
    }

    // Direct handler for example.com segments, bypassing the normal handler
    if (url.pathname === '/api/example') {
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

    // Debug endpoint to show request details
    if (url.pathname === '/debug-request') {
      console.log('[DEBUG] Request debugging endpoint accessed');

      // Extract important details from the request
      const debugInfo = {
        url: request.url,
        method: request.method,
        headers: Object.fromEntries([...request.headers]),
        pathname: url.pathname,
        origin: url.origin,
        protocol: url.protocol,
        host: url.host,
        search: url.search,
        pathWithoutLeadingSlashes: pathWithoutLeadingSlashes,
        timestamp: new Date().toISOString()
      };

      // Return the debug info as JSON
      return new Response(JSON.stringify(debugInfo, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache, no-store'
        }
      });
    }

    // Special endpoint for test page resource loading (guaranteed to work)
    if (url.pathname === '/page-test-resource.json') {
      console.log('[TEST-RESOURCE] Serving dedicated test resource for test page');
      return new Response(JSON.stringify({
        status: 'success',
        message: 'This resource was loaded from the test page',
        timestamp: new Date().toISOString(),
        source: 'page-test-resource.json endpoint'
      }, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, HEAD',
          'Access-Control-Allow-Headers': '*',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      });
    }

    // Test different content types for segment generation
    if (url.pathname.startsWith('/test-content/')) {
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

    // Ultra simple direct API call for testing - no proxying or resources involved
    if (url.pathname === '/api-test') {
      console.log('[API-TEST] Starting direct API test');

      // Get the URL from query parameter
      const targetUrl = url.searchParams.get('url') || 'https://example.com';
      return handleApiTestRequest(targetUrl, env);
    }


    // Handle test resource JSON (with detailed logging)
    console.log(`[RESOURCE-DEBUG] Checking test resource path: '${url.pathname}', cleaned path: '${pathWithoutLeadingSlashes}'`);
    console.log(`[RESOURCE-DEBUG] URL query params: '${url.search}'`);

    if (url.pathname === '/test-resource.json' ||
        url.pathname.includes('/test-resource.json') ||
        pathWithoutLeadingSlashes === 'test-resource.json') {
      console.log(`[RESOURCE] Serving test resource JSON at path: ${url.pathname}`);

      // Create test resource response
      const testData = {
        status: 'success',
        message: 'This is a test resource',
        path: url.pathname,
        query: url.search,
        timestamp: new Date().toISOString()
      };

      console.log(`[RESOURCE] Returning test data: ${JSON.stringify(testData)}`);

      return new Response(JSON.stringify(testData), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, HEAD',
          'Access-Control-Allow-Headers': 'Content-Type, Accept, X-Requested-With, Origin',
          'Access-Control-Max-Age': '86400',
          'Access-Control-Allow-Credentials': 'true',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
          'Vary': 'Origin'
        }
      });
    }

    // Handle API endpoint to fetch segments for a specific URL
    // Handle different variations of the path to account for protocol-relative issues
    if (url.pathname === '/api/segments' ||
        url.pathname.includes('/api/segments') ||
        pathWithoutLeadingSlashes === 'api/segments') {
      console.log(`[ROUTING] Detected API segments request at path: ${url.pathname}`);

      // Create a hardcoded response for testing while debugging
      if (url.search && url.search.includes('url=example')) {
        console.log(`[ROUTING] Using direct hardcoded response for example`);
        return new Response(JSON.stringify({
          url: "https://example.com",
          segments: ["test_segment", "hardcoded_response", "direct_route"],
          source: "direct route handler",
          timestamp: new Date().toISOString()
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }

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

    // Determine if worker is operating as a proxy or as a route handler
    // Handle proxy requests directly if URL starts with /proxy/
    if (url.pathname.startsWith('/proxy/')) {
      console.log(`[ROUTING] Detected direct proxy request: ${url.pathname}`);
      
      // Extract the target URL - everything after /proxy/
      const targetPath = url.pathname.slice(7); // Remove /proxy/
      
      // Make sure we have a valid URL with protocol
      let targetUrl;
      if (targetPath.startsWith('http://') || targetPath.startsWith('https://')) {
        // URL already has protocol
        targetUrl = targetPath;
      } else if (targetPath.startsWith('//')) {
        // Protocol-relative URL
        targetUrl = 'https:' + targetPath;
      } else {
        // No protocol, assume https
        targetUrl = 'https://' + targetPath;
      }
      
      // Include query parameters from original request
      if (url.search) {
        targetUrl += url.search;
      }
      
      console.log(`[ROUTING] Proxying to target URL: ${targetUrl}`);
      return handleProxyRequest(targetUrl, env, ctx);
    } 
    
    // Standard getTargetUrl logic for other cases
    const targetUrl = getTargetUrl(request);
    if (targetUrl) {
      // PROXY MODE: Worker is being used explicitly as a proxy
      return handleProxyRequest(targetUrl, env, ctx);
    } else {
      // ROUTE HANDLER MODE: Worker is intercepting requests via Cloudflare Routes
      if (isHtmlRequest(request)) {
        try {
          // For simplicity in development, just create a test response
          if (url.hostname === 'localhost' || url.hostname.includes('127.0.0.1')) {
            const testHtml = `
              <!DOCTYPE html>
              <html>
              <head>
                <title>Test Page</title>
                <meta name="description" content="This is a test page">
              </head>
              <body>
                <h1>Test Page</h1>
                <p>This is a test page for the Scope3 segments worker.</p>
              </body>
              </html>
            `;

            const response = new Response(testHtml, {
              headers: { 'content-type': 'text/html;charset=UTF-8' }
            });

            // Get segments for this test page
            const pageData = extractPageContent(testHtml, request.url);
            const segments = await getScope3SegmentsWithTimeout(pageData, env, ctx);

            return injectSegmentsIntoPage(response, segments);
          }

          // In a Cloudflare route, 'request' is already the original page request
          // The worker needs to fetch the original content from the origin server

          // Create a new simple request with minimal headers to avoid size issues
          const originRequest = new Request(request.url, {
            method: 'GET',
            headers: filterHeaders(request.headers),
            redirect: 'follow'
          });

          // Fetch from the origin server (bypassing this worker)
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
              const publishDate = pageData.url_last_updated;
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
 * Filter headers to avoid triggering this worker when fetching from origin
 * Uses a minimal set of headers to avoid the "Headers Too Large" error
 */
function filterHeaders(headers) {
  const filtered = new Headers();

  // Only copy essential headers to avoid header size limits
  const essentialHeaders = [
    'accept',
    'accept-language',
    'user-agent',
    'referer'
  ];

  for (const header of essentialHeaders) {
    if (headers.has(header)) {
      filtered.append(header, headers.get(header));
    }
  }

  // Add a header to indicate this request is from the worker
  filtered.append('X-Forwarded-By', 'scope3-segments-worker');

  return filtered;
}

/**
 * Handle explicit proxy requests (when a target URL is provided)
 */
async function handleProxyRequest(targetUrl, env, ctx) {
  console.log(`[PROXY] Handling proxy request for target: ${targetUrl}`);

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

    // Fetch the target URL content
    const response = await fetch(proxyRequest);

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

      // Log the headers we're sending back
      console.log('[PROXY] Response headers:');
      for (const [key, value] of headers.entries()) {
        console.log(`  ${key}: ${value}`);
      }

      // Create a new response with the same body but modified headers
      return new Response(response.body, {
        headers: headers,
        status: response.status,
        statusText: response.statusText
      });
    }

    // Check if we have cached segments for this URL
    const cacheKey = `url:${targetUrl}`;
    let segments = await getCachedSegments(cacheKey, env);

    if (!segments) {
      // No cached segments, need to fetch the content and call Scope3
      const html = await response.clone().text();
      const pageData = extractPageContent(html, targetUrl);

      // Get segments from Scope3 API with timeout
      console.log(`[PROXY] Getting segments from Scope3 API for: ${targetUrl}`);
      segments = await getScope3SegmentsWithTimeout(pageData, env, ctx, true); // Force API call
      console.log(`[PROXY] Received segments from API: ${JSON.stringify(segments)}`);

      // Cache the segments if we got a valid response
      if (segments && segments.length > 0) {
        // Extract publication date from the page data if available
        const publishDate = pageData.url_last_updated;
        await cacheSegments(cacheKey, segments, env, publishDate);
        console.log(`[PROXY] Cached segments for: ${targetUrl}`);
      } else {
        // If we didn't get segments, use an empty array
        console.log(`[PROXY] No segments received from API, using empty array`);
        segments = [];
      }
    }

    // We can't directly modify the response.url property (it's read-only)
    console.log(`[PROXY] Preparing to inject segments with original URL: ${targetUrl}`);

    // Inject segments into the page, passing the targetUrl as a separate parameter
    return injectSegmentsIntoPage(response, segments, targetUrl);
  } catch (error) {
    console.error('Error processing proxy request:', error);
    return new Response(`Error fetching ${targetUrl}: ${error.message}`, {
      status: 500,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

/**
 * Handle API requests to get segments for a specific URL
 */
async function handleApiRequest(request, env, ctx) {
  console.log('[API] Handling API request for segments');

  // Set up CORS headers for API responses
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, HEAD',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, X-Requested-With, Origin',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  };

  try {
    // Check method
    if (request.method !== 'GET' && request.method !== 'POST') {
      return new Response(JSON.stringify({
        error: 'Method not allowed',
        allowed_methods: ['GET', 'POST', 'OPTIONS']
      }), {
        status: 405,
        headers: corsHeaders
      });
    }

    // Handle OPTIONS request for CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: corsHeaders
      });
    }

    // Get the target URL
    let targetUrl;
    let requestUrl;

    try {
      requestUrl = new URL(request.url);
      console.log(`[API] Request URL: ${requestUrl.toString()}`);
    } catch (urlError) {
      console.error(`[API] Error parsing request URL: ${urlError.message}`);
      return new Response(JSON.stringify({
        error: 'Invalid request URL',
        message: urlError.message
      }), {
        status: 400,
        headers: corsHeaders
      });
    }

    if (request.method === 'GET') {
      targetUrl = requestUrl.searchParams.get('url');
      console.log(`[API] Got URL from query param: ${targetUrl}`);
    } else {
      try {
        const body = await request.json();
        targetUrl = body.url;
        console.log(`[API] Got URL from request body: ${targetUrl}`);
      } catch (error) {
        console.error(`[API] Error parsing JSON body: ${error.message}`);
        return new Response(JSON.stringify({
          error: 'Invalid JSON body',
          message: error.message
        }), {
          status: 400,
          headers: corsHeaders
        });
      }
    }

    if (!targetUrl) {
      console.error('[API] Missing target URL in request');
      return new Response(JSON.stringify({
        error: 'Missing target URL',
        required: 'Please provide a "url" parameter'
      }), {
        status: 400,
        headers: corsHeaders
      });
    }

    // For demo/testing, handle special case URLs
    if (targetUrl === 'demo' || targetUrl === 'example' || targetUrl === 'test') {
      console.log(`[API] Serving demo segments for "${targetUrl}"`);
      const responseBody = JSON.stringify({
        url: `https://${targetUrl}.com`,
        segments: [`${targetUrl}_content`, 'demo_segment', 'test_data'],
        source: 'demo data (no API call)',
        timestamp: new Date().toISOString()
      });
      console.log(`[API] Demo response: ${responseBody}`);
      // Ensure we're creating a proper Response object
      return new Response(responseBody, {
        status: 200,
        headers: corsHeaders
      });
    }

    // Hardcoded response for example.com to ensure consistent behavior
    if (targetUrl === 'https://example.com' || targetUrl === 'http://example.com' ||
        targetUrl === 'example.com') {
      console.log(`[API] Serving hardcoded segments for example.com`);
      const responseBody = JSON.stringify({
        url: 'https://example.com',
        segments: ['example_segment', 'test_content', 'generic_web'],
        source: 'hardcoded data',
        timestamp: new Date().toISOString()
      });
      console.log(`[API] Example.com response: ${responseBody}`);
      // Explicit Response constructor with all parameters
      return new Response(responseBody, {
        status: 200,
        statusText: 'OK',
        headers: corsHeaders
      });
    }

    // Ensure URL has a protocol
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = 'https://' + targetUrl;
      console.log(`[API] Added https:// to URL: ${targetUrl}`);
    }

    // Check if we have cached segments for this URL
    const cacheKey = `url:${targetUrl}`;
    let segments = null;
    let source = 'api';

    try {
      segments = await getCachedSegments(cacheKey, env);

      if (segments) {
        source = 'cache';
        console.log(`[API] Using cached segments for ${targetUrl}: ${segments.length} segments`);
      } else {
        console.log(`[API] No cached segments for ${targetUrl}, fetching content`);

        // Create a request with minimal headers
        const apiRequest = new Request(targetUrl, {
          method: 'GET',
          headers: {
            'Accept': 'text/html,application/xhtml+xml',
            'User-Agent': 'Scope3-Segments-Worker'
          }
        });

        // Fetch the target URL content with a timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

        try {
          const response = await fetch(apiRequest, {
            signal: controller.signal
          });

          clearTimeout(timeoutId);
          console.log(`[API] Fetched URL with status: ${response.status}`);

          // Check if it's HTML - for API mode we only return segments for HTML pages
          const contentType = response.headers.get('content-type') || '';
          if (!contentType.includes('text/html')) {
            console.log(`[API] URL returned non-HTML content: ${contentType}`);
            return new Response(JSON.stringify({
              url: targetUrl,
              error: 'Target URL is not an HTML page',
              content_type: contentType,
              segments: []
            }), {
              status: 400,
              headers: corsHeaders
            });
          }

          // Extract page content and get segments
          const html = await response.text();
          const pageData = extractPageContent(html, targetUrl);
          segments = await getScope3SegmentsWithTimeout(pageData, env, ctx);

          if (!Array.isArray(segments)) {
            console.log(`[API] Segments is not an array, setting to empty array`);
            segments = [];
          }

          console.log(`[API] Got segments from API: ${segments.length} segments`);

          // Cache the segments if we got a valid response
          if (segments && segments.length > 0) {
            // Extract publication date from the page data if available
            const publishDate = pageData.url_last_updated;
            await cacheSegments(cacheKey, segments, env, publishDate);
          }
        } catch (fetchError) {
          if (fetchError.name === 'AbortError') {
            console.error(`[API] Timeout fetching URL content: ${targetUrl}`);
            return new Response(JSON.stringify({
              url: targetUrl,
              error: 'Timeout fetching URL content',
              segments: []
            }), {
              status: 504, // Gateway Timeout
              headers: corsHeaders
            });
          }

          console.error(`[API] Error fetching URL content: ${fetchError.message}`);
          return new Response(JSON.stringify({
            url: targetUrl,
            error: `Error fetching URL: ${fetchError.message}`,
            segments: []
          }), {
            status: 502, // Bad Gateway for fetch failures
            headers: corsHeaders
          });
        }
      }
    } catch (cacheError) {
      console.error(`[API] Error with cache operations: ${cacheError.message}`);
      // Continue with empty segments rather than failing
      segments = [];
    }

    // Ensure segments is always an array
    if (!Array.isArray(segments)) {
      segments = [];
    }

    // Return segments as JSON with explicit Response creation
    const finalResponseBody = JSON.stringify({
      url: targetUrl,
      segments: segments,
      source: source,
      timestamp: new Date().toISOString()
    }, null, 2);

    console.log(`[API] Final response: ${finalResponseBody.substring(0, 200)}...`);

    // Create Response object with explicit parameters
    const response = new Response(finalResponseBody, {
      status: 200,
      statusText: 'OK',
      headers: corsHeaders
    });

    console.log(`[API] Response created successfully: ${response.status} ${response.statusText}`);
    return response;
  } catch (error) {
    console.error(`[API] Unhandled error in API request: ${error.message}`);
    console.error(`[API] Error stack: ${error.stack}`);

    // Always return a valid Response object, even in case of unhandled exceptions
    try {
      const errorResponseBody = JSON.stringify({
        error: `Error processing request: ${error.message}`,
        segments: [],
        timestamp: new Date().toISOString()
      });

      console.log(`[API] Constructing error response: ${errorResponseBody}`);

      // Very explicit Response construction for error case
      const errorResponse = new Response(errorResponseBody, {
        status: 500,
        statusText: 'Internal Server Error',
        headers: corsHeaders
      });

      console.log(`[API] Error response created: ${errorResponse.status}`);
      return errorResponse;
    } catch (finalError) {
      // Last resort fallback if even the error response fails
      console.error(`[API] CRITICAL: Error creating error response: ${finalError.message}`);
      return new Response('{"error":"Critical server error"}', {
        status: 500,
        headers: {'Content-Type': 'application/json'}
      });
    }
  }
}

/**
 * Extract target URL from request (for proxy mode)
 */
function getTargetUrl(request) {
  try {
    const url = new URL(request.url);
    console.log(`[TARGET] Extracting target URL from: ${url.pathname}${url.search || ''}`);

    // Handle protocol-relative URLs (starting with //)
    if (url.pathname === '/' && url.hostname.includes('localhost')) {
      console.log(`[TARGET] Detected localhost request, returning test page instead`);
      return null; // Let it be handled as a test page
    }

    // Handle common error cases with protocol-relative URLs
    if (url.pathname === '//' || url.pathname.startsWith('//')) {
      console.log(`[TARGET] Detected protocol-relative URL as path, fixing: ${url.pathname}`);
      // Extract the hostname from the pathname
      const pathWithoutLeadingSlashes = url.pathname.replace(/^\/+/, '');

      // More comprehensive check for domain-like patterns
      const isDomainLike = /^[a-zA-Z0-9][-a-zA-Z0-9.]*\.[a-zA-Z]{2,}(\/|$)/.test(pathWithoutLeadingSlashes);
      const hasCommonTLD = /\.(com|org|net|edu|gov|io|co|me|app|dev)(\/|$)/i.test(pathWithoutLeadingSlashes);

      console.log(`[TARGET] Protocol-relative URL analysis: isDomainLike=${isDomainLike}, hasCommonTLD=${hasCommonTLD}`);

      // If it's clearly a domain, add https protocol
      if (isDomainLike || hasCommonTLD) {
        console.log(`[TARGET] Confirmed as protocol-relative URL, adding https protocol`);
        return 'https://' + pathWithoutLeadingSlashes;
      } else {
        // If it doesn't look like a domain, it might be a path - log this case
        console.log(`[TARGET] Path starts with // but doesn't look like a domain: ${pathWithoutLeadingSlashes}`);
        // Still handle it as protocol-relative but with a warning
        return 'https://' + pathWithoutLeadingSlashes;
      }
    }

    // Check for URL in query parameters
    if (url.searchParams.has('url')) {
      const targetUrl = url.searchParams.get('url');
      console.log(`[TARGET] Found target URL in query parameter: ${targetUrl}`);

      // Handle protocol-relative URLs in query parameters
      if (targetUrl.startsWith('//')) {
        console.log(`[TARGET] Detected protocol-relative URL in query parameter: ${targetUrl}`);

        // Extract the hostname part to validate if it looks like a domain
        const domainPart = targetUrl.substring(2).split('/')[0];
        const isDomainLike = /^[a-zA-Z0-9][-a-zA-Z0-9.]*\.[a-zA-Z]{2,}$/.test(domainPart);
        const hasCommonTLD = /\.(com|org|net|edu|gov|io|co|me|app|dev)$/i.test(domainPart);

        console.log(`[TARGET] Protocol-relative URL in query analysis: domainPart=${domainPart}, isDomainLike=${isDomainLike}, hasCommonTLD=${hasCommonTLD}`);

        // Use HTTPS by default for protocol-relative URLs
        return 'https:' + targetUrl;
      }

      // Handle URLs missing protocol
      if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        return 'https://' + targetUrl;
      }

      return targetUrl;
    }

    // Check for URL in path (after /proxy/ prefix)
    if (url.pathname.startsWith('/proxy/')) {
      // Get everything after /proxy/
      // Be careful how we extract the URL - need to include the entire rest of the path
      const encodedPath = url.pathname.slice(7); // Remove /proxy/
      const fullEncodedUrl = encodedPath + (url.search || ''); // Include query parameters

      console.log(`[TARGET] Found /proxy/ path, encoded part: ${encodedPath}`);
      console.log(`[TARGET] Including query params: ${fullEncodedUrl}`);

      try {
        // First check if the path has a valid protocol
        if (encodedPath.startsWith('http://') || encodedPath.startsWith('https://')) {
          console.log(`[TARGET] Found valid URL with protocol in path: ${encodedPath}`);
          return encodedPath + (url.search || '');
        }
        
        // If no protocol in the path part directly, reconstruct with https://
        // This handles cases where the URL is directly after /proxy/ without encoding
        if (encodedPath.includes('.')) {
          console.log(`[TARGET] Path appears to be a domain without protocol: ${encodedPath}`);
          return 'https://' + encodedPath + (url.search || '');
        }

        // Handle protocol-relative URLs
        if (encodedPath.startsWith('//')) {
          console.log(`[TARGET] Detected protocol-relative URL in proxy path: ${encodedPath}`);
          return 'https:' + encodedPath + (url.search || '');
        }

        // Attempt to decode the URL component as a fallback for encoded URLs
        const decodedUrl = decodeURIComponent(encodedPath);
        console.log(`[TARGET] Decoded URL: ${decodedUrl}`);

        // Handle protocol-relative URLs in the decoded URL
        if (decodedUrl.startsWith('//')) {
          console.log(`[TARGET] Detected protocol-relative URL in decoded path: ${decodedUrl}`);
          return 'https:' + decodedUrl + (url.search || '');
        }

        // Make sure it's a valid URL with protocol
        if (decodedUrl.startsWith('http://') || decodedUrl.startsWith('https://')) {
          return decodedUrl + (url.search || '');
        } else {
          // If it doesn't have a protocol, assume https
          return 'https://' + decodedUrl + (url.search || '');
        }
      } catch (error) {
        console.error('Error handling proxy URL:', error);
        return null;
      }
    }

    console.log('[TARGET] No target URL found in request');
    return null;
  } catch (error) {
    console.error(`[TARGET] Error handling request URL: ${error.message}`);
    return null;
  }
}

/**
 * Check if the request is for an HTML document
 */
function isHtmlRequest(request) {
  // Only process GET requests
  if (request.method !== 'GET') return false;
  
  // Check Accept header for HTML
  const accept = request.headers.get('accept');
  if (accept && accept.includes('text/html')) return true;
  
  // Check URL path for common HTML patterns
  const url = new URL(request.url);
  const path = url.pathname;
  if (path.endsWith('/') || path.endsWith('.html') || path.endsWith('.htm')) return true;
  
  return false;
}

/**
 * Extract content from HTML for the Scope3 API
 */
function extractPageContent(html, url) {
  // Extract title
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';

  // Extract meta description
  const descMatch = html.match(/<meta name="description" content="([^"]+)"/i);
  const description = descMatch ? descMatch[1].trim() : '';

  // Extract article content (simplified)
  let content = '';
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch) {
    // Strip HTML tags to get plain text
    content = articleMatch[1].replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 1000); // Limit content length
  }

  // Extract publication date if available
  let publishDate = '';
  const publishDateMeta = html.match(/<meta property="article:published_time" content="([^"]+)"/i);
  if (publishDateMeta) {
    publishDate = publishDateMeta[1];
  }

  // Extract URLs from content if available
  const extractUrls = (text) => {
    const urlRegex = /(https?:\/\/[^\s"'<>]+)/g;
    return text.match(urlRegex) || [];
  };

  // Make sure we have a properly formatted URL
  const ensureFullUrl = (urlString) => {
    if (!urlString) return '';

    // If it starts with // (protocol-relative URL), add https:
    if (urlString.startsWith('//')) {
      return 'https:' + urlString;
    }

    // If it doesn't have a protocol, add https://
    if (!urlString.startsWith('http://') && !urlString.startsWith('https://')) {
      return 'https://' + urlString;
    }

    return urlString;
  };

  // Extract URLs from article content
  const contentUrls = content ? extractUrls(content) : [];

  // Get the current URL as the main artifact, ensure it's fully formed
  const mainUrl = ensureFullUrl(url);

  // Create array of unique URLs as artifacts, ensure all are fully formed URLs
  const allUrls = [mainUrl, ...contentUrls.map(ensureFullUrl)].filter(Boolean);
  const uniqueUrls = [...new Set(allUrls)];

  // Format request according to updated Scope3 API requirements
  // Simplified payload structure based on the example
  const payload = {
    user_country: "US", // Default to US, could be extracted from request headers
    url: url
  };

  // Add url_last_updated if we have a publication date, to improve content freshness
  if (publishDate) {
    payload.url_last_updated = publishDate;
    console.log(`[CONTENT] Found publication date: ${publishDate}`);
  }

  return payload;
}

/**
 * Generate a unique transaction ID for ad requests
 */
function generateTransactionId() {
  return Date.now().toString() + Math.floor(Math.random() * 10000).toString();
}

/**
 * Get segments from Scope3 API with timeout
 * @param {Object} pageData - The page data to send to the Scope3 API
 * @param {Object} env - Environment variables and bindings
 * @param {Object} ctx - Execution context
 * @param {boolean} [forceApiCall=false] - Force an API call even without an API key
 */
async function getScope3SegmentsWithTimeout(pageData, env, ctx, forceApiCall = false) {
  console.log('[SEGMENTS] Getting segments for URL:', pageData.url);

  // Use TEST_API_KEY (if set) or environment variable
  const apiKey = TEST_API_KEY || env.SCOPE3_API_KEY;

  // Log API key status for debugging
  console.log('[SEGMENTS] API key available:', !!apiKey);
  console.log('[SEGMENTS] env.SCOPE3_API_KEY available:', !!env.SCOPE3_API_KEY);

  // Log environment variables for debugging
  console.log('[SEGMENTS] Available environment variables:', Object.keys(env));
  console.log('[SEGMENTS] API_TIMEOUT from env:', env.API_TIMEOUT);
  console.log('[SEGMENTS] CACHE_TTL from env:', env.CACHE_TTL);
  console.log('[SEGMENTS] SEGMENTS_CACHE available:', !!env.SEGMENTS_CACHE);

  // Special case: always return some sample segments for people.com
  // But also log the attempt to call the API for debugging purposes
  if (pageData.url && (pageData.url.includes('people.com') || pageData.url.includes('people.'))) {
    console.log('[SEGMENTS] Detected people.com, but will still attempt API call with logging');
    console.log('[SEGMENTS] API call would be made to:', SCOPE3_API_ENDPOINT);
    console.log('[SEGMENTS] With pageData:', JSON.stringify(pageData).substring(0, 200));
    
    // If API key is not available, use predefined segments
    if (!apiKey) {
      console.log('[SEGMENTS] No API key found, using predefined segments for people.com');
      const segments = ['entertainment', 'celebrity_news', 'premium_content', 'news_publisher'];
      console.log('[SEGMENTS] People.com segments:', segments);
      return segments;
    }
    
    // Otherwise continue with API call (will be logged)
  }

  // For development/testing, return mock segments when no API key is available
  // Unless forceApiCall is true, which is useful for testing the API integration
  if (!apiKey && !forceApiCall) {
    console.log('[SEGMENTS] No API key found and forceApiCall is false, using mock segments');

    // Simulate a short delay
    await new Promise(resolve => setTimeout(resolve, 50));

    // Return different segments based on URL or content
    const url = pageData.url?.toLowerCase() || '';
    const title = pageData._metadata?.title?.toLowerCase() || '';
    let segments = [];
    
    // URL-based segment generation (more specific)
    if (url.includes('example.com')) {
      segments = ['example_domain', 'test_content', 'generic_web'];
    } else if (url.includes('news') || url.includes('article')) {
      segments = ['news', 'current_events', 'article'];
    } else if (url.includes('product') || url.includes('shop')) {
      segments = ['product', 'shopping', 'commercial'];
    }
    // Title-based fallback
    else if (title.includes('test')) {
      segments = ['test_segment', 'development_mode', 'mock_data'];
    } else if (title.includes('news') || title.includes('article')) {
      segments = ['news', 'current_events', 'article'];
    } else if (title.includes('product') || title.includes('shop')) {
      segments = ['product', 'shopping', 'commercial'];
    } else {
      segments = ['general_content', 'web_page'];
    }

    console.log(`[SEGMENTS] Generated mock segments:`, segments);
    return segments;
  }

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    console.log(`[SEGMENTS] API request timed out after ${API_TIMEOUT}ms`);
    controller.abort();
  }, API_TIMEOUT);

  try {
    // Log extensive API call details for debugging
    console.log('[SEGMENTS] ======== API CALL DETAILS ========');
    console.log('[SEGMENTS] Calling Scope3 API for URL:', pageData.url);
    console.log('[SEGMENTS] API endpoint:', SCOPE3_API_ENDPOINT);
    console.log('[SEGMENTS] Request payload:', JSON.stringify(pageData, null, 2).substring(0, 500));
    console.log('[SEGMENTS] API_TIMEOUT:', API_TIMEOUT);
    
    if (apiKey) {
      console.log('[SEGMENTS] Using API key (masked):', apiKey.substring(0, 3) + '...' + apiKey.substring(apiKey.length - 3));
    } else if (forceApiCall) {
      console.log('[SEGMENTS] No API key available but forceApiCall is true, attempting API call without authentication');
    } else {
      console.log('[SEGMENTS] No API key available');
    }
    console.log('[SEGMENTS] ================================');

    // Call the Scope3 API
    let response;
    try {
      // Prepare headers
      const headers = {
        'Content-Type': 'application/json',
      };

      // Only add auth header if we have an API key
      if (apiKey) {
        headers['X-Scope3-Auth'] = apiKey;
      }

      console.log('[SEGMENTS] Sending API request now...');
      response = await fetch(SCOPE3_API_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify(pageData),
        signal: controller.signal
      });
      console.log('[SEGMENTS] API call returned with status:', response.status);
      console.log('[SEGMENTS] Response headers:', Object.fromEntries([...response.headers.entries()]));
    } catch (fetchError) {
      console.error('[SEGMENTS] Fetch error during API call:', fetchError);
      throw fetchError; // This will be caught by the outer try/catch
    }

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[SEGMENTS] Scope3 API error ${response.status}:`, errorText);
      return [];
    }

    const data = await response.json();
    console.log('[SEGMENTS] Received API response:', JSON.stringify(data).substring(0, 200) + '...');

    // Extract segments from the response based on the example format
    console.log('[SEGMENTS] Processing API response:', JSON.stringify(data).substring(0, 200));

    if (data.url_classifications && data.url_classifications.key_vals) {
      const segmentKeyVal = data.url_classifications.key_vals.find(kv => kv.key === 'scope3_segs');
      if (segmentKeyVal && Array.isArray(segmentKeyVal.values)) {
        console.log('[SEGMENTS] Found segments in response:', segmentKeyVal.values);
        return segmentKeyVal.values;
      }
    }

    // If we got here, we didn't find segments in the expected format
    console.log('[SEGMENTS] No segments found in response structure');

    // If we couldn't find segments in the response
    console.log('[SEGMENTS] No segments found in API response structure');
    return [];
  } catch (error) {
    clearTimeout(timeoutId);

    // If it's a timeout, log but don't treat as an error
    if (error.name === 'AbortError') {
      console.log('[SEGMENTS] Scope3 API request timed out');
      return [];
    }

    console.error('[SEGMENTS] Error fetching from Scope3 API:', error);
    return [];
  }
}

/**
 * Cache segments in KV store
 * @param {string} cacheKey - The key to store the segments under
 * @param {Array} segments - The segments to cache
 * @param {Object} env - The environment with KV bindings
 * @param {string} [publishDate] - Optional publication date for metadata
 */
async function cacheSegments(cacheKey, segments, env, publishDate) {
  try {
    if (env.SEGMENTS_CACHE) {
      // Store the segments along with metadata about when they were cached
      // and the publication date if available
      const cacheData = {
        segments: segments,
        cached_at: new Date().toISOString(),
        publish_date: publishDate || null
      };

      console.log(`[CACHE] Storing segments in cache with key: ${cacheKey}`);

      await env.SEGMENTS_CACHE.put(
        cacheKey,
        JSON.stringify(cacheData),
        { expirationTtl: CACHE_TTL }
      );
    }
  } catch (error) {
    console.error('Error storing in cache:', error);
  }
}

/**
 * Get cached segments from KV store
 * @param {string} cacheKey - The key to retrieve the segments from
 * @param {Object} env - The environment with KV bindings
 * @returns {Array|null} - The cached segments or null if not found
 */
async function getCachedSegments(cacheKey, env) {
  try {
    if (env.SEGMENTS_CACHE) {
      const cachedData = await env.SEGMENTS_CACHE.get(cacheKey, { type: 'json' });

      if (!cachedData) {
        console.log(`[CACHE] No cached data found for key: ${cacheKey}`);
        return null;
      }

      // Handle both formats: direct segments array or data object with segments property
      if (Array.isArray(cachedData)) {
        console.log(`[CACHE] Found cached segments (legacy format) for key: ${cacheKey}`);
        return cachedData;
      } else if (cachedData.segments) {
        console.log(`[CACHE] Found cached segments from ${cachedData.cached_at} for key: ${cacheKey}`);

        // Log publication date if available
        if (cachedData.publish_date) {
          console.log(`[CACHE] Original publish date: ${cachedData.publish_date}`);
        }

        return cachedData.segments;
      }
    }
    return null;
  } catch (error) {
    console.error('Error retrieving from cache:', error);
    return null;
  }
}

/**
 * Inject segments into HTML page and rewrite URLs to avoid proxying resources
 * @param {Response} response - The original response
 * @param {Array} segments - The segments to inject
 * @param {string} [providedUrl] - Optional URL to use for base tag (for proxy mode)
 */
async function injectSegmentsIntoPage(response, segments, providedUrl) {
  // Get the HTML content
  const html = await response.text();

  // Ensure segments is always an array
  const safeSegments = Array.isArray(segments) ? segments : [];
  
  // Create the segment script with segments
  console.log(`[HTML] Injecting segments into page:`, safeSegments);
  const segmentScript = `
<script>
  window.scope3_segments = ${JSON.stringify(safeSegments)};
  console.log("Scope3 segments loaded:", window.scope3_segments);

  // Add a visual indicator of segments (will be removed in production)
  document.addEventListener('DOMContentLoaded', function() {
    const segmentIndicator = document.createElement('div');
    segmentIndicator.style.position = 'fixed';
    segmentIndicator.style.bottom = '10px';
    segmentIndicator.style.right = '10px';
    segmentIndicator.style.padding = '10px';
    segmentIndicator.style.borderRadius = '5px';
    segmentIndicator.style.zIndex = '99999';
    segmentIndicator.style.maxWidth = '300px';
    segmentIndicator.style.fontSize = '12px';
    segmentIndicator.style.fontFamily = 'monospace';
    
    // Style based on whether segments were found
    if (window.scope3_segments && window.scope3_segments.length > 0) {
      segmentIndicator.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
      segmentIndicator.style.color = 'white';
      segmentIndicator.innerHTML = '<strong>Scope3 Segments:</strong><br>' +
        window.scope3_segments.map(s => '• ' + s).join('<br>');
    } else {
      // Lighter style for no segments
      segmentIndicator.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
      segmentIndicator.style.color = 'rgba(255, 255, 255, 0.8)';
      segmentIndicator.innerHTML = '<strong>Scope3 Segments:</strong><br>No segments found';
    }
    
    // Only append to body if it exists
    if (document.body) {
      document.body.appendChild(segmentIndicator);
    }
  });
</script>
`;

  // Get the original URL from either the provided URL or response URL
  let originBase = '';
  let originDomain = '';
  let originalUrl = null;
  try {
    if (providedUrl) {
      // If a URL was explicitly provided (proxy mode)
      originalUrl = new URL(providedUrl);
      originBase = `${originalUrl.protocol}//${originalUrl.host}`;
      originDomain = originalUrl.host;
      console.log(`[HTML] Using provided URL for base tag: ${originBase}`);
    } else if (response.url) {
      // If the response has a URL property
      originalUrl = new URL(response.url);
      originBase = `${originalUrl.protocol}//${originalUrl.host}`;
      originDomain = originalUrl.host;
      console.log(`[HTML] Using response URL for base tag: ${originBase}`);
    } else {
      // Fallback - no base tag will be added
      console.log('[HTML] No URL available for base tag');
    }
  } catch (error) {
    console.error('Error parsing URL for base tag:', error);
  }

  // Create base tag HTML if we have a valid origin
  let modifiedHtml = html;
  const protocol = originalUrl ? originalUrl.protocol : 'https:';
  
  if (originBase) {
    console.log(`[HTML] Rewriting URLs to avoid proxying resources; using ${protocol} for protocol-relative URLs`);

    // IMPORTANT: We DON'T add a base tag because that would make resources go through
    // our proxy. Instead, we rewrite all relative URLs to be absolute.

    // Rewrite protocol-relative URLs to absolute URLs
    // 1. Handle HTML attributes: src, href, srcset, data-src, data-href, and custom data attributes
    modifiedHtml = modifiedHtml.replace(
      /(\s(?:src|href|srcset|poster|formaction|ping|background|lowsrc|cite|action|data-(?:src|href|original|url|image|background|poster|bg|lazyload|original-src|fallback|highres|lowres))=["'])\/\//gi,
      `$1${protocol}//`
    );

    // 2. Handle URLs in CSS
    modifiedHtml = modifiedHtml.replace(
      /(url\(["']?)\/\//gi,
      `$1${protocol}//`
    );

    // CSS @import statements
    modifiedHtml = modifiedHtml.replace(
      /(@import\s+["'])\/\//gi,
      `$1${protocol}//`
    );

    // 3. Handle JS imports/exports
    modifiedHtml = modifiedHtml.replace(
      /((?:import|export)\s+(?:.*?)\s+from\s+["'])\/\//gi,
      `$1${protocol}//`
    );

    // 4. Handle JS API calls
    modifiedHtml = modifiedHtml.replace(
      /((?:fetch|load|open|ajax|get|post|put|delete|request|src|href)\s*\(\s*["'])\/\//gi,
      `$1${protocol}//`
    );

    // 5. Handle JS object URLs
    modifiedHtml = modifiedHtml.replace(
      /(["'](?:url|src|href|uri|endpoint|path|link)["']\s*:\s*["'])\/\//gi,
      `$1${protocol}//`
    );

    // 6. Handle srcset attributes
    modifiedHtml = modifiedHtml.replace(
      /(\ssrcset=["'][^"']*),\s*\/\//gi,
      `$1, ${protocol}//`
    );

    // 7. Handle Shadow DOM
    modifiedHtml = modifiedHtml.replace(
      /((?:createShadowRoot|attachShadow|innerHTML|outerHTML)\s*\(\s*["'])\/\//gi,
      `$1${protocol}//`
    );

    // Add script to fix relative URLs at runtime
    const urlFixerScript = `
<script>
  // Fix any remaining relative URLs when the page loads
  document.addEventListener('DOMContentLoaded', function() {
    // Get base domain from current page
    const baseUrl = '${originBase}';
    const basePath = '${originalUrl?.pathname || '/'}';
    const baseDir = basePath.substring(0, basePath.lastIndexOf('/') + 1);

    // Helper function to resolve relative URLs
    function resolveUrl(url) {
      if (!url) return url;
      if (url.startsWith('//')) return '${protocol}' + url;
      if (url.startsWith('http://') || url.startsWith('https://')) return url;
      if (url.startsWith('/')) return baseUrl + url;
      return baseUrl + baseDir + url;
    }

    // Function to fix URLs in all applicable elements
    function fixElementUrls() {
      // Fix common URL attributes
      const urlAttrs = ['src', 'href', 'action', 'data-src', 'data-href'];
      urlAttrs.forEach(attr => {
        document.querySelectorAll('[' + attr + ']').forEach(el => {
          const value = el.getAttribute(attr);
          if (value && !value.startsWith('http') && !value.startsWith('#') && !value.startsWith('javascript:') && !value.startsWith('data:')) {
            el.setAttribute(attr, resolveUrl(value));
          }
        });
      });
    }

    // Run once on load
    fixElementUrls();

    // Also handle dynamically added elements
    const observer = new MutationObserver(function(mutations) {
      fixElementUrls();
    });
    
    // Start observing the document
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  });
</script>
`;

    // Inject scripts into the page
    if (modifiedHtml.includes('</head>')) {
      modifiedHtml = modifiedHtml.replace('</head>', `${urlFixerScript}${segmentScript}</head>`);
      console.log('[HTML] Injected scripts before closing </head> tag');
    } else if (modifiedHtml.includes('<head>')) {
      modifiedHtml = modifiedHtml.replace('<head>', `<head>${urlFixerScript}${segmentScript}`);
      console.log('[HTML] Injected scripts after opening <head> tag');
    } else if (modifiedHtml.includes('<html>')) {
      modifiedHtml = modifiedHtml.replace('<html>', `<html><head>${urlFixerScript}${segmentScript}</head>`);
      console.log('[HTML] Added new <head> tag with scripts after <html>');
    } else if (modifiedHtml.includes('<!DOCTYPE html>')) {
      modifiedHtml = modifiedHtml.replace('<!DOCTYPE html>', `<!DOCTYPE html><head>${urlFixerScript}${segmentScript}</head>`);
      console.log('[HTML] Added new <head> tag with scripts after DOCTYPE');
    } else {
      modifiedHtml = `<head>${urlFixerScript}${segmentScript}</head>` + modifiedHtml;
      console.log('[HTML] Prepended <head> with scripts to the document');
    }
  } else {
    // Fallback if we don't have origin information
    if (modifiedHtml.includes('</head>')) {
      modifiedHtml = modifiedHtml.replace('</head>', `${segmentScript}</head>`);
    } else if (modifiedHtml.includes('<head>')) {
      modifiedHtml = modifiedHtml.replace('<head>', `<head>${segmentScript}`);
    } else {
      modifiedHtml = `<head>${segmentScript}</head>` + modifiedHtml;
    }
  }

  // Copy the original headers
  const headers = new Headers(response.headers);

  // Add CORS headers for cross-origin requests
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');

  // Return modified response
  return new Response(modifiedHtml, {
    headers: headers,
    status: response.status,
    statusText: response.statusText
  });
}

/**
 * Create a test page with segments
 */
function createTestPage() {
  const segments = ['test_segment', 'development_mode', 'mock_data'];

  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Scope3 Test Page</title>
  <meta name="description" content="Test page for Scope3 segments">
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      line-height: 1.6;
    }
    h1, h2 { color: #333; }
    .section {
      margin: 30px 0;
      padding: 20px;
      border: 1px solid #ddd;
      border-radius: 5px;
    }
    code {
      background: #f5f5f5;
      padding: 2px 4px;
      border-radius: 3px;
      font-family: monospace;
    }
    .card {
      border: 1px solid #ddd;
      border-radius: 5px;
      padding: 15px;
      margin-bottom: 15px;
      background: #f9f9f9;
    }
    button {
      padding: 8px 16px;
      background-color: #0078d7;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
    button:hover {
      background-color: #0063b1;
    }
  </style>
  <script>
    window.scope3_segments = ${JSON.stringify(segments)};
  </script>
</head>
<body>
  <h1>Scope3 Segments Worker</h1>
  <p>This test page demonstrates the Scope3 Segments Worker functionality.</p>

  <div style="background: #f5f5f5; padding: 10px; border-radius: 5px; margin-bottom: 20px; font-size: 12px; font-family: monospace;">
    <strong>Debug Tools:</strong>
    <br>Current URL: <span id="current-url-display"></span>
    <br><a href="#" id="debug-request-link" style="color: blue;">Analyze Request</a> (helps diagnose URL handling issues)
    <script>
      // Set current URL
      document.getElementById('current-url-display').textContent = window.location.href;

      // Set up debug link
      document.getElementById('debug-request-link').addEventListener('click', function(e) {
        e.preventDefault();
        const baseUrl = window.location.protocol + '//' + window.location.host;
        const debugUrl = baseUrl + '/debug-request?t=' + Date.now();
        console.log('Opening debug URL:', debugUrl);
        window.open(debugUrl, '_blank');
      });
    </script>
  </div>

  <div class="section">
    <h2>Injected Segments</h2>
    <p>The following segments have been injected into this page:</p>
    <div class="card">
      <ul id="segments-list"></ul>
    </div>
  </div>

  <div class="section">
    <h2>Test Resources</h2>
    <p>Test loading resources from different paths:</p>
    <button id="load-resource">Load Resource</button>
    <div id="resource-result" class="card" style="margin-top: 15px; display: none;"></div>
  </div>

  <div class="section">
    <h2>Test Different Content Types</h2>
    <p>Click the links below to test segment generation for different content types:</p>
    <div class="content-test" style="margin-top: 15px;">
      <a href="/test-content/news" target="_blank" style="display: inline-block; margin-right: 10px; margin-bottom: 10px; padding: 8px 16px; background-color: #f0f0f0; border-radius: 4px; text-decoration: none; color: #333;">News Article</a>
      <a href="/test-content/product" target="_blank" style="display: inline-block; margin-right: 10px; margin-bottom: 10px; padding: 8px 16px; background-color: #f0f0f0; border-radius: 4px; text-decoration: none; color: #333;">Product Page</a>
      <a href="/test-content/test" target="_blank" style="display: inline-block; margin-right: 10px; margin-bottom: 10px; padding: 8px 16px; background-color: #f0f0f0; border-radius: 4px; text-decoration: none; color: #333;">Test Content</a>
      <a href="/test-content/other" target="_blank" style="display: inline-block; margin-right: 10px; margin-bottom: 10px; padding: 8px 16px; background-color: #f0f0f0; border-radius: 4px; text-decoration: none; color: #333;">Generic Content</a>
    </div>
  </div>

  <div class="section">
    <h2>Test API Direct Call</h2>
    <p>This endpoint directly calls the Scope3 API and returns the raw response as JSON:</p>
    <div style="margin-top: 15px;">
      <a href="/api-test?url=https://example.com" target="_blank" style="display: inline-block; margin-right: 10px; margin-bottom: 10px; padding: 8px 16px; background-color: #0078d7; border-radius: 4px; text-decoration: none; color: white;">Test API Call to example.com</a>
      <a href="/api-test?url=https://news.example.com" target="_blank" style="display: inline-block; margin-right: 10px; margin-bottom: 10px; padding: 8px 16px; background-color: #0078d7; border-radius: 4px; text-decoration: none; color: white;">Test API Call to news.example.com</a>
    </div>

    <div style="margin-top: 15px;">
      <form id="api-test-form" style="margin-top: 15px; display: flex; flex-wrap: wrap; align-items: flex-start;">
        <input type="text" id="test-url" placeholder="Enter a URL to test" style="flex: 1; min-width: 300px; padding: 8px; border: 1px solid #ccc; border-radius: 4px; margin-right: 10px; margin-bottom: 10px;">
        <button type="submit" style="padding: 8px 16px; background-color: #0078d7; color: white; border: none; border-radius: 4px; cursor: pointer;">Test API Call</button>
      </form>
    </div>

    <p style="margin-top: 10px; font-size: 14px; color: #666;">Note: This will make a simple, direct call to the Scope3 API - no proxy or resource handling involved.</p>

    <script>
      document.getElementById('api-test-form').addEventListener('submit', function(e) {
        e.preventDefault();
        const url = document.getElementById('test-url').value.trim();
        if (url) {
          // Construct absolute URL for API test
          const baseUrl = window.location.protocol + '//' + window.location.host;
          const apiTestUrl = baseUrl + '/api-test?url=' + encodeURIComponent(url);
          console.log('Opening API test URL:', apiTestUrl);
          window.open(apiTestUrl, '_blank');
        }
      });
    </script>
  </div>

  <div class="section">
    <h2>Operating Modes</h2>
    <p>The worker supports three operating modes:</p>
    <div class="card">
      <h3>1. Route Handler Mode</h3>
      <p>Worker intercepts requests via Cloudflare Routes</p>
      <code>https://example.com/page</code>
    </div>
    <div class="card">
      <h3>2. Proxy Mode</h3>
      <p>Worker explicitly proxies specified URLs</p>
      <code>https://worker.example.com/proxy/https://target-site.com</code>
      <p style="margin-top:10px">
        <a href="#" id="proxy-example-link" target="_blank">Try it: Proxy example.com</a>
        <script>
          document.addEventListener('DOMContentLoaded', function() {
            // Set proxy link
            const proxyLink = document.getElementById('proxy-example-link');
            proxyLink.href = window.location.protocol + '//' + window.location.host +
                            '/proxy/https://example.com';
          });
        </script>
      </p>
    </div>
    <div class="card">
      <h3>3. API Mode</h3>
      <p>Get segments for a URL via JSON API</p>
      <code>https://worker.example.com/api/segments?url=https://target-site.com</code>
      <p style="margin-top:10px">
        <!-- Use script to construct proper URLs -->
        <a href="#" id="demo-segments-link" style="display: block; margin-bottom: 5px;">Try it: Get segments (demo data)</a>
        <a href="#" id="example-segments-link" style="display: block; margin-bottom: 5px;">Try it: Get segments for example.com</a>

        <script>
          // Create fully qualified URLs using window.location
          document.addEventListener('DOMContentLoaded', function() {
            // For demo data
            const demoLink = document.getElementById('demo-segments-link');
            demoLink.href = window.location.protocol + '//' + window.location.host + '/api/segments?url=example';

            // For example.com
            const exampleLink = document.getElementById('example-segments-link');
            exampleLink.href = window.location.protocol + '//' + window.location.host + '/api/segments?url=https://example.com';
          });
        </script>
      </p>
    </div>
  </div>

  <script>
    // Display the segments on the page
    const segmentsList = document.getElementById('segments-list');
    window.scope3_segments.forEach(segment => {
      const li = document.createElement('li');
      li.textContent = segment;
      segmentsList.appendChild(li);
    });

    // Test resource loading
    document.getElementById('load-resource').addEventListener('click', async () => {
      const resultDiv = document.getElementById('resource-result');
      resultDiv.style.display = 'block';
      resultDiv.innerHTML = 'Loading resource...';

      try {
        // Try to load a test resource - include timestamp to avoid caching
        const timestamp = new Date().getTime();
        const response = await fetch('/page-test-resource.json?t=' + timestamp, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'Cache-Control': 'no-cache'
          },
          cache: 'no-store'
        });

        if (response.ok) {
          const data = await response.json();
          resultDiv.innerHTML = '<div style="color: green; font-weight: bold; margin-bottom: 10px;">✓ Resource loaded successfully!</div>' +
            '<pre style="background: #f5f5f5; padding: 10px; border-radius: 4px; overflow-x: auto;">' +
            JSON.stringify(data, null, 2) + '</pre>';
        } else {
          let errorText = '';
          try {
            errorText = await response.text();
          } catch (e) {
            errorText = 'Could not read error response';
          }
          resultDiv.innerHTML = '<div style="color: #721c24; background-color: #f8d7da; border: 1px solid #f5c6cb; padding: 10px; border-radius: 4px; margin-bottom: 10px;">❌ Error loading resource</div>' +
            '<p>Status: ' + response.status + ' ' + response.statusText + '</p>' +
            '<p>' + errorText + '</p>';
        }
      } catch (error) {
        console.error('Resource loading error:', error);
        resultDiv.innerHTML = '<div style="color: #721c24; background-color: #f8d7da; border: 1px solid #f5c6cb; padding: 10px; border-radius: 4px; margin-bottom: 10px;">❌ Error loading resource</div>' +
          '<p><strong>Error:</strong> ' + error.message + '</p>' +
          '<p>Check browser console for more details.</p>';
      }
    });
  </script>
</body>
</html>
`;

  return new Response(html, {
    headers: {
      'content-type': 'text/html;charset=UTF-8'
    }
  });
}

/**
 * Create a test page with different content types to test segment generation
 */
function createContentTestPage(contentType) {
  let title, description, content;

  switch(contentType) {
    case 'news':
      title = 'Breaking News: Important Article';
      description = 'This is a news article about current events';
      content = `
        <article>
          <h1>Breaking News: Important Article</h1>
          <p>This is a news article about current events. It contains information about recent happenings in the world.</p>
          <p>The news is very important and people should be informed about these events.</p>
        </article>
      `;
      break;

    case 'product':
      title = 'Premium Product for Sale';
      description = 'Shop our premium product with great features';
      content = `
        <article>
          <h1>Premium Product for Sale</h1>
          <p>This product has amazing features that will change your life. Buy now for a limited time offer.</p>
          <p>The product is available in multiple colors and sizes.</p>
        </article>
      `;
      break;

    case 'test':
      title = 'Test Page for Testing';
      description = 'This is a test page for testing purposes';
      content = `
        <article>
          <h1>Test Page for Testing</h1>
          <p>This is a test page that exists purely for testing the system.</p>
          <p>It has test content and is meant for testing only.</p>
        </article>
      `;
      break;

    default:
      title = 'Generic Content Page';
      description = 'This is a generic web page with content';
      content = `
        <article>
          <h1>Generic Content</h1>
          <p>This is a generic page with some generic content.</p>
          <p>Nothing specific about this page.</p>
        </article>
      `;
  }

  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>${title}</title>
  <meta name="description" content="${description}">
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      line-height: 1.6;
    }
    h1 { color: #333; margin-bottom: 20px; }
    article {
      border: 1px solid #ddd;
      border-radius: 5px;
      padding: 20px;
      margin: 20px 0;
    }
    .back-link {
      display: inline-block;
      margin-top: 20px;
      color: #0078d7;
      text-decoration: none;
    }
    .back-link:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <h1>Content Type Test: ${contentType}</h1>

  ${content}

  <p><strong>Content type:</strong> ${contentType}</p>
  <p><strong>Title:</strong> ${title}</p>
  <p><strong>Description:</strong> ${description}</p>

  <a href="/test" class="back-link">← Back to Test Page</a>

  <script>
    // Check for segments
    document.addEventListener('DOMContentLoaded', function() {
      if (window.scope3_segments) {
        console.log('Scope3 segments found:', window.scope3_segments);
      } else {
        console.log('No Scope3 segments found on this page');
      }
    });
  </script>
</body>
</html>
  `;

  // For this content test page we don't inject segments directly
  // The worker's main handler will extract content and inject segments
  const response = new Response(html, {
    headers: {
      'content-type': 'text/html;charset=UTF-8'
    }
  });

  return response;
}

/**
 * Handle API test request
 * @param {string} targetUrl - The URL to test
 * @param {Object} env - Environment variables
 * @returns {Response} - API response
 */
async function handleApiTestRequest(targetUrl, env) {
  const fullUrl = targetUrl.startsWith('http') ? targetUrl : 'https://' + targetUrl;

  console.log(`[API-TEST] Testing URL: ${fullUrl}`);

  // Create the minimal required payload - updated for new API format
  const payload = {
    user_country: "US",
    url: fullUrl
  };

  try {
    // Get the API key
    const apiKey = env.SCOPE3_API_KEY || TEST_API_KEY;
    console.log(`[API-TEST] API key available: ${!!apiKey}`);

    // Make a direct call to the API with a 10-second timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    console.log(`[API-TEST] Calling endpoint: ${SCOPE3_API_ENDPOINT}`);
    const response = await fetch(SCOPE3_API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey && { 'X-Scope3-Auth': apiKey })
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    // Handle the response
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    console.log('[API-TEST] Successfully received API response');

    // Extract segments from the response based on updated API format
    let segments = [];
    if (data.url_classifications && data.url_classifications.key_vals) {
      const segmentKeyVal = data.url_classifications.key_vals.find(kv => kv.key === 'scope3_segs');
      if (segmentKeyVal && Array.isArray(segmentKeyVal.values)) {
        segments = segmentKeyVal.values;
      }
    }

    // Return the segments and full API response for debugging
    return new Response(JSON.stringify({
      url: fullUrl,
      segments: segments,
      raw_response: data,
      timestamp: new Date().toISOString()
    }, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  catch (error) {
    console.error(`[API-TEST] Error: ${error.message}`);
    return new Response(JSON.stringify({
      error: error.message,
      url: fullUrl
    }, null, 2), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}