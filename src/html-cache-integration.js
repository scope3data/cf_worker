/**
 * HTML Cache Integration for Scope3 Segments Worker
 * 
 * This file contains functions to integrate the HTML cache with the main worker.
 * It provides wrapper functions that can be used in index.js without significant changes.
 */

const htmlCache = require('./html-cache');

/**
 * Fetch HTML content with intelligent caching for origin requests
 * @param {string} url The URL to fetch
 * @param {Request} originalRequest The original request
 * @param {Object} env Environment variables and bindings
 * @param {Object} ctx Execution context
 * @returns {Promise<Object>} The response data with HTML content
 */
async function fetchHtmlWithIntelligentCache(url, originalRequest, env, ctx) {
  console.log(`[HTML-CACHE-INTEGRATION] Fetching ${url} with intelligent caching`);
  
  try {
    // Use the HTML cache module to get the content
    const fetchResult = await htmlCache.getHtmlWithCache(url, originalRequest, env);
    
    // Create cache status header
    let cacheStatus = fetchResult.fromCache ? 'HIT' : 'MISS';
    if (fetchResult.notModified) cacheStatus += '-CONDITIONAL';
    if (fetchResult.isFallback) cacheStatus += '-FALLBACK';
    
    // Add cache status and validation info to response
    const headers = new Headers(fetchResult.response.headers);
    headers.set('X-HTML-Cache', cacheStatus);
    
    // Add validation headers for transparency
    if (fetchResult.validationInfo) {
      if (fetchResult.validationInfo.etag) {
        headers.set('X-Cache-ETag', fetchResult.validationInfo.etag);
      }
      if (fetchResult.validationInfo.lastModified) {
        headers.set('X-Cache-Last-Modified', fetchResult.validationInfo.lastModified);
      }
    }
    
    // Add cache age if applicable
    if (fetchResult.fromCache && fetchResult.cacheTimestamp) {
      const cacheAge = Math.round((Date.now() - fetchResult.cacheTimestamp) / 1000);
      headers.set('X-Cache-Age', `${cacheAge}s`);
    }
    
    // Create a new response with the same status, headers, and HTML content
    const response = new Response(fetchResult.html, {
      status: fetchResult.isFallback ? 200 : fetchResult.response.status,
      statusText: fetchResult.isFallback ? 'OK (Fallback)' : fetchResult.response.statusText,
      headers: headers
    });
    
    return {
      html: fetchResult.html,
      response: response,
      cacheStatus: cacheStatus
    };
  } catch (error) {
    console.error(`[HTML-CACHE-INTEGRATION] Error: ${error}`);
    throw error;
  }
}

/**
 * Function to integrate with route handler mode in index.js
 * Replace the fetch in route handler mode with this function
 */
async function fetchOriginWithCache(request, url, env, ctx) {
  // Only use HTML cache for GET requests
  if (request.method !== 'GET') {
    console.log(`[HTML-CACHE-INTEGRATION] Skipping cache for non-GET method: ${request.method}`);
    
    // Do a normal fetch for non-GET methods
    const originRequest = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: 'follow'
    });
    
    return await fetch(originRequest);
  }
  
  try {
    // Use intelligent caching for HTML
    const fetchResult = await fetchHtmlWithIntelligentCache(request.url, request, env, ctx);
    return fetchResult.response;
  } catch (error) {
    console.error(`[HTML-CACHE-INTEGRATION] Error in fetchOriginWithCache: ${error}`);
    
    // Fall back to normal fetch on error
    console.log(`[HTML-CACHE-INTEGRATION] Falling back to normal fetch`);
    const originRequest = new Request(request.url, {
      method: 'GET',
      headers: request.headers,
      redirect: 'follow'
    });
    
    return await fetch(originRequest);
  }
}

module.exports = {
  fetchHtmlWithIntelligentCache,
  fetchOriginWithCache
};