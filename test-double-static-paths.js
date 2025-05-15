/**
 * Test for double static path detection and redirection
 */
const doubleStaticPathTest = () => {
  // Test cases with different double static patterns
  const testCases = [
    {
      desc: "Simple double static path",
      url: "http://localhost:8787/static/static/cache/script.js",
      expected: "https://people.com/static/cache/script.js"
    },
    {
      desc: "Double static with version number",
      url: "http://localhost:8787/static/3.73.0/static/cache/script.js",
      expected: "https://people.com/static/cache/script.js"
    },
    {
      desc: "Complex URL with double static and version",
      url: "http://localhost:8787/static/3.73.0/static/cache/eNqllsFu2zAMhl9oQbACe4BsS4sAC9o12e6yRLtsZFGgqMTe049Ji2GXAaZ2si3wIylS5q91ESfo1yOFGqGsu5rC9fla1pmhw6AvAYu8f608MXxYL4VcjHTZeMEzCkIxgFI2ycVZjcsmuCzAy2FPKYGXXTjMRWA0gQWS7F1yA4z6dvS9gWYUIHvUAF0dBkyDAenzJhyAz8A_MQAtJwdIwOjbi4uuPEt4YjprYAsXPtlLoyGSoMzfMJ3sdMQz7JKoCzubnct4T_yQxQhZzJEbMrt9vTX_MwZzA7O2H-4jERv-x1y795YHe8YsYX-zWY6UF8ctocT3XygJU1zOVAx39kg1YY8tKdYC2nXDKMw5wVRLS69xajohtRuvli0s1w51jLagIqEJY8wRIvbSQlOG1FQk_1LTySiHAwOE2aIooIZnWDEkHbbAK13O0RlcuHYVHfN_KKehKFl-CMZiUj8jMY3RSBT8BUZE58jHLQYbcWcj_pY0Q3cq6wnys3FDF3Cng5hOOLF0OoBVmmwTpyvbSXdVUM-R4dfHEajK9wrVkmP3qrfDh-rYUMJAo8P0qBtjFcEjPRPJ19vach8nmC_ElnbfhoxdKox99k5gIJ6P7FKJylDaqyvTjVSubE88Pjl2ozWDqyYe5uStib9d9DXfXeoNl-DK_xgHfyy3E_h6dfwb0WUHPg.js",
      expected: "https://people.com/static/cache/eNqllsFu2zAMhl9oQbACe4BsS4sAC9o12e6yRLtsZFGgqMTe049Ji2GXAaZ2si3wIylS5q91ESfo1yOFGqGsu5rC9fla1pmhw6AvAYu8f608MXxYL4VcjHTZeMEzCkIxgFI2ycVZjcsmuCzAy2FPKYGXXTjMRWA0gQWS7F1yA4z6dvS9gWYUIHvUAF0dBkyDAenzJhyAz8A_MQAtJwdIwOjbi4uuPEt4YjprYAsXPtlLoyGSoMzfMJ3sdMQz7JKoCzubnct4T_yQxQhZzJEbMrt9vTX_MwZzA7O2H-4jERv-x1y795YHe8YsYX-zWY6UF8ctocT3XygJU1zOVAx39kg1YY8tKdYC2nXDKMw5wVRLS69xajohtRuvli0s1w51jLagIqEJY8wRIvbSQlOG1FQk_1LTySiHAwOE2aIooIZnWDEkHbbAK13O0RlcuHYVHfN_KKehKFl-CMZiUj8jMY3RSBT8BUZE58jHLQYbcWcj_pY0Q3cq6wnys3FDF3Cng5hOOLF0OoBVmmwTpyvbSXdVUM-R4dfHEajK9wrVkmP3qrfDh-rYUMJAo8P0qBtjFcEjPRPJ19vach8nmC_ElnbfhoxdKox99k5gIJ6P7FKJylDaqyvTjVSubE88Pjl2ozWDqyYe5uStib9d9DXfXeoNl-DK_xgHfyy3E_h6dfwb0WUHPg.js"
    },
    {
      desc: "URL with query parameters",
      url: "http://localhost:8787/static/3.73.0/static/js/main.js?v=123",
      expected: "https://people.com/static/js/main.js?v=123"
    }
  ];

  // Test regex patterns used in the handler
  console.log("=== Testing regex patterns ===");
  const doubleStaticRegex = /\/static\/([^\/]+\/)?static\//;
  
  testCases.forEach(testCase => {
    const url = new URL(testCase.url);
    console.log(`\nTesting: ${testCase.desc}`);
    console.log(`URL: ${testCase.url}`);
    console.log(`Path: ${url.pathname}`);
    
    if (doubleStaticRegex.test(url.pathname)) {
      console.log(`✓ Regex matched the double static pattern`);
      
      // Test the replacement
      const correctedPath = url.pathname.replace(doubleStaticRegex, '/static/');
      console.log(`Corrected path: ${correctedPath}`);
      
      // Build the corrected URL
      const correctedUrl = `https://people.com${correctedPath}${url.search}`;
      console.log(`Corrected URL: ${correctedUrl}`);
      
      // Verify the expected result
      if (correctedUrl === testCase.expected) {
        console.log(`✓ Result matches expected output`);
      } else {
        console.log(`✗ Result does not match expected output`);
        console.log(`  Expected: ${testCase.expected}`);
        console.log(`  Got: ${correctedUrl}`);
      }
    } else {
      console.log(`✗ Regex did not match the double static pattern`);
    }
  });
};

// Run the test
doubleStaticPathTest();