/**
 * Route Handler Mode Tests
 * This file tests the route handler mode functionality of the worker
 */

// Simulate the environment where requests are intercepted through Routes
async function testRouteHandlerMode() {
  console.log('\nTesting Route Handler Mode...');
  console.log('================================');
  
  try {
    // Create a test server to capture the requests
    const testServer = require('http').createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html>
        <html>
        <head>
          <title>Route Handler Test Page</title>
          <meta name="description" content="Testing route handler mode">
        </head>
        <body>
          <h1>Route Handler Test</h1>
          <p>This is a test page for route handler mode.</p>
        </body>
        </html>`);
    });
    
    // Start server on a random port
    await new Promise(resolve => {
      testServer.listen(0, () => {
        resolve();
      });
    });
    
    const port = testServer.address().port;
    console.log(`Test server running on port ${port}`);

    // Step 1: Make a direct fetch request to the test server to get original content
    const directResponse = await fetch(`http://localhost:${port}`);
    const directContent = await directResponse.text();
    console.log(`Original content length: ${directContent.length} bytes`);
    console.log(`Original content has segments: ${directContent.includes('scope3_segments')}`);
    
    // Step 2: Create a mock request that simulates a route match
    // This is what Cloudflare Workers would receive when a route pattern matches
    const mockRequest = new Request(`http://localhost:${port}`, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Test)',
        'Accept': 'text/html',
      }
    });
    
    // Step 3: Import the worker code and run it with the mock request
    const { fetch: workerFetch } = require('../src/index.js');
    const env = {
      SEGMENTS_CACHE: {
        get: async () => null,
        put: async () => {}
      },
      API_TIMEOUT: 1000,
      CACHE_TTL: 3600,
    };
    
    const ctx = {
      waitUntil: (promise) => promise,
    };
    
    // Call the worker's fetch function
    const workerResponse = await workerFetch(mockRequest, env, ctx);
    
    // Check the response
    const workerContent = await workerResponse.text();
    console.log(`Worker response status: ${workerResponse.status}`);
    console.log(`Worker content length: ${workerContent.length} bytes`);
    
    // Check cache headers
    console.log("\nCache Headers:");
    console.log(`X-HTML-Cache: ${workerResponse.headers.get('X-HTML-Cache') || 'not set'}`);
    console.log(`X-Cache-ETag: ${workerResponse.headers.get('X-Cache-ETag') || 'not set'}`);
    console.log(`X-Cache-Last-Modified: ${workerResponse.headers.get('X-Cache-Last-Modified') || 'not set'}`);
    console.log(`X-Cache-Age: ${workerResponse.headers.get('X-Cache-Age') || 'not set'}`);
    
    // Check if segments were injected
    const hasSegments = workerContent.includes('window.scope3_segments');
    console.log(`Worker content has segments: ${hasSegments}`);
    
    if (hasSegments) {
      // Try to extract the segments array
      const segmentsMatch = workerContent.match(/window\.scope3_segments\s*=\s*(\[.*?\]);/s);
      if (segmentsMatch && segmentsMatch[1]) {
        console.log(`Segments: ${segmentsMatch[1]}`);
      }
    }
    
    // Clean up
    testServer.close();
    
    return hasSegments;
  } catch (error) {
    console.error('Error in route handler test:', error);
    return false;
  }
}

// Run the tests
async function runTests() {
  try {
    const result = await testRouteHandlerMode();
    console.log(`\nRoute handler mode test ${result ? 'PASSED ✅' : 'FAILED ❌'}`);
    process.exit(result ? 0 : 1);
  } catch (error) {
    console.error('Test runner error:', error);
    process.exit(1);
  }
}

runTests();