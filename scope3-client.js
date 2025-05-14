/**
 * Scope3 Segments Client
 * 
 * This script fetches segments from the Scope3 API proxy and injects them 
 * into the page for ad targeting.
 */

(function() {
  // Configuration - Replace with your worker URL
  const SCOPE3_PROXY_URL = 'https://scope3-segments-worker.your-subdomain.workers.dev';
  const CACHE_TTL = 60 * 60 * 1000; // Cache lifetime in milliseconds (1 hour)
  const API_TIMEOUT = 200; // API timeout in milliseconds
  
  // Initialize when the DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initScope3Segments);
  } else {
    initScope3Segments();
  }
  
  /**
   * Initialize Scope3 segments
   */
  function initScope3Segments() {
    // Check if segments are already present
    if (window.scope3_segments) {
      console.log('Scope3 segments already present:', window.scope3_segments);
      return;
    }
    
    // Set the initial segments to empty array
    window.scope3_segments = [];
    
    // Check for cached segments first
    const cachedSegments = getCachedSegments();
    if (cachedSegments) {
      window.scope3_segments = cachedSegments;
      console.log('Using cached Scope3 segments:', cachedSegments);
      dispatchSegmentsReadyEvent();
      return;
    }
    
    // Fetch segments with timeout
    fetchSegmentsWithTimeout();
  }
  
  /**
   * Fetch segments with timeout
   */
  function fetchSegmentsWithTimeout() {
    // Create a promise that times out
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Scope3 API request timed out')), API_TIMEOUT);
    });
    
    // Create the fetch promise
    const fetchPromise = fetchSegments();
    
    // Race the promises
    Promise.race([fetchPromise, timeoutPromise])
      .then(segments => {
        if (segments && segments.length > 0) {
          window.scope3_segments = segments;
          cacheSegments(segments);
          dispatchSegmentsReadyEvent();
        }
      })
      .catch(error => {
        if (error.message === 'Scope3 API request timed out') {
          console.log('Scope3 segments request timed out');
        } else {
          console.error('Error fetching Scope3 segments:', error);
        }
        dispatchSegmentsReadyEvent();
      });
  }
  
  /**
   * Fetch segments from the Scope3 proxy
   */
  async function fetchSegments() {
    const currentUrl = window.location.href;
    const proxyUrl = `${SCOPE3_PROXY_URL}?url=${encodeURIComponent(currentUrl)}`;
    
    const response = await fetch(proxyUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Error fetching segments: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.segments || [];
  }
  
  /**
   * Store segments in localStorage cache
   */
  function cacheSegments(segments) {
    try {
      const cacheData = {
        segments: segments,
        timestamp: Date.now(),
        url: window.location.pathname
      };
      
      localStorage.setItem('scope3_segments', JSON.stringify(cacheData));
    } catch (error) {
      console.error('Error caching Scope3 segments:', error);
    }
  }
  
  /**
   * Get cached segments from localStorage
   */
  function getCachedSegments() {
    try {
      const cachedDataString = localStorage.getItem('scope3_segments');
      
      if (!cachedDataString) {
        return null;
      }
      
      const cachedData = JSON.parse(cachedDataString);
      
      // Check if cache is for current URL
      if (cachedData.url !== window.location.pathname) {
        return null;
      }
      
      // Check if cache is expired
      if (Date.now() - cachedData.timestamp > CACHE_TTL) {
        return null;
      }
      
      return cachedData.segments;
    } catch (error) {
      console.error('Error retrieving cached Scope3 segments:', error);
      return null;
    }
  }
  
  /**
   * Dispatch an event when segments are ready
   */
  function dispatchSegmentsReadyEvent() {
    const event = new CustomEvent('scope3SegmentsReady', {
      detail: { segments: window.scope3_segments }
    });
    
    document.dispatchEvent(event);
  }
})();