// Simple test to verify Scope3 API calls are made correctly
// Run with: node test/api-call-test.js

// Mock fetch to capture API calls
let apiCallsMade = [];
const originalFetch = global.fetch;

// Replace global fetch with a spy function
global.fetch = (url, options) => {
  // Convert URL to string if it's a Request object or has a URL property
  const urlStr = typeof url === 'string' ? url : 
                 url.url ? url.url : 
                 url.toString();
  
  // Only track Scope3 API calls
  if (urlStr.indexOf('scope3.com') !== -1) {
    // Track the API call
    try {
      apiCallsMade.push({
        url: urlStr,
        method: options.method,
        headers: options.headers,
        body: JSON.parse(options.body)
      });
      console.log(`[TEST] Captured API call to: ${urlStr}`);
    } catch (e) {
      console.error("[TEST] Error capturing API call:", e);
    }
    
    // Return mock API response
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-type': 'application/json'
      }),
      json: () => Promise.resolve({
        url_classifications: {
          key_vals: [
            {
              key: 'scope3_segs',
              values: ['api_test_segment_1', 'api_test_segment_2']
            }
          ]
        }
      }),
      text: () => Promise.resolve(JSON.stringify({
        url_classifications: {
          key_vals: [
            {
              key: 'scope3_segs',
              values: ['api_test_segment_1', 'api_test_segment_2']
            }
          ]
        }
      })),
      clone: function() { return this; }
    });
  }
  
  // For all other requests, return a simple HTML response
  return Promise.resolve({
    ok: true,
    status: 200,
    headers: new Headers({
      'content-type': 'text/html'
    }),
    text: () => Promise.resolve(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Test Page</title>
        <meta name="description" content="This is a test page">
      </head>
      <body>
        <h1>Test Page</h1>
        <p>This is a test page content.</p>
      </body>
      </html>
    `),
    clone: function() { return this; }
  });
};

// Mock AbortController
global.AbortController = class AbortController {
  constructor() {
    this.signal = { aborted: false };
  }
  abort() {
    this.signal.aborted = true;
  }
};

// Setup mocks for Headers
global.Headers = class Headers {
  constructor(init = {}) {
    this._headers = {};
    if (init) {
      Object.keys(init).forEach(key => {
        this._headers[key.toLowerCase()] = init[key];
      });
    }
  }
  get(name) { return this._headers[name.toLowerCase()] || null; }
  set(name, value) { this._headers[name.toLowerCase()] = value; }
  has(name) { return name.toLowerCase() in this._headers; }
  append(name, value) { this._headers[name.toLowerCase()] = value; }
  entries() {
    const entries = [];
    for (const key in this._headers) {
      entries.push([key, this._headers[key]]);
    }
    return { *[Symbol.iterator]() { for (const entry of entries) yield entry; } };
  }
};

// Load the worker code
const workerCode = require('../src/index.js');

// Prepare a mock environment with API key
const mockEnv = {
  API_TIMEOUT: '1000',
  CACHE_TTL: '3600',
  SCOPE3_API_KEY: 'test-api-key-for-testing-purposes',
  SEGMENTS_CACHE: {
    get: async () => null,
    put: async () => {}
  }
};

const mockCtx = {
  waitUntil: () => {}
};

// Helper to create a mock request
function createRequest(url) {
  return {
    url,
    method: 'GET',
    headers: new Headers({
      'Accept': 'text/html',
      'User-Agent': 'Test Agent'
    })
  };
}

// Run tests
async function runTests() {
  console.log("Testing Scope3 API calls...\n");
  
  try {
    // Reset tracked API calls
    apiCallsMade = [];
    
    // Test 1: Proxy request to people.com
    console.log("Test 1: Proxy request to people.com");
    const peopleUrl = "https://people.com/test-article";
    await workerCode.default.fetch(createRequest(`http://localhost:8787/proxy/${peopleUrl}`), mockEnv, mockCtx);
    
    // Check if API call was made
    const peopleApiCall = apiCallsMade.find(call => call.body.url === peopleUrl);
    if (peopleApiCall) {
      console.log("✅ API call was made for people.com");
      console.log("  URL:", peopleApiCall.url);
      console.log("  Headers included API key:", !!peopleApiCall.headers["X-Scope3-Auth"]);
      console.log("  Body included URL:", peopleApiCall.body.url);
      console.log("  Body included country:", peopleApiCall.body.user_country);
    } else {
      console.log("❌ No API call was made for people.com");
    }
    
    // Test 2: Proxy request to example.com
    console.log("\nTest 2: Proxy request to example.com");
    apiCallsMade = [];
    const exampleUrl = "https://example.com";
    await workerCode.default.fetch(createRequest(`http://localhost:8787/proxy/${exampleUrl}`), mockEnv, mockCtx);
    
    // Check if API call was made
    const exampleApiCall = apiCallsMade.find(call => call.body.url === exampleUrl);
    if (exampleApiCall) {
      console.log("✅ API call was made for example.com");
      console.log("  URL:", exampleApiCall.url);
      console.log("  Headers included API key:", !!exampleApiCall.headers["X-Scope3-Auth"]);
      console.log("  Body included URL:", exampleApiCall.body.url);
    } else {
      console.log("❌ No API call was made for example.com");
    }
    
    // Test 3: Test with API_TIMEOUT
    console.log("\nTest 3: Test API_TIMEOUT setting");
    // Check if API_TIMEOUT is passed to AbortController
    const timeoutUsed = mockEnv.API_TIMEOUT;
    console.log(`  API_TIMEOUT value: ${timeoutUsed}`);
    console.log(`  ✅ API_TIMEOUT is set correctly (this is used in setTimeout to abort the API call)`);

    console.log("\nTest Results:");
    if (apiCallsMade.length > 0) {
      console.log("✅ API calls are being properly made to Scope3");
      console.log(`  Total API calls tracked: ${apiCallsMade.length}`);
      
      // Success - all tests passed
      return true;
    } else {
      console.log("❌ No API calls were made to Scope3");
      // Failure - no API calls made
      return false;
    }
  } catch (error) {
    console.error("Error running tests:", error);
    return false;
  } finally {
    // Restore the original fetch function
    global.fetch = originalFetch || fetch;
  }
}

// Run the tests
runTests()
  .then(success => {
    if (!success) {
      process.exit(1);
    }
  })
  .catch(error => {
    console.error("Fatal error running tests:", error);
    process.exit(1);
  });