/**
 * Scope3 Segments Client Script
 * 
 * This script can be added to any page to call the Scope3 publisher API
 * and inject segments for ad targeting.
 */

(function() {
  // Configuration
  const SCOPE3_API_ENDPOINT = 'https://api.scope3.com/v1/segments'; // Replace with actual endpoint
  const SCOPE3_API_KEY = ''; // Set this to your Scope3 API key
  const CACHE_TTL = 60 * 60 * 1000; // Cache for 1 hour (in milliseconds)
  const API_TIMEOUT = 200; // Timeout after 200ms to prevent slow page loads
  
  // Initialize when the DOM is fully loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initScope3);
  } else {
    initScope3();
  }
  
  /**
   * Initialize Scope3 segments functionality
   */
  function initScope3() {
    // Check if segments are already in window object
    if (window.scope3_segments) {
      console.log('Scope3 segments already present:', window.scope3_segments);
      return;
    }
    
    // First check if we have cached segments
    const cachedData = getSegmentsFromCache();
    
    if (cachedData) {
      console.log('Using cached Scope3 segments:', cachedData.segments);
      window.scope3_segments = cachedData.segments;
      
      // Dispatch event to notify that segments are available
      dispatchSegmentsReadyEvent();
      return;
    }
    
    // No cache, fetch from API
    fetchScope3Segments();
  }
  
  /**
   * Fetch segments from Scope3 API with timeout
   */
  function fetchScope3Segments() {
    // Extract content from the page
    const pageContent = extractPageContent();
    
    console.log('Fetching Scope3 segments for page content:', pageContent);
    
    // Set up timeout for the API call
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);
    
    // Call the Scope3 API
    fetch(SCOPE3_API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SCOPE3_API_KEY}`
      },
      body: JSON.stringify(pageContent),
      signal: controller.signal
    })
    .then(response => {
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`Scope3 API error: ${response.status}`);
      }
      
      return response.json();
    })
    .then(data => {
      const segments = data.segments || [];
      console.log('Received Scope3 segments:', segments);
      
      // Store segments in window object
      window.scope3_segments = segments;
      
      // Cache the segments
      cacheSegments(segments);
      
      // Dispatch event to notify that segments are available
      dispatchSegmentsReadyEvent();
    })
    .catch(error => {
      clearTimeout(timeoutId);
      
      // If it's a timeout, log but don't treat as an error
      if (error.name === 'AbortError') {
        console.log('Scope3 API request timed out');
        // Set empty segments array if API times out
        window.scope3_segments = [];
        dispatchSegmentsReadyEvent();
        return;
      }
      
      console.error('Error fetching from Scope3 API:', error);
      // Set empty segments array on error
      window.scope3_segments = [];
      dispatchSegmentsReadyEvent();
    });
  }
  
  /**
   * Extract relevant content from the page for the Scope3 API
   */
  function extractPageContent() {
    // Get the page title
    const title = document.title || '';
    
    // Get meta description
    const metaDescription = document.querySelector('meta[name="description"]');
    const description = metaDescription ? metaDescription.getAttribute('content') : '';
    
    // Get article content if available
    let articleContent = '';
    const articleElement = document.querySelector('article') || document.querySelector('.article-content');
    if (articleElement) {
      articleContent = articleElement.textContent.trim().substring(0, 1000);
    }
    
    // Get main content if available
    let mainContent = '';
    const mainElement = document.querySelector('main');
    if (mainElement && !articleContent) {
      mainContent = mainElement.textContent.trim().substring(0, 1000);
    }
    
    return {
      url: window.location.href,
      title: title,
      description: description,
      content: articleContent || mainContent
    };
  }
  
  /**
   * Cache segments in localStorage
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
  function getSegmentsFromCache() {
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
      
      return cachedData;
    } catch (error) {
      console.error('Error retrieving cached Scope3 segments:', error);
      return null;
    }
  }
  
  /**
   * Dispatch custom event when segments are ready
   */
  function dispatchSegmentsReadyEvent() {
    const event = new CustomEvent('scope3SegmentsReady', { 
      detail: { segments: window.scope3_segments }
    });
    
    document.dispatchEvent(event);
  }
})();