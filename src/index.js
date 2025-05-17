/**
 * Cloudflare Worker for Scope3 Publisher Real-Time API Integration
 * 
 * This worker intercepts requests, calls the Scope3 API, and injects the returned
 * segments into the page's HTML header before passing it to the client.
 */

// Import configuration and simplified caching modules (ES module format)
import * as config from './config.js';

// Define the main worker object (ES Module format)
export default {
  async fetch(request, env, ctx) {
    return await handleRequest(request, env, ctx);
  }
};

/**
 * Main request handler
 * @param {Request} request - The incoming request
 * @param {Object} env - Environment variables and bindings
 * @param {Object} ctx - Execution context
 * @returns {Promise<Response>} - The response
 */
async function handleRequest(request, env, ctx) {
  var url = new URL(request.url);
  var baseUrl
  if (url.pathname.startsWith('/proxy/')) {
    url = new URL(url.pathname.substring(7))
    baseUrl = url.origin
  }
  console.log(`url: ${url}`)
  
  // Clone the request to pass to the origin
  const originRequest = new Request(url.toString(), request)

  const path = url.pathname.toLowerCase();
  const isResource = /\.(js|css|png|jpe?g|gif|svg|webp|mp4|webm|mp3|wav|pdf|json|xml|woff2?|ttf|otf)$/i.test(path);
  
  // Determine if this is an initial HTML document request
  // Only modify initial document requests, not subsequent resources
  if (isResource) {
    console.log(`[SCOPE3] Path ${url.pathname} is a resource`)
    return fetch(originRequest);
  }

  if (request.cf?.bot_management?.verified_bot || request.cf?.bot_management?.score > 75) {
    console.log(`[SCOPE3] Request is from a bot`)
    return fetch(originRequest);
  }

  var response = await fetch(originRequest)
  const etag = response.headers.get('ETag');
  const lastModified = response.headers.get('Last-Modified');
  const segmentsCacheKey = getCacheKey(url, etag, lastModified)
  let segments = await getCachedSegments(segmentsCacheKey, env);
  if (!segments) {
    segments = await getSegmentsFromAPI(url, etag, lastModified, env);
  }

  var html = await response.text()
  const modifiedText = insertScope3Segments(html, baseUrl, segments);
  
  // Create a new response that preserves all headers and status
  const headers = new Headers(response.headers);
    
  return new Response(modifiedText, {
    status: response.status,
    statusText: response.statusText,
    headers: headers
  });
}

async function getSegmentsFromAPI(url, etag, last_modified, env) {
    // Make Scope3 API request (TODO: add timeout)
    const apiKey = env.SCOPE3_API_KEY || config.TEST_API_KEY;
    const scope3req = {
      etag: etag,
      last_modified: last_modified,
      url: url.toString()
    }
    try {
      const response = await fetch(config.SCOPE3_API_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-scope3-auth': `${apiKey}`
        },
        body: JSON.stringify(scope3req)
      })
      const data = await response.json();
      console.log(`[API] Scope3 API response:`, JSON.stringify(data, null, 2))
      const kvs = data?.url_classifications?.key_vals || [];
      const segments = kvs.length > 0 ? kvs[0].values : []
      await cacheSegments(url, etag, last_modified, segments, env);
    } catch (error) {
      console.error(`[CACHE] Error getting segments: ${error}`);
      return [];
    }
    return segments
}

/**
 * Get segments from the KV cache
 * @param {string} cacheKey - The key to look up in the cache
 * @param {Object} env - Environment variables and bindings
 * @returns {Promise<Array|null>} - The cached segments or null if not found
 */
