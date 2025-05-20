// Comprehensive test suite for scope3-segments-worker index.js
// Run with: node test/index-test.js

// Import the worker module directly as ES module
import * as workerModule from '../src/index.js';
import { mockApiResponse } from './mock-response.js';

// Mock environment for testing
const mockEnv = {
  API_TIMEOUT: '200',
  CACHE_TTL: '3600',
  SCOPE3_API_KEY: 'test-key',
  SEGMENTS_CACHE: {
    get: async (key, options) => {
      console.log(`[MOCK] Cache get for key: ${key}`);
      return null; // Always miss cache by default
    },
    put: async (key, value, options) => {
      console.log(`[MOCK] Cache put for key: ${key}`);
    }
  }
};

const mockCtx = {
  waitUntil: () => {}
};

// Track all fetch calls
const fetchCalls = [];

// Mock Response class
class MockResponse {
  constructor(body, init = {}) {
    this.body = body;
    this.status = init.status || 200;
    this.statusText = init.statusText || 'OK';
    this.headers = new MockHeaders(init.headers || {});
    this.url = init.url || '';
  }

  async text() {
    return this.body;
  }

  async json() {
    try {
      return JSON.parse(this.body);
    } catch (e) {
      console.error('Error parsing JSON in mock response:', e);
      return {};
    }
  }

  clone() {
    return new MockResponse(this.body, {
      status: this.status,
      statusText: this.statusText,
      headers: this.headers,
      url: this.url
    });
  }
}

// Mock Headers class
class MockHeaders {
  constructor(init = {}) {
    this._headers = {};
    if (init) {
      Object.keys(init).forEach(key => {
        this._headers[key.toLowerCase()] = init[key];
      });
    }
  }

  get(name) {
    return this._headers[name.toLowerCase()] || null;
  }

  set(name, value) {
    this._headers[name.toLowerCase()] = value;
  }

  has(name) {
    return name.toLowerCase() in this._headers;
  }

  append(name, value) {
    this._headers[name.toLowerCase()] = value;
  }

  entries() {
    const entries = [];
    for (const key in this._headers) {
      entries.push([key, this._headers[key]]);
    }
    return {
      *[Symbol.iterator]() {
        for (const entry of entries) {
          yield entry;
        }
      }
    };
  }
}

// Setup mocks
global.Response = MockResponse;
global.Headers = MockHeaders;

// Mock Cloudflare's cache
global.caches = {
  default: {
    match: async (request) => {
      console.log(`[MOCK-CACHE] Cache match for URL: ${request.url}`);
      return null; // Always cache miss for tests
    },
    put: async (request, response) => {
      console.log(`[MOCK-CACHE] Cache put for URL: ${request.url}`);
      return null;
    }
  }
};

