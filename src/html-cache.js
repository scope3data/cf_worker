/**
 * HTML Caching Module for Scope3 Segments Worker
 * 
 * This module provides intelligent caching of origin HTML content with change detection.
 * It caches HTML content and checks for updates using ETag or Last-Modified headers.
 */

// Cache key prefix for HTML content
const HTML_CACHE_PREFIX = 'html:';

/**
 * Generate a cache key for a URL
 * @param {string} url The URL to generate a key for
 * @returns {string} The cache key
 */
function generateHtmlCacheKey(url) {
  // Generate a standardized key for the URL
  // Remove protocol, query parameters, and fragments to improve cache hit rate
  const urlObj = new URL(url);
  const normalizedUrl = `${urlObj.hostname}${urlObj.pathname}`;
  return `${HTML_CACHE_PREFIX}${normalizedUrl}`;
}

/**
 * Get cached HTML content if available and valid
 * @param {string} url The URL to get cached content for
 * @param {Object} env Environment variables and bindings
 * @returns {Promise<Object|null>} The cached HTML data or null if not found/valid
 */
async function getCachedHtml(url, env) {
  // Skip caching if HTML_CACHE is not available
  if (!env.HTML_CACHE) {
    console.log('[HTML-CACHE] HTML_CACHE binding not available, skipping cache check');
    return null;
  }

  const cacheKey = generateHtmlCacheKey(url);
  
  try {
    // Get the cached content
    const cachedData = await env.HTML_CACHE.get(cacheKey, { type: 'json' });
    
    if (!cachedData) {
      console.log(`[HTML-CACHE] No cached content found for ${url}`);
      return null;
    }
    
    // Check if the cache is expired
    const cacheTtl = parseInt(env.HTML_CACHE_TTL || 86400); // Default to 24 hours
    const cacheAge = Date.now() - cachedData.timestamp;
    
    if (cacheAge > cacheTtl * 1000) {
      console.log(`[HTML-CACHE] Cached content expired for ${url}`);
      return null;
    }
    
    console.log(`[HTML-CACHE] Using cached content for ${url} (age: ${Math.round(cacheAge / 1000)}s)`);
    return cachedData;
  } catch (error) {
    console.error(`[HTML-CACHE] Error retrieving cached HTML: ${error}`);
    return null;
  }
}

/**
 * Store HTML content in cache with validation info
 * @param {string} url The URL of the content
 * @param {string} html The HTML content to cache
 * @param {Response} response The original response from the origin
 * @param {Object} env Environment variables and bindings
 */
async function cacheHtml(url, html, response, env) {
  // Skip caching if HTML_CACHE is not available
  if (!env.HTML_CACHE) {
    console.log('[HTML-CACHE] HTML_CACHE binding not available, skipping caching');
    return;
  }

  const cacheKey = generateHtmlCacheKey(url);
  
  try {
    // Extract validation headers for future conditional requests
    const etag = response.headers.get('etag');
    const lastModified = response.headers.get('last-modified');
    
    // Create the cache entry
    const cacheData = {
      html: html,
      url: url,
      timestamp: Date.now(),
      validation: {
        etag: etag,
        lastModified: lastModified
      }
    };
    
    // Get TTL in seconds
    const cacheTtl = parseInt(env.HTML_CACHE_TTL || 86400); // Default to 24 hours
    
    // Store in KV with expiration
    await env.HTML_CACHE.put(cacheKey, JSON.stringify(cacheData), { expirationTtl: cacheTtl });
    
    console.log(`[HTML-CACHE] Cached HTML for ${url} (${html.length} bytes) with TTL of ${cacheTtl}s`);
  } catch (error) {
    console.error(`[HTML-CACHE] Error caching HTML: ${error}`);
  }
}

/**
 * Fetch HTML with conditional request if we have cached validation info
 * @param {string} url The URL to fetch
 * @param {Object} cachedData Previous cached data with validation info (if available)
 * @param {Request} originalRequest The original request
 * @returns {Promise<Object>} The fetch result with HTML and metadata
 */
async function fetchHtmlWithConditional(url, cachedData, originalRequest) {
  // Create a new request with filtered headers from the original
  const headers = new Headers();
  
  // Copy essential headers from the original request
  if (originalRequest) {
    const headersToKeep = ['user-agent', 'accept', 'accept-language', 'referer'];
    for (const header of headersToKeep) {
      if (originalRequest.headers.has(header)) {
        headers.set(header, originalRequest.headers.get(header));
      }
    }
  }
  
  // Add conditional headers if we have cached validation info
  if (cachedData && cachedData.validation) {
    if (cachedData.validation.etag) {
      headers.set('If-None-Match', cachedData.validation.etag);
    }
    if (cachedData.validation.lastModified) {
      headers.set('If-Modified-Since', cachedData.validation.lastModified);
    }
  }
  
  const fetchRequest = new Request(url, {
    method: 'GET',
    headers: headers,
    redirect: 'follow'
  });
  
  console.log(`[HTML-CACHE] Fetching ${url} ${cachedData ? 'with conditional headers' : ''}`);
  
  try {
    const response = await fetch(fetchRequest);
    
    // Check if the content hasn't changed (304 Not Modified)
    if (response.status === 304 && cachedData) {
      console.log(`[HTML-CACHE] Content not modified for ${url}`);
      return {
        html: cachedData.html,
        response: response,
        fromCache: true,
        notModified: true
      };
    }
    
    // For successful responses, get the HTML
    if (response.ok) {
      const html = await response.text();
      
      return {
        html: html,
        response: response,
        fromCache: false,
        notModified: false
      };
    }
    
    // Handle error responses
    throw new Error(`Failed to fetch HTML: ${response.status} ${response.statusText}`);
  } catch (error) {
    console.error(`[HTML-CACHE] Fetch error: ${error}`);
    
    // If we have cached content, use it as a fallback
    if (cachedData) {
      console.log(`[HTML-CACHE] Using cached content as fallback after fetch error`);
      return {
        html: cachedData.html,
        response: new Response(cachedData.html, {
          status: 200,
          headers: { 'Content-Type': 'text/html', 'X-Cache': 'HIT-FALLBACK' }
        }),
        fromCache: true,
        notModified: false,
        isFallback: true
      };
    }
    
    // Re-throw the error if we don't have a fallback
    throw error;
  }
}

/**
 * Get HTML content with intelligent caching
 * @param {string} url The URL to get HTML for
 * @param {Request} originalRequest The original request (for headers)
 * @param {Object} env Environment variables and bindings
 * @returns {Promise<Object>} Object with HTML content, response, and cache status
 */
async function getHtmlWithCache(url, originalRequest, env) {
  try {
    // Check for cached content first
    const cachedData = await getCachedHtml(url, env);
    
    // Fetch with conditional request to check for updates
    const fetchResult = await fetchHtmlWithConditional(url, cachedData, originalRequest);
    
    // If content is new or changed, cache it
    if (!fetchResult.fromCache && !fetchResult.notModified) {
      await cacheHtml(url, fetchResult.html, fetchResult.response, env);
    }
    
    return fetchResult;
  } catch (error) {
    console.error(`[HTML-CACHE] Error in getHtmlWithCache: ${error}`);
    throw error;
  }
}

module.exports = {
  getHtmlWithCache,
  getCachedHtml,
  cacheHtml
};