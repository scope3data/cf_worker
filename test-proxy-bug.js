// Simple test to reproduce the proxy URL redirection bug
// Run with: node test-proxy-bug.js

// Import the worker code
const workerCode = require('./src/index.js');

// Mock environment for testing
const mockEnv = {
  API_TIMEOUT: '200',
  CACHE_TTL: '3600',
  SCOPE3_API_KEY: 'test-key'
};

const mockCtx = {
  waitUntil: () => {}
};

// Mock Response class with redirect support
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

  clone() {
    return new MockResponse(this.body, {
      status: this.status,
      statusText: this.statusText,
      headers: this.headers,
      url: this.url
    });
  }

  static redirect(url, status = 302) {
    const response = new MockResponse('', {
      status: status,
      headers: { 'Location': url }
    });
    return response;
  }
}

// Mock Headers class for testing
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

// Mock fetch function that just returns a simple response
const mockFetch = async (req) => {
  return new MockResponse(`Fetched: ${req.url}`, {
    headers: { 'content-type': 'text/html' }
  });
};

// Override global objects with our mocks
global.Response = MockResponse;
global.Headers = MockHeaders;
global.fetch = mockFetch;
global.AbortController = class AbortController {
  constructor() {
    this.signal = { aborted: false };
  }

  abort() {
    this.signal.aborted = true;
  }
};

// Debug function to print redirects
function logRedirect(response) {
  if (response.status === 302 || response.status === 301) {
    const location = response.headers.get('location');
    console.log(`⚠️ REDIRECT DETECTED: ${response.status} -> ${location}`);
    return true;
  }
  return false;
}

// Test function
async function testProxyUrl() {
  console.log("Testing proxy URL handling");
  console.log("=========================\n");

  // Create the request exactly as it would look from the browser
  const url = "http://localhost:8787/proxy/https://example.com";
  console.log(`Test URL: ${url}`);
  
  const request = {
    url: url,
    method: 'GET',
    headers: new MockHeaders({
      'Host': 'localhost:8787',
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'text/html'
    })
  };

  // Add URL parsing capabilities similar to the Request object
  request.parsedUrl = new URL(url);

  // Debug the URL parts
  console.log(`URL breakdown:`);
  console.log(` - protocol: ${request.parsedUrl.protocol}`);
  console.log(` - host: ${request.parsedUrl.host}`);
  console.log(` - pathname: ${request.parsedUrl.pathname}`);
  console.log(` - search: ${request.parsedUrl.search}`);
  console.log();

  // Debug logging to see how pathname is being processed
  const pathnameParts = request.parsedUrl.pathname.split('/');
  console.log("Pathname parts:");
  pathnameParts.forEach((part, i) => {
    console.log(` - [${i}]: "${part}"`);
  });
  console.log();

  // Trace through the worker's URL handling logic
  console.log("URL handling logic trace:");
  
  // Does it match the pattern for protocol-relative URLs?
  const startsWithDoubleSlash = request.parsedUrl.pathname.startsWith('//');
  console.log(` - pathname starts with //: ${startsWithDoubleSlash}`);
  
  // Check for proxy path specifically
  const startsWithProxy = request.parsedUrl.pathname.startsWith('/proxy/');
  console.log(` - pathname starts with /proxy/: ${startsWithProxy}`);
  
  // Extract the target part
  const targetPath = startsWithProxy ? request.parsedUrl.pathname.slice(7) : null;
  console.log(` - target path: ${targetPath}`);
  console.log();

  console.log("Calling worker handler...");
  const response = await workerCode.default.fetch(request, mockEnv, mockCtx);
  
  console.log(`Response status: ${response.status}`);
  
  if (logRedirect(response)) {
    console.log("TEST FAILED: Worker redirected instead of proxying");
  } else {
    console.log("Response body: ", await response.text());
    console.log("TEST PASSED: Worker handled proxy request correctly");
  }
}

// Run the test
testProxyUrl().catch(error => {
  console.error("Error running test:", error);
});