// Default fetch implementation that tracks calls
const originalFetch = global.fetch;
global.fetch = async (req, init) => {
  const url = typeof req === 'string' ? req : req.url;
  const method = init?.method || 'GET';
  
  // Track the fetch call
  fetchCalls.push({
    url,
    method,
    headers: init?.headers || {},
    body: init?.body || null
  });
  
  // Log fetch call
  console.log(`[MOCK-FETCH] ${method} ${url}`);
  
  // Mock a successful response from the Scope3 API
  if (url.includes('scope3.com')) {
    console.log(`[MOCK-API] Simulating Scope3 API response`);
    // Create a valid OpenRTB response with global segments for ID=1
    const mockSegments = ["api_segment_1", "api_segment_2", "test_content"];
    const segmentObjects = mockSegments.map(id => ({ id }));
    
    return new MockResponse(JSON.stringify({
      data: [
        {
          destination: "triplelift.com",
          imp: [
            {
              id: "1",
              ext: {
                scope3: {
                  segments: segmentObjects
                }
              }
            }
          ]
        }
      ]
    }), {
      headers: { 'content-type': 'application/json' },
      status: 200
    });
  }
  
  // Mock HTML response
  const isHtml = !url.match(/\.(js|css|png|jpe?g|gif|svg|webp|mp4|webm|mp3|wav|pdf|json|xml|woff2?|ttf|otf)$/i);
  
  if (isHtml) {
    return new MockResponse(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Test Page for ${url}</title>
        <meta name="description" content="This is a test page">
      </head>
      <body>
        <h1>Test Page for ${url}</h1>
        <p>This is a test page content for ${url}.</p>
        <a href="https://example.com/link1">Link 1</a>
        <a href="https://example.com/link2">Link 2</a>
        <a href="/relative-link">Relative Link</a>
        <script src="/script.js"></script>
        <link rel="stylesheet" href="/styles.css">
        <img src="/image.jpg">
      </body>
      </html>
    `, {
      headers: { 
        'content-type': 'text/html',
        'etag': `"mock-etag-${Date.now()}"`,
        'last-modified': new Date().toUTCString()
      }
    });
  }
  
  // Mock resource response
  return new MockResponse('Mock resource content', {
    headers: { 'content-type': 'application/octet-stream' }
  });
};

// Mock console to capture logs
const originalConsole = { ...console };
const logs = [];

function captureConsole() {
  console.log = (...args) => {
    logs.push(args.join(' '));
    // Uncomment to see logs in real-time
    // originalConsole.log(...args);
  };
  console.error = (...args) => {
    logs.push('ERROR: ' + args.join(' '));
    // Uncomment to see errors in real-time
    // originalConsole.error(...args);
  };
}

function restoreConsole() {
  console.log = originalConsole.log;
  console.error = originalConsole.error;
}

function clearLogs() {
  logs.length = 0;
}

function clearFetchCalls() {
  fetchCalls.length = 0;
}

function printLogs() {
  for (const log of logs) {
    originalConsole.log(log);
  }
}

// Helper to check if logs contain a string
function logsContain(str) {
  return logs.some(log => log.includes(str));
}

// Test cases
const testCases = [
  {
    name: "Test direct URL handling",
    request: new Request("https://example.com/page"),
    validate: async (response) => {
      const body = await response.text();
      const fetchCallUrls = fetchCalls.map(call => call.url);
      
      return {
        pass: 
          response.status === 200 && 
          body.includes('window.scope3') && 
          body.includes('segments') && 
          fetchCallUrls.includes('https://example.com/page'),
        details: {
          body: body.substring(0, 100) + '...',
          fetchCalls: fetchCallUrls
        }
      };
    }
  },
  {
    name: "Test proxy URL handling",
    request: new Request("https://worker.example/proxy/https://target-site.com/page"),
    validate: async (response) => {
      const body = await response.text();
      const hasBaseTag = body.includes('<base href=https://target-site.com/>');
      const hasSegments = body.includes('window.scope3');
      
      return {
        pass: response.status === 200 && hasBaseTag && hasSegments,
        details: {
          hasBaseTag,
          hasSegments,
          body: body.substring(0, 100) + '...'
        }
      };
    }
  },
  {
    name: "Test resource request bypassing",
    request: new Request("https://example.com/script.js"),
    validate: async (response) => {
      const body = await response.text();
      
      return {
        pass: 
          response.status === 200 && 
          body === 'Mock resource content' && 
          !body.includes('window.scope3'),
        details: {
          body,
          contentType: response.headers.get('content-type')
        }
      };
    }
  },
  {
    name: "Test segment injection",
    request: new Request("https://example.com/test-segments"),
    validate: async (response) => {
      const body = await response.text();
      const hasApiSegments = body.includes('"api_segment_1"') && 
                            body.includes('"api_segment_2"');
      const hasStructuredFormat = body.includes('"global":') || 
                                 body.includes('"1":');
      
      return {
        pass: response.status === 200 && hasApiSegments && hasStructuredFormat,
        details: {
          hasApiSegments,
          hasStructuredFormat,
          segmentMatch: body.match(/window\.scope3\s*=\s*window\.scope3\s*\|\|\s*{};[\s\S]*?window\.scope3\.segments\s*=\s*({.*?});/)?.[1] || 'No segments found'
        }
      };
    }
  },
  {
    name: "Test API call with correct parameters",
    request: new Request("https://example.com/test-api-params"),
    validate: async (response) => {
      const apiCalls = fetchCalls.filter(call => call.url.includes('scope3.com'));
      
      if (apiCalls.length === 0) {
        return {
          pass: false,
          details: {
            error: "No API calls made",
            fetchCalls
          }
        };
      }
      
      const apiCall = apiCalls[0];
      const apiBody = typeof apiCall.body === 'string' ? JSON.parse(apiCall.body) : {};
      
      return {
        pass: 
          apiCall.method === 'POST' && 
          apiCall.headers['Content-Type'] === 'application/json' &&
          apiCall.headers['x-scope3-auth'] === 'test-key' &&
          apiBody.site &&
          apiBody.site.page && 
          apiBody.imp && 
          Array.isArray(apiBody.imp),
        details: {
          apiCall,
          apiBody
        }
      };
    }
  },
  {
    name: "Test segment generation with direct passing",
    request: new Request("https://example.com/segment-test"),
    validate: async (response) => {
      const body = await response.text();
      const hasSegments = body.includes('window.scope3.segments');
      const hasApiSegments = body.includes('"api_segment_1"');
      const hasStructuredFormat = body.includes('"global":') || 
                               body.includes('"1":');
      
      return {
        pass: response.status === 200 && hasSegments && hasApiSegments && hasStructuredFormat,
        details: {
          hasSegments,
          hasApiSegments,
          hasStructuredFormat,
          bodyPreview: body.substring(0, 100) + '...'
        }
      };
    }
  }
];

// Run tests
async function runTests() {
  console.log("Running scope3-segments-worker tests\n");
  console.log(`Worker module imported successfully.`);
  
  let passCount = 0;
  let failCount = 0;
  
  for (const test of testCases) {
    console.log(`Test: ${test.name}`);
    captureConsole();
    clearLogs();
    clearFetchCalls();
    
    try {
      // Get worker fetch handler
      const fetchHandler = workerModule.default.fetch;
      
      if (!fetchHandler) {
        throw new Error('Could not find fetch handler in worker module');
      }
      
      // Directly call the worker's fetch handler
      const response = await fetchHandler(test.request, mockEnv, mockCtx);
      
      // Validate the response
      const result = await test.validate(response);
      
      if (result.pass) {
        console.log("✅ PASS");
        console.log(`Details: ${JSON.stringify(result.details, null, 2)}`);
        passCount++;
      } else {
        console.log(`❌ FAIL`);
        console.log(`Expected behavior not observed`);
        console.log(`Details: ${JSON.stringify(result.details, null, 2)}`);
        console.log("Relevant logs:");
        printLogs();
        failCount++;
      }
    } catch (error) {
      console.log(`❌ FAIL: Error during test: ${error.message}`);
      console.log(error.stack);
      failCount++;
    } finally {
      restoreConsole();
    }
    
    console.log("");
  }
  
  // Final results
  console.log(`Test results: ${passCount} passed, ${failCount} failed.`);
  
  if (failCount === 0) {
    console.log("\n✅ ALL TESTS PASSING - Your scope3-segments-worker is functioning correctly!");
    return true;
  } else {
    console.log("\n❌ SOME TESTS FAILED - Check the errors above to fix remaining issues.");
    return false;
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