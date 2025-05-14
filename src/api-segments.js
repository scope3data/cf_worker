// Simple API handler specifically for the /api/segments endpoint
export default {
  async fetch(request, env, ctx) {
    console.log('[API-SEGMENTS] Starting simple API handler');
    
    // Set up basic CORS headers
    const corsHeaders = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };
    
    // Handle OPTIONS request for CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: corsHeaders
      });
    }
    
    try {
      // Get the URL from the request
      const url = new URL(request.url);
      const targetUrl = url.searchParams.get('url') || '';
      
      console.log(`[API-SEGMENTS] Received request for segments with URL: ${targetUrl}`);
      
      // For demo purposes, return hardcoded segments
      const demoSegments = ['test_segment', 'api_segment', 'standalone_handler'];
      
      // Construct the response
      const responseData = {
        url: targetUrl || 'https://example.com',
        segments: demoSegments,
        source: 'standalone api handler',
        timestamp: new Date().toISOString()
      };
      
      // Return response with CORS headers
      return new Response(JSON.stringify(responseData, null, 2), {
        status: 200,
        headers: corsHeaders
      });
    } catch (error) {
      console.error(`[API-SEGMENTS] Error: ${error.message}`);
      
      // Return error response
      return new Response(JSON.stringify({
        error: error.message,
        stack: error.stack
      }), {
        status: 500,
        headers: corsHeaders
      });
    }
  }
};