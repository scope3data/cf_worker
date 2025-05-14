/**
 * Simple test resource server to test resource fetching
 */

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

/**
 * Handle test requests
 */
async function handleRequest(request) {
  const url = new URL(request.url);
  
  // Set CORS headers to allow all origins
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  };
  
  // Handle preflight requests
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  
  // Serve test JSON data
  if (url.pathname === '/' || url.pathname === '/test-resource.json') {
    const responseData = {
      status: 'success',
      message: 'This is a test resource',
      timestamp: new Date().toISOString(),
      request_url: request.url,
      headers: Object.fromEntries([...request.headers])
    };
    
    return new Response(JSON.stringify(responseData, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  }
  
  // Serve test HTML page
  return new Response(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Test Resource Server</title>
      <style>
        body { font-family: sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        pre { background: #f5f5f5; padding: 10px; border-radius: 4px; overflow-x: auto; }
        button { padding: 8px 16px; background: #0078d7; color: white; border: none; border-radius: 4px; cursor: pointer; }
      </style>
    </head>
    <body>
      <h1>Test Resource Server</h1>
      <p>This simple server provides test resources for development and debugging.</p>
      
      <h2>Test Loading JSON Resource</h2>
      <button id="loadJson">Load JSON Resource</button>
      <div id="result" style="margin-top: 15px;"></div>
      
      <script>
        document.getElementById('loadJson').addEventListener('click', async () => {
          const resultDiv = document.getElementById('result');
          resultDiv.innerHTML = 'Loading...';
          
          try {
            const timestamp = new Date().getTime();
            const response = await fetch('/test-resource.json?t=' + timestamp, {
              method: 'GET',
              headers: {
                'Accept': 'application/json',
                'Cache-Control': 'no-cache'
              },
              cache: 'no-store'
            });
            
            if (response.ok) {
              const data = await response.json();
              resultDiv.innerHTML = '<pre>' + JSON.stringify(data, null, 2) + '</pre>';
            } else {
              resultDiv.innerHTML = '<p style="color: red;">Error: ' + response.status + ' ' + response.statusText + '</p>';
            }
          } catch (error) {
            resultDiv.innerHTML = '<p style="color: red;">Error: ' + error.message + '</p>';
            console.error('Fetch error:', error);
          }
        });
      </script>
    </body>
    </html>
  `, {
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      ...corsHeaders
    }
  });
}