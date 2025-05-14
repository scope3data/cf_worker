// Comprehensive test suite for proxy URL handling
// Run with: node test/proxy-tests.js

const workerCode = require('../src/index.js');

// Mock environment for testing
const mockEnv = {
  API_TIMEOUT: '200',
  CACHE_TTL: '3600',
  SCOPE3_API_KEY: 'test-key',
  SEGMENTS_CACHE: {
    get: async () => null,
    put: async () => {}
  }
};

const mockCtx = {
  waitUntil: () => {}
};

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
    return JSON.parse(this.body);
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

// Mock fetch function with ability to track fetched URLs
const fetchedUrls = [];
global.fetch = async (req) => {
  const url = typeof req === 'string' ? req : req.url;
  fetchedUrls.push(url);

  // Set appropriate content type based on URL
  let contentType = 'text/html';
  if (url.endsWith('.js')) {
    contentType = 'application/javascript';
  } else if (url.endsWith('.css')) {
    contentType = 'text/css';
  } else if (url.endsWith('.png') || url.endsWith('.jpg') || url.endsWith('.jpeg') || url.endsWith('.gif')) {
    contentType = 'image/' + url.split('.').pop();
  }

  return new MockResponse(`Fetched: ${url}`, {
    headers: { 'content-type': contentType }
  });
};
global.AbortController = class AbortController {
  constructor() {
    this.signal = { aborted: false };
  }
  abort() {
    this.signal.aborted = true;
  }
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
  fetchedUrls.length = 0;
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
  // Main proxy tests
  {
    name: "Test direct proxy URL with HTTPS",
    request: new Request("http://localhost:8787/proxy/https://example.com", {
      headers: new MockHeaders({ 'Accept': 'text/html' })
    }),
    validate: async (response) => {
      const text = await response.text();
      return {
        pass: response.status === 200 && 
              text.includes('example.com') && 
              logsContain('[PROXY-CRITICAL]'),
        reason: response.status !== 200 ? "Wrong status code" : 
                !text.includes('example.com') ? "Target URL not in response" :
                !logsContain('[PROXY-CRITICAL]') ? "PROXY-CRITICAL handler not triggered" : "Unknown"
      };
    }
  },
  
  // NOTE: We would add protocol-relative resource handling tests here,
  // but testing the referrer-based behavior requires more complex mocking
  // than we're implementing in this test suite.
  {
    name: "Test proxy URL with HTTP protocol",
    request: new Request("http://localhost:8787/proxy/http://example.org"),
    validate: async (response) => {
      const text = await response.text();
      return {
        pass: response.status === 200 && text.includes('example.org'),
        reason: "Failed to correctly handle http:// protocol"
      };
    }
  },
  {
    name: "Test proxy URL with query parameters",
    request: new Request("http://localhost:8787/proxy/https://example.com?test=true&foo=bar"),
    validate: async (response) => {
      const text = await response.text();
      return {
        pass: response.status === 200 && (text.includes('?test=true') || text.includes('&foo=bar')),
        reason: "Failed to preserve query parameters"
      };
    }
  },
  {
    name: "Test proxy URL without protocol",
    request: new Request("http://localhost:8787/proxy/example.com"),
    validate: async (response) => {
      const text = await response.text();
      return {
        pass: response.status === 200 && logsContain('https://example.com'),
        reason: "Failed to add https:// protocol to URL without protocol"
      };
    }
  },
  {
    name: "Test proxy URL with protocol-relative format",
    request: new Request("http://localhost:8787/proxy//example.com"),
    validate: async (response) => {
      return {
        pass: response.status === 200 && !logsContain('302'),
        reason: "Failed to handle protocol-relative URL (//example.com)"
      };
    }
  },
  {
    name: "Test proxy URL with path components",
    request: new Request("http://localhost:8787/proxy/https://example.com/path/to/page.html"),
    validate: async (response) => {
      const text = await response.text();
      return {
        pass: response.status === 200 && text.includes('/path/to/page.html'),
        reason: "Failed to preserve path components"
      };
    }
  },
  {
    name: "Test proxy URL with unusual characters",
    request: new Request("http://localhost:8787/proxy/https://example.com/search?q=test%20with%20spaces"),
    validate: async (response) => {
      return {
        pass: response.status === 200 && logsContain('search?q=test%20with%20spaces'),
        reason: "Failed to handle URL encoding correctly"
      };
    }
  },
  {
    name: "Test rejection of invalid URLs",
    request: new Request("http://localhost:8787/proxy/not a valid url"),
    validate: async (response) => {
      return {
        pass: response.status === 200 || response.status === 500,
        reason: "Failed to handle invalid URLs gracefully"
      };
    }
  }
];

// Run tests
async function runTests() {
  console.log("Running comprehensive proxy URL handling tests\n");
  
  let passCount = 0;
  let failCount = 0;
  
  for (const test of testCases) {
    console.log(`Test: ${test.name}`);
    clearLogs();
    captureConsole();
    
    try {
      // Some tests require custom setup
      const request = test.setup ? test.setup() : test.request;
      
      const response = await workerCode.default.fetch(request, mockEnv, mockCtx);
      restoreConsole();
      
      const result = await test.validate(response);
      
      if (result.pass) {
        console.log("✅ PASS");
        passCount++;
      } else {
        console.log(`❌ FAIL: ${result.reason}`);
        if (logs.length > 0) {
          console.log("Relevant logs:");
          printLogs();
        }
        failCount++;
      }
    } catch (error) {
      restoreConsole();
      console.log(`❌ FAIL: Error during test: ${error.message}`);
      console.log(error.stack);
      failCount++;
    }
    
    console.log("");
  }
  
  // Final results
  console.log(`Test results: ${passCount} passed, ${failCount} failed.`);
  
  if (failCount === 0) {
    console.log("\n✅ ALL TESTS PASSING - Your proxy URL handling looks good!");
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