async function getCachedSegments(cacheKey, env) {
  try {
    // Skip caching if SEGMENTS_CACHE binding is not available
    if (!env.SEGMENTS_CACHE) {
      console.log('[CACHE] SEGMENTS_CACHE binding not available, skipping cache');
      return null;
    }
    
    // Check the KV cache for segments
    const cachedData = await env.SEGMENTS_CACHE.get(cacheKey, { type: 'json' });
    
    if (!cachedData) {
      console.log(`[CACHE] No cached segments for key: ${cacheKey}`);
      return null;
    }
    
    // Check if cache is expired
    const cacheTtl = parseInt(env.CACHE_TTL || config.DEFAULT_CACHE_TTL);
    const cacheAge = Date.now() - cachedData.timestamp;
    
    if (cacheAge > cacheTtl * 1000) {
      console.log(`[CACHE] Cached segments expired for key: ${cacheKey}`);
      return null;
    }
    
    console.log(`[CACHE] Found cached segments for key: ${cacheKey}`);
    return cachedData.segments;
  } catch (error) {
    console.error(`[CACHE] Error checking cache: ${error}`);
    return null;
  }
}

/**
 * Store segments in the KV cache
 * @param {string} cacheKey - The key to store the segments under
 * @param {Array} segments - The segments to cache
 * @param {Object} env - Environment variables and bindings
 * @returns {Promise<void>}
 */
async function cacheSegments(url, etag, last_modified, segments, env) {
  const cacheKey = getCacheKey(url, etag, last_modified)
  try {
    // Skip caching if SEGMENTS_CACHE binding is not available
    if (!env.SEGMENTS_CACHE) {
      console.log('[CACHE] SEGMENTS_CACHE binding not available, skipping caching');
      return;
    }
    
    // Create the cache entry
    const cacheData = {
      segments: segments,
      timestamp: Date.now()
    };
    
    // Get cache TTL from environment or use default
    const cacheTtl = parseInt(env.CACHE_TTL || config.DEFAULT_CACHE_TTL);
    
    // Store in KV with expiration
    await env.SEGMENTS_CACHE.put(cacheKey, JSON.stringify(cacheData), { expirationTtl: cacheTtl });
    
    console.log(`[CACHE] Cached segments for key: ${cacheKey} with TTL of ${cacheTtl}s`);
  } catch (error) {
    console.error(`[CACHE] Error caching segments: ${error}`);
  }
}

function getCacheKey(url, etag, lastModified) {
  var segmentsCacheKey = `url:${url.toString()}`
  if (etag) {
    segmentsCacheKey += `,etag:${etag}`
  } else if (lastModified) {
    segmentsCacheKey += `,last:${lastModified}`
  }
  return segmentsCacheKey
}

function injectIntoHead(html, scriptToInject) {
  // Find the head tag with any attributes
  const headMatch = html.match(/\<head(\s+[^>]*)?\>/i);

  if (headMatch) {
    const headTag = headMatch[0];
    const headPosition = headMatch.index + headTag.length;

    // Insert after the complete head tag
    return html.slice(0, headPosition) + scriptToInject + html.slice(headPosition);
  }

  // Fallback if no head tag found
  return html;
}

/**
 * Insert Scope3 segments into the HTML
 * @param {string} html - The HTML content
 * @param {Array} segments - The segments to inject
 * @returns {string} - The modified HTML
 */
function insertScope3Segments(html, baseUrl, segments) {
  // Create the script to be injected
  var scriptToInject = `<script>
  window.scope3 = window.scope3 || {};
  window.scope3.segments = ${JSON.stringify(segments || [])};
</script>`;
  if (baseUrl) {
    scriptToInject += `<base href=${baseUrl}/>`
  }

  console.log(`writing ${scriptToInject}`)
  return injectIntoHead(html, scriptToInject)
}

/**
 * Extract title from HTML
 * @param {string} html - The HTML content
 * @returns {string} - The extracted title or empty string
 */
function extractTitle(html) {
  const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
  return titleMatch ? titleMatch[1].trim() : '';
}

/**
 * Extract description from HTML
 * @param {string} html - The HTML content
 * @returns {string} - The extracted description or empty string
 */
function extractDescription(html) {
  const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i)
                  || html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i);
  return descMatch ? descMatch[1].trim() : '';
}
