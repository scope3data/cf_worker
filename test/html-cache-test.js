/**
 * HTML Cache Tests
 * This file tests the HTML caching functionality with change detection
 */

const htmlCache = require('../src/html-cache');

// Mock environment for testing
const mockEnv = {
  HTML_CACHE: {
    get: async (key, options) => {
      console.log(`Mock KV get: ${key}`);
      if (mockCache[key]) {
        return options && options.type === 'json' ? JSON.parse(mockCache[key]) : mockCache[key];
      }
      return null;
    },
    put: async (key, value, options) => {
      console.log(`Mock KV put: ${key}`);
      mockCache[key] = value;
      return true;
    }
  },
  HTML_CACHE_TTL: '86400'
};

// Mock cache storage
const mockCache = {};

// Mock response with headers
function createMockResponse(status, headers = {}, body = '') {
  const mockHeaders = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    mockHeaders.set(key, value);
  }
  
  return new Response(body, {
    status: status,
    headers: mockHeaders
  });
}

// Test caching HTML content
async function testHtmlCaching() {
  console.log('\nTesting HTML Caching...');
  console.log('=======================');

  const testUrl = 'https://example.com/test-page';
  const testHtml = '<html><body>Test content</body></html>';
  
  // Create a mock response with ETag
  const mockResponse = createMockResponse(200, {
    'etag': 'W/"123456"',
    'last-modified': new Date().toUTCString(),
    'content-type': 'text/html'
  }, testHtml);
  
  try {
    // Test caching HTML
    console.log('1. Caching HTML content...');
    await htmlCache.cacheHtml(testUrl, testHtml, mockResponse, mockEnv);
    
    // Test retrieving cached HTML
    console.log('\n2. Retrieving cached HTML...');
    const cachedData = await htmlCache.getCachedHtml(testUrl, mockEnv);
    
    if (cachedData && cachedData.html === testHtml) {
      console.log('✓ Successfully retrieved cached HTML');
    } else {
      console.log('✗ Failed to retrieve cached HTML');
      console.log('Expected:', testHtml);
      console.log('Actual:', cachedData ? cachedData.html : 'null');
    }
    
    return cachedData && cachedData.html === testHtml;
  } catch (error) {
    console.error('Error in HTML caching test:', error);
    return false;
  }
}

// Test conditional fetching with ETag
async function testConditionalFetch() {
  console.log('\nTesting Conditional Fetch...');
  console.log('===========================');
  
  const testUrl = 'https://example.com/conditional-test';
  const testHtml = '<html><body>Conditional test content</body></html>';
  const etagValue = 'W/"abcdef"';
  
  // Create a mock cached data entry with validation info
  const cachedData = {
    html: testHtml,
    url: testUrl,
    timestamp: Date.now(),
    validation: {
      etag: etagValue,
      lastModified: new Date().toUTCString()
    }
  };
  
  // Store in mock cache
  mockCache[`html:example.com/conditional-test`] = JSON.stringify(cachedData);
  
  // Override global fetch for this test
  const originalFetch = global.fetch;
  global.fetch = async (request) => {
    console.log(`Mock fetch called for ${request.url}`);
    console.log('Request headers:', Object.fromEntries(request.headers.entries()));
    
    // Check if the request has the If-None-Match header with our ETag
    const ifNoneMatch = request.headers.get('if-none-match');
    
    if (ifNoneMatch && ifNoneMatch === etagValue) {
      console.log('ETag matched, returning 304 Not Modified');
      return createMockResponse(304, {
        'etag': etagValue
      });
    } else {
      console.log('ETag did not match, returning new content');
      return createMockResponse(200, {
        'etag': 'W/"newetag"',
        'content-type': 'text/html'
      }, '<html><body>New content</body></html>');
    }
  };
  
  try {
    // Test the conditional fetch
    console.log('\nPerforming conditional fetch...');
    const fetchResult = await htmlCache.getHtmlWithCache(testUrl, null, mockEnv);
    
    // Restore original fetch
    global.fetch = originalFetch;
    
    // Check the result
    const success = fetchResult.notModified === true && fetchResult.fromCache === true;
    console.log('Fetch result:', {
      fromCache: fetchResult.fromCache,
      notModified: fetchResult.notModified,
      htmlLength: fetchResult.html.length
    });
    
    if (success) {
      console.log('✓ Successfully used conditional fetch and returned cached content');
    } else {
      console.log('✗ Conditional fetch test failed');
    }
    
    return success;
  } catch (error) {
    // Restore original fetch in case of error
    global.fetch = originalFetch;
    console.error('Error in conditional fetch test:', error);
    return false;
  }
}

// Run all tests
async function runTests() {
  try {
    const cachingResult = await testHtmlCaching();
    const conditionalResult = await testConditionalFetch();
    
    console.log('\nTest Results:');
    console.log('=============');
    console.log(`HTML Caching: ${cachingResult ? '✓ PASSED' : '✗ FAILED'}`);
    console.log(`Conditional Fetch: ${conditionalResult ? '✓ PASSED' : '✗ FAILED'}`);
    
    const allPassed = cachingResult && conditionalResult;
    console.log(`\nOverall Result: ${allPassed ? '✓ ALL TESTS PASSED' : '✗ SOME TESTS FAILED'}`);
    
    process.exit(allPassed ? 0 : 1);
  } catch (error) {
    console.error('Error running tests:', error);
    process.exit(1);
  }
}

runTests();