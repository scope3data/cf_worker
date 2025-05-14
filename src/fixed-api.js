// Minimal worker focusing only on the segments API

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json'
    };

    // Handle OPTIONS requests (CORS preflight)
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    // Handle API segments endpoint 
    if (url.pathname === '/api/segments' || url.pathname === '/') {
      const targetUrl = url.searchParams.get('url') || 'example.com';
      console.log(`[FIXED-API] Handling segments request for URL: ${targetUrl}`);

      try {
        // For demo purposes, return different segments based on the URL
        let segments;
        let source = 'fixed-api-worker';

        if (targetUrl === 'example' || targetUrl === 'example.com' || 
            targetUrl === 'https://example.com' || targetUrl === 'http://example.com') {
          segments = ['example_segment', 'test_segment', 'fixed_api']; 
        } else if (targetUrl === 'test' || targetUrl === 'demo') {
          segments = ['test_' + targetUrl, 'demo_segment', 'fixed_api'];
        } else {
          segments = ['generic_segment', 'fixed_api'];
        }

        // Create a properly formatted response
        const responseData = {
          url: targetUrl.startsWith('http') ? targetUrl : `https://${targetUrl}`,
          segments: segments,
          source: source,
          timestamp: new Date().toISOString()
        };

        // Return the response as JSON
        return new Response(
          JSON.stringify(responseData, null, 2),
          {
            status: 200,
            headers: corsHeaders
          }
        );
      } catch (error) {
        console.error(`[FIXED-API] Error: ${error.message}`);
        return new Response(
          JSON.stringify({ error: error.message }),
          {
            status: 500,
            headers: corsHeaders
          }
        );
      }
    }

    // Default response for other paths
    return new Response(
      JSON.stringify({ 
        message: "This is the fixed API worker. Use /api/segments?url=example.com to test.",
        endpoints: [
          "/api/segments?url=example.com",
          "/?url=example.com"
        ],
        timestamp: new Date().toISOString()
      }, null, 2),
      {
        status: 200,
        headers: corsHeaders
      }
    );
  }
};