/**
 * Cloudflare Worker for Scope3 Publisher Real-Time API Integration
 * 
 * This worker intercepts requests, calls the Scope3 API, and injects the returned
 * segments into the page's HTML header before passing it to the client.
 */

// Import configuration and simplified caching modules (ES module format)
import * as config from './config.js';
import * as UAParserLib from 'ua-parser-js';

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

  // Start the timer for origin page fetch
  const originFetchStartTime = Date.now();
  try {
    var response = await fetch(originRequest);
    const originFetchTime = Date.now() - originFetchStartTime;
    console.log(`[TIMING] Origin page fetch took ${originFetchTime}ms`);
    
    const etag = response.headers.get('ETag');
    const lastModified = response.headers.get('Last-Modified');
    
    // Build the API request object that we'll send to Scope3
    const apiRequest = buildOpenRtbRequest(url, etag, lastModified, request);
    
    // Use the API request as the cache key (stringified and hashed)
    const cacheKey = getCacheKey(apiRequest);
    
    // Get segments from cache
    let segments = await getCachedSegments(cacheKey, env);
    
    if (!segments) {
      console.log(`[CACHE] Cache miss, fetching from API`);
      segments = await callSegmentApi(apiRequest, env);
      // Only cache if we got valid segments
      if (segments && Object.keys(segments).length > 0) {
        // Use context.waitUntil to not block the response
        ctx.waitUntil(cacheSegments(cacheKey, segments, env));
      }
    }

  var html = await response.text();
  const modifiedText = insertScope3Segments(html, baseUrl, segments);
  
  // Create a new response that preserves all headers and status
  const headers = new Headers(response.headers);
    
  return new Response(modifiedText, {
    status: response.status,
    statusText: response.statusText,
    headers: headers
  });
  } catch (error) {
    console.error(`[FETCH] Error in request processing: ${error}`);
    return new Response(`Error processing request: ${error.message}`, {
      status: 500,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

/**
 * Call the Scope3 API with an OpenRTB request to get segments
 * @param {Object} apiRequest - The OpenRTB request object
 * @param {Object} env - Environment variables and bindings
 * @returns {Promise<Object>} - The structured segments from the API
 */
async function callSegmentApi(apiRequest, env) {
  try {
    const apiStartTime = Date.now();
    const apiKey = env.SCOPE3_API_KEY || config.TEST_API_KEY;
    
    // Set up timeout using AbortController
    const apiTimeout = parseInt(env.API_TIMEOUT || config.DEFAULT_API_TIMEOUT);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), apiTimeout);
    
    console.log(`[API] Sending OpenRTB request:`, JSON.stringify(apiRequest, null, 2));
    
    const response = await fetch(config.SCOPE3_API_ENDPOINT, {
      method: 'POST',
      headers: {
          'Content-Type': 'application/json',
          'x-scope3-auth': `${apiKey}`
      },
      body: JSON.stringify(apiRequest),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    const apiTime = Date.now() - apiStartTime;
    console.log(`[TIMING] Scope3 API call took ${apiTime}ms`);
    
    // Get the response text and try to parse it as JSON
    const responseText = await response.text();
    
    // Try to parse the JSON response
    let data;
    try {
      data = JSON.parse(responseText);
      console.log(`[API] Scope3 API response:`, JSON.stringify(data, null, 2));
    } catch (parseError) {
      console.error(`[API] JSON parse error: ${parseError.message}`);
      console.log(`[API] Response body: ${responseText}`);
      return { global: [] };
    }
    
    // Handle the new response format - this will need to be adjusted based on the actual response
    // Create structured segments object
    const structuredSegments = {
      global: [] // Empty global segments for now
    };
    
    // Parse slot-specific segments from impressions
    if (data && data.data && Array.isArray(data.data)) {
      // Process each destination in the response
      data.data.forEach(destination => {
        // Check for imp array
        if (destination.imp && Array.isArray(destination.imp)) {
          // Process each impression
          destination.imp.forEach(impression => {
            // Extract segments if available
            if (impression.ext && impression.ext.scope3 && impression.ext.scope3.segments) {
              const impSegments = impression.ext.scope3.segments.map(segment => segment.id);
              
              // Add to slot-specific collection using tagid or imp.id as fallback
              const slotId = impression.tagid || impression.id;
              if (slotId) {
                structuredSegments[slotId] = impSegments;
              }
            }
          });
        }
      });
    }
    
    // Log structured segments
    console.log(`[SEGMENTS] Structured segments:`, JSON.stringify(structuredSegments, null, 2));
    
    // Return the structured segments object
    return structuredSegments;
  } catch (error) {
    console.error(`[API] Error getting segments: ${error}`);
    // Return empty structured segments object
    return { global: [] };
  }
}

async function getSegmentsFromAPI(url, etag, last_modified, env, request) {
    // Make Scope3 API request with timeout
    const apiKey = env.SCOPE3_API_KEY || config.TEST_API_KEY;
    
    // Extract domain from the URL
    const domain = url.hostname;
    
    // Get user agent string from request headers
    const userAgentString = request?.headers?.get("user-agent") || "";
    
    // Parse user agent with UAParser
    const parser = new UAParserLib.UAParser(userAgentString);
    const result = parser.getResult();
    
    // Determine device type from parsing result (1=mobile, 2=desktop, 3=connected TV, 4=phone, 5=tablet, 6=connected device, 7=set top box)
    let devicetype = 2; // Default to desktop
    if (result.device.type === 'mobile' || result.device.type === 'tablet') {
      devicetype = result.device.type === 'mobile' ? 1 : 5;
    }
    
    // Get geolocation data from CF data with defaults
    let country = "US"; // Default country
    let region = "";
    let city = "";
    let postalCode = "";
    let latitude = null;
    let longitude = null;
    let timezone = "";
    
    if (request && request.cf) {
      // Get country from CF data
      if (request.cf.country) {
        country = request.cf.country;
      }
      
      // Get region from CF data
      if (request.cf.region) {
        region = request.cf.region;
      }
      
      // Get city from CF data
      if (request.cf.city) {
        city = request.cf.city;
      }
      
      // Get postal code from CF data
      if (request.cf.postalCode) {
        postalCode = request.cf.postalCode;
      }
      
      // Get coordinates from CF data
      if (request.cf.latitude !== undefined) {
        // Ensure latitude is a number
        latitude = typeof request.cf.latitude === 'number' ? 
                  request.cf.latitude : 
                  parseFloat(request.cf.latitude);
      }
      if (request.cf.longitude !== undefined) {
        // Ensure longitude is a number
        longitude = typeof request.cf.longitude === 'number' ? 
                   request.cf.longitude : 
                   parseFloat(request.cf.longitude);
      }
      
      // Get timezone from CF data
      if (request.cf.timezone) {
        timezone = request.cf.timezone;
      }
    }
    
    // Check for CF-Device-Type header
    const cfDeviceType = request?.headers?.get("CF-Device-Type");
    if (cfDeviceType) {
      // Override devicetype based on CF-Device-Type header
      if (cfDeviceType === "mobile") {
        devicetype = 1;
      } else if (cfDeviceType === "tablet") {
        devicetype = 5;
      } else if (cfDeviceType === "desktop") {
        devicetype = 2;
      }
    }
    
    // Create OpenRTB request format
    const openRtbRequest = {
      site: {
        domain: domain,
        page: url.toString(),
        ext: {
          scope3: {
            etag: etag || "",
            last_modified: last_modified || ""
          }
        }
      },
      imp: [
        {
          id: "1"
        }
      ],
      device: {
        devicetype: devicetype,
        geo: {
          country: country
        },
        ua: userAgentString,
        os: result.os.name,
        make: result.device.vendor || "",
        model: result.device.model || ""
      }
    };
    
    // Add optional geo fields only if they have valid values
    if (region) openRtbRequest.device.geo.region = region;
    if (city) openRtbRequest.device.geo.city = city;
    if (postalCode) openRtbRequest.device.geo.zip = postalCode;
    if (latitude !== null && !isNaN(latitude)) openRtbRequest.device.geo.lat = latitude;
    if (longitude !== null && !isNaN(longitude)) openRtbRequest.device.geo.lon = longitude;
    if (timezone) openRtbRequest.device.geo.utcoffset = timezone;
    
    try {
      const apiStartTime = Date.now();
      
      // Set up timeout using AbortController
      const apiTimeout = parseInt(env.API_TIMEOUT || config.DEFAULT_API_TIMEOUT);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), apiTimeout);
      
      console.log(`[API] Sending OpenRTB request:`, JSON.stringify(openRtbRequest, null, 2));
      
      const response = await fetch(config.SCOPE3_API_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-scope3-auth': `${apiKey}`
        },
        body: JSON.stringify(openRtbRequest),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      const apiTime = Date.now() - apiStartTime;
      console.log(`[TIMING] Scope3 API call took ${apiTime}ms`);
      
      // The response is valid if it's 200 OK, no need to check if (!response.ok)
      
      // Get the response text and try to parse it as JSON
      const responseText = await response.text();
      
      // Try to parse the JSON response
      let data;
      try {
        data = JSON.parse(responseText);
        console.log(`[API] Scope3 API response:`, JSON.stringify(data, null, 2));
      } catch (parseError) {
        console.error(`[API] JSON parse error: ${parseError.message}`);
        console.log(`[API] Response body: ${responseText}`);
        return [];
      }
      
      // Handle the new response format - this will need to be adjusted based on the actual response
      let segments = [];
      
      // Create structured segments object
      // TODO: Add global segments when supported by the API
      const structuredSegments = {
        global: [] // Empty global segments for now
      };
      
      // Parse slot-specific segments from impressions
      if (data && data.data && Array.isArray(data.data)) {
        // Process each destination in the response
        data.data.forEach(destination => {
          // Check for imp array
          if (destination.imp && Array.isArray(destination.imp)) {
            // Process each impression
            destination.imp.forEach(impression => {
              // Extract segments if available
              if (impression.ext && impression.ext.scope3 && impression.ext.scope3.segments) {
                const impSegments = impression.ext.scope3.segments.map(segment => segment.id);
                
                // Add to slot-specific collection using tagid or imp.id as fallback
                const slotId = impression.tagid || impression.id;
                if (slotId) {
                  structuredSegments[slotId] = impSegments;
                }
              }
            });
          }
        });
      }
      
      // Log structured segments
      console.log(`[SEGMENTS] Structured segments:`, JSON.stringify(structuredSegments, null, 2));
      
      // Return the structured segments object
      return structuredSegments;
    } catch (error) {
      console.error(`[API] Error getting segments: ${error}`);
      // Return empty structured segments object
      return { global: [] };
    }
}

/**
 * Get segments from the Cache API
 * @param {string} cacheKey - The key to look up in the cache
 * @param {Object} env - Environment variables and bindings
 * @returns {Promise<Array|null>} - The cached segments or null if not found
 */
async function getCachedSegments(cacheKey, env) {
  try {
    // Start timer for cache operation
    const cacheStartTime = Date.now();
    
    // Use the Scope3 API domain as a consistent hostname
    const apiUrl = new URL(config.SCOPE3_API_ENDPOINT);
    const cacheUrl = new URL(`https://${apiUrl.hostname}/cache/${encodeURIComponent(cacheKey)}`);
    const cacheRequest = new Request(cacheUrl);
    
    // Access the default cache
    const cache = caches.default;
    // No need for a log here, we already logged above
    const cachedResponse = await cache.match(cacheRequest);
    
    const cacheTime = Date.now() - cacheStartTime;
    console.log(`[TIMING] Cache API read took ${cacheTime}ms`);
    
    if (!cachedResponse) {
      console.log(`[CACHE] No cached segments for key: ${cacheKey}`);
      return null;
    }
    
    // Parse the cached data
    const cachedData = await cachedResponse.json();
    
    // Check if cache is expired
    const cacheTtl = parseInt(env.CACHE_TTL || config.DEFAULT_CACHE_TTL);
    const cacheAge = Date.now() - cachedData.timestamp;
    
    if (cacheAge > cacheTtl * 1000) {
      console.log(`[CACHE] Cached segments expired for key: ${cacheKey}`);
      return null;
    }
    
    console.log(`[CACHE] Found cached segments for key: ${cacheKey}`);
    
    // Handle both new structured format and legacy format
    if (cachedData.structuredSegments) {
      console.log(`[SEGMENTS] Found cached structured segments:`, JSON.stringify(cachedData.structuredSegments, null, 2));
      return cachedData.structuredSegments;
    } else if (cachedData.segments) {
      // Legacy format - convert to structured format
      console.log(`[SEGMENTS] Found ${cachedData.segments.length} cached segments (legacy format):`, JSON.stringify(cachedData.segments, null, 2));
      return { global: cachedData.segments };
    }
    
    // No valid segments found
    return null;
  } catch (error) {
    console.error(`[CACHE] Error checking cache: ${error}`);
    return null;
  }
}

/**
 * Store segments in the Cache API
 * @param {URL} url - The original URL
 * @param {string} etag - The ETag header
 * @param {string} last_modified - The Last-Modified header
 * @param {Array} segments - The segments to cache
 * @param {Object} env - Environment variables and bindings
 * @returns {Promise<void>}
 */
async function cacheSegments(cacheKey, structuredSegments, env) {
  try {
    // Create the cache entry with structured segments
    const cacheData = {
      structuredSegments: structuredSegments,
      timestamp: Date.now()
    };
    
    // Get cache TTL from environment or use default
    const cacheTtl = parseInt(env.CACHE_TTL || config.DEFAULT_CACHE_TTL);
    
    // Start timer for cache write operation
    const cacheWriteStartTime = Date.now();
    
    // Use the Scope3 API domain as a consistent hostname
    const apiUrl = new URL(config.SCOPE3_API_ENDPOINT);
    const cacheUrl = new URL(`https://${apiUrl.hostname}/cache/${encodeURIComponent(cacheKey)}`);
    const cacheRequest = new Request(cacheUrl);
    const cacheResponse = new Response(JSON.stringify(cacheData), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `max-age=${cacheTtl}`
      }
    });
    
    // Store in Cache API
    const cache = caches.default;
    await cache.put(cacheRequest, cacheResponse);
    
    const cacheWriteTime = Date.now() - cacheWriteStartTime;
    console.log(`[TIMING] Cache API write took ${cacheWriteTime}ms`);
    console.log(`[CACHE] Cached structured segments for key: ${cacheKey} with TTL of ${cacheTtl}s`);
  } catch (error) {
    console.error(`[CACHE] Error caching segments: ${error}`);
  }
}

