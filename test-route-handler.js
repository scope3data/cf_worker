/**
 * Test file for Scope3 Worker Route Handler Mode
 * This file helps verify that the Route Handler mode correctly processes requests
 */

// Mock a request going through Cloudflare Routes
async function testRouteHandlerMode() {
  const mockOriginalRequest = new Request("https://example.com", {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      'Accept': 'text/html,application/xhtml+xml,application/xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  // Make a request directly to our worker
  // In a real Cloudflare environment, this would be handled by a route pattern
  const worker = new Worker('src/index.js');
  
  try {
    // Call handleRequest directly
    const response = await worker.fetch(mockOriginalRequest);
    
    // Check the response
    console.log('Status:', response.status);
    console.log('Headers:', Object.fromEntries(response.headers.entries()));
    
    const content = await response.text();
    console.log('Content length:', content.length);
    
    // Check if segments were injected
    const hasSegments = content.includes('window.scope3_segments');
    console.log('Segments injected:', hasSegments);
    
    // Extract segments
    const segmentsMatch = content.match(/window\.scope3_segments\s*=\s*(\[.*?\]);/s);
    if (segmentsMatch && segmentsMatch[1]) {
      console.log('Segments:', segmentsMatch[1]);
    }
    
    return hasSegments;
  } catch (error) {
    console.error('Error testing route handler mode:', error);
    return false;
  }
}

// Run the test
testRouteHandlerMode()
  .then(success => {
    console.log('Route handler mode test:', success ? 'PASSED' : 'FAILED');
  })
  .catch(error => {
    console.error('Test execution error:', error);
  });