/**
 * Ultra simple debug worker for testing Scope3 API integration
 */

// Configuration
const SCOPE3_API_ENDPOINT = 'https://rtdp.scope3.com/publishers/qa';
const API_TIMEOUT = 10000; // 10 seconds for testing

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    console.log(`[REQUEST] ${request.method} ${url.pathname}`);
    
    // Simple hello world endpoint
    if (url.pathname === '/hello') {
      return new Response(JSON.stringify({
        message: 'Hello World!',
        timestamp: new Date().toISOString()
      }, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Environment info endpoint
    if (url.pathname === '/env') {
      return new Response(JSON.stringify({
        environment: {
          variables: Object.keys(env),
          api_key_available: !!env.SCOPE3_API_KEY,
          api_timeout: env.API_TIMEOUT || API_TIMEOUT
        },
        timestamp: new Date().toISOString()
      }, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Dedicated API test endpoint
    if (url.pathname === '/api-test') {
      const targetUrl = url.searchParams.get('url') || 'https://example.com';
      console.log(`[SCOPE3] Testing API with URL: ${targetUrl}`);
      
      try {
        // Create minimal payload - simplified based on the example
        const payload = {
          user_country: "US",
          url: targetUrl
        };
        
        // Check for API key
        const apiKey = env.SCOPE3_API_KEY;
        console.log(`[SCOPE3] API key available: ${!!apiKey}`);
        
        // Call the API with timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);
        
        const response = await fetch(SCOPE3_API_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey && { 'X-Scope3-Auth': apiKey })
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        // Log response info
        console.log(`[SCOPE3] API response status: ${response.status}`);
        
        // Return the API response
        const data = await response.json();

        // Extract segments from the response based on the example format
        let segments = [];
        if (data.url_classifications && data.url_classifications.key_vals) {
          const segmentKeyVal = data.url_classifications.key_vals.find(kv => kv.key === 'scope3_segs');
          if (segmentKeyVal && Array.isArray(segmentKeyVal.values)) {
            segments = segmentKeyVal.values;
          }
        }

        return new Response(JSON.stringify({
          success: true,
          url: targetUrl,
          segments: segments,
          api_response: data
        }, null, 2), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error(`[SCOPE3] API error: ${error.message}`);
        return new Response(JSON.stringify({
          success: false,
          error: error.message,
          url: targetUrl
        }, null, 2), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    // Simple HTML page with links to the endpoints
    return new Response(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Scope3 API Debug</title>
        <style>
          body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; }
          .btn { display: inline-block; padding: 0.5rem 1rem; background: #0078d7; color: white; text-decoration: none; border-radius: 4px; margin: 0.5rem 0; }
          .card { border: 1px solid #ddd; border-radius: 4px; padding: 1rem; margin: 1rem 0; }
          code { background: #f5f5f5; padding: 0.2rem 0.4rem; border-radius: 3px; }
        </style>
      </head>
      <body>
        <h1>Scope3 API Debug</h1>
        <p>Simple worker for testing the Scope3 API without any proxying or complex logic.</p>
        
        <div class="card">
          <h2>API Test</h2>
          <p>Test the Scope3 API with a URL:</p>
          <a href="/api-test?url=https://www.health.com/type-a-personality-7970924" class="btn">Test with health.com article</a>
          <a href="/api-test?url=https://example.com" class="btn">Test with example.com</a>
          
          <form id="api-form" style="margin-top: 1rem;">
            <input type="text" id="url-input" placeholder="Enter a URL to test" style="padding: 0.5rem; width: 60%; border: 1px solid #ccc; border-radius: 4px;">
            <button type="submit" class="btn" style="margin-left: 0.5rem;">Test</button>
          </form>
        </div>
        
        <div class="card">
          <h2>Other Endpoints</h2>
          <p><a href="/hello" class="btn">Hello World</a> - Simple JSON response</p>
          <p><a href="/env" class="btn">Environment Info</a> - Check available environment variables</p>
        </div>
        
        <script>
          document.getElementById('api-form').addEventListener('submit', function(e) {
            e.preventDefault();
            const url = document.getElementById('url-input').value.trim();
            if (url) {
              window.location.href = '/api-test?url=' + encodeURIComponent(url);
            }
          });
        </script>
      </body>
      </html>
    `, {
      headers: { 'Content-Type': 'text/html' }
    });
  }
};