/**
 * Build an OpenRTB request object for the Scope3 API
 * @param {URL} url - The URL of the page
 * @param {string} etag - The ETag header from the response
 * @param {string} lastModified - The Last-Modified header from the response
 * @param {Request} request - The original request with headers and CF data
 * @returns {Object} - The OpenRTB request object
 */
function buildOpenRtbRequest(url, etag, lastModified, request) {
  // Extract domain from the URL
  const domain = url.hostname;
  
  // Get user agent string from request headers
  const userAgentString = request?.headers?.get("user-agent") || "";
  
  // Parse user agent with UAParser
  const parser = new UAParserLib.UAParser(userAgentString);
  const result = parser.getResult();
  
  // Determine device type from parsing result (1=mobile, 2=desktop, 3=connected TV, 4=phone, 5=tablet, 6=connected device, 7=set top box)
  let devicetype = 2; // Default to desktop
  if (result.device.type === 'mobile' || result.device.type === 'tablet') {
    devicetype = result.device.type === 'mobile' ? 1 : 5;
  }
  
  // Get geolocation data from CF data with defaults
  let country = "US"; // Default country
  let region = "";
  let city = "";
  let postalCode = "";
  let latitude = null;
  let longitude = null;
  let timezone = "";
  
  if (request && request.cf) {
    // Get country from CF data
    if (request.cf.country) {
      country = request.cf.country;
    }
    
    // Get region from CF data
    if (request.cf.region) {
      region = request.cf.region;
    }
    
    // Get city from CF data
    if (request.cf.city) {
      city = request.cf.city;
    }
    
    // Get postal code from CF data
    if (request.cf.postalCode) {
      postalCode = request.cf.postalCode;
    }
    
    // Get coordinates from CF data
    if (request.cf.latitude !== undefined) {
      // Ensure latitude is a number
      latitude = typeof request.cf.latitude === 'number' ? 
                request.cf.latitude : 
                parseFloat(request.cf.latitude);
    }
    if (request.cf.longitude !== undefined) {
      // Ensure longitude is a number
      longitude = typeof request.cf.longitude === 'number' ? 
                 request.cf.longitude : 
                 parseFloat(request.cf.longitude);
    }
    
    // Get timezone from CF data
    if (request.cf.timezone) {
      timezone = request.cf.timezone;
    }
  }
  
  // Check for CF-Device-Type header
  const cfDeviceType = request?.headers?.get("CF-Device-Type");
  if (cfDeviceType) {
    // Override devicetype based on CF-Device-Type header
    if (cfDeviceType === "mobile") {
      devicetype = 1;
    } else if (cfDeviceType === "tablet") {
      devicetype = 5;
    } else if (cfDeviceType === "desktop") {
      devicetype = 2;
    }
  }
  
  // Create OpenRTB request format
  const openRtbRequest = {
    site: {
      domain: domain,
      page: url.toString(),
      ext: {
        scope3: {
          etag: etag || "",
          last_modified: lastModified || ""
        }
      }
    },
    imp: [
      {
        id: "1"
      }
    ],
    device: {
      devicetype: devicetype,
      geo: {
        country: country
      },
      ua: userAgentString,
      os: result.os.name,
      make: result.device.vendor || "",
      model: result.device.model || ""
    }
  };
  
  // Add optional geo fields only if they have valid values
  if (region) openRtbRequest.device.geo.region = region;
  if (city) openRtbRequest.device.geo.city = city;
  if (postalCode) openRtbRequest.device.geo.zip = postalCode;
  if (latitude !== null && !isNaN(latitude)) openRtbRequest.device.geo.lat = latitude;
  if (longitude !== null && !isNaN(longitude)) openRtbRequest.device.geo.lon = longitude;
  if (timezone) openRtbRequest.device.geo.utcoffset = timezone;
  
  return openRtbRequest;
}

/**
 * Generate a cache key from the API request
 * @param {Object} apiRequest - The OpenRTB request object
 * @returns {string} - The cache key
 */
function getCacheKey(apiRequest) {
  // Simple hash function for strings
  function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16);
  }
  
  // Create a deterministic cache key based on a hash of the request
  const requestStr = JSON.stringify(apiRequest);
  const requestHash = simpleHash(requestStr);
  
  // Use the Scope3 API domain as part of the key
  const apiUrl = new URL(config.SCOPE3_API_ENDPOINT);
  return `${apiUrl.hostname}:${requestHash}`;
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
function insertScope3Segments(html, baseUrl, structuredSegments) {
  // Create the script to be injected with structured segments format
  var scriptToInject = `<script>
  window.scope3 = window.scope3 || {};
  window.scope3.segments = ${JSON.stringify(structuredSegments || { global: [] })};
</script>`;
  if (baseUrl) {
    scriptToInject += `<base href=${baseUrl}/>`
  }

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
