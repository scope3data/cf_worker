// Simple test harness for proxy URL handling
// Run with: node test-proxy.js

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

// Mock fetch function
global.fetch = async (req) => {
  return new Response(`Fetched: ${req.url}`, {
    headers: { 'content-type': 'text/html' }
  });
};

// Response class for testing
global.Response = class Response {
  constructor(body, init = {}) {
    this.body = body;
    this.status = init.status || 200;
    this.statusText = init.statusText || 'OK';
    this.headers = new Headers(init.headers || {});
    this.url = init.url || '';
  }

  async text() {
    return this.body;
  }

  clone() {
    return new Response(this.body, {
      status: this.status,
      statusText: this.statusText,
      headers: this.headers,
      url: this.url
    });
  }
};

// Headers class for testing
global.Headers = class Headers {
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
};

// AbortController mock for testing
global.AbortController = class AbortController {
  constructor() {
    this.signal = { aborted: false };
  }

  abort() {
    this.signal.aborted = true;
  }
};

// URL class is already available in Node.js

// Test cases
const testCases = [
  {
    name: "Test direct proxy URL",
    request: new Request("http://localhost:8787/proxy/https://example.com"),
    expectUrlContains: "example.com",
    expectStatusCode: 200
  },
  {
    name: "Test proxy URL with query parameters",
    request: new Request("http://localhost:8787/proxy/https://example.com?test=true"),
    expectUrlContains: "example.com?test=true",
    expectStatusCode: 200
  },
  {
    name: "Test proxy URL without protocol",
    request: new Request("http://localhost:8787/proxy/example.com"),
    expectUrlContains: "example.com",
    expectStatusCode: 200
  },
  {
    name: "Test proxy URL with protocol-relative format",
    request: new Request("http://localhost:8787/proxy//example.com"),
    expectUrlContains: "example.com",
    expectStatusCode: 200
  }
];

// Run tests
async function runTests() {
  console.log("Running proxy URL handling tests...\n");
  
  let passCount = 0;
  let failCount = 0;
  
  for (const test of testCases) {
    console.log(`Test: ${test.name}`);
    try {
      const response = await workerCode.default.fetch(test.request, mockEnv, mockCtx);
      
      // Check status code if expected
      if (test.expectStatusCode && response.status !== test.expectStatusCode) {
        console.log(`❌ FAIL: Expected status ${test.expectStatusCode}, got ${response.status}`);
        failCount++;
        continue;
      }
      
      // Check for redirects
      if (response.status === 302) {
        const redirectUrl = response.headers.get('location');
        if (redirectUrl && redirectUrl.includes('proxy/https')) {
          console.log(`❌ FAIL: Got incorrect redirect to: ${redirectUrl}`);
          failCount++;
          continue;
        }
      }
      
      // Check response body for expected URL if needed
      if (test.expectUrlContains) {
        const text = await response.text();
        if (!text.includes(test.expectUrlContains)) {
          console.log(`❌ FAIL: Response doesn't contain expected URL part: ${test.expectUrlContains}`);
          console.log(`Response body: ${text}`);
          failCount++;
          continue;
        }
      }
      
      console.log("✅ PASS");
      passCount++;
    } catch (error) {
      console.log(`❌ FAIL: Error during test: ${error.message}`);
      failCount++;
    }
    console.log("");
  }
  
  console.log(`Test results: ${passCount} passed, ${failCount} failed.`);
}

// Run the tests
runTests().catch(error => {
  console.error("Error running tests:", error);
});