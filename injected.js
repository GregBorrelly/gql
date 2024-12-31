console.log('[Injected] Script starting');

// Helper function to extract operation name
function extractOperationName(query) {
  if (!query) return 'Anonymous Operation';
  
  // Log the input for debugging
  console.log('[Injected] extractOperationName input:', {
    type: typeof query,
    value: query,
    isArray: Array.isArray(query)
  });
  
  // Handle array input
  if (Array.isArray(query)) {
    // Try to get the first operation
    if (query.length > 0) {
      const firstOp = query[0];
      if (firstOp.operationName) return firstOp.operationName;
      if (firstOp.query) return extractOperationName(firstOp.query);
    }
    return 'Anonymous Operation';
  }
  
  // Try to get operationName from the request body first
  if (typeof query === 'object' && query.operationName) {
    return query.operationName;
  }
  
  // Fall back to parsing the query string
  if (typeof query === 'string') {
    const match = query.match(/(?:query|mutation|subscription)\s+(\w+)/);
    return match ? match[1] : 'Anonymous Operation';
  }
  
  return 'Anonymous Operation';
}

// Intercept fetch
const originalFetch = window.fetch;
window.fetch = async function(...args) {
  const url = args[0];
  const options = args[1] || {};
  
  console.log('[Injected] Fetch request:', {
    url: url instanceof Request ? url.url : url,
    method: options.method || 'GET'
  });
  
  if (url.toString().includes('graphql')) {
    console.log('[Injected] GraphQL fetch request detected');
    try {
      const response = await originalFetch.apply(this, args);
      const clone = response.clone();
      
      // Get response data
      const text = await clone.text();
      console.log('[Injected] Received response text:', text.slice(0, 100));
      
      const body = JSON.parse(text);
      console.log('[Injected] Parsed response body');

      // Extract operation name and query from request body
      let operationName = 'Anonymous Operation';
      let query = '';
      let requestBody = null;
      if (options.body) {
        try {
          requestBody = JSON.parse(options.body);
          console.log('[Injected] Request body structure:', {
            type: typeof requestBody,
            isArray: Array.isArray(requestBody),
            keys: typeof requestBody === 'object' ? Object.keys(requestBody) : null,
            raw: requestBody
          });
          
          // Try to get operationName directly from request
          if (Array.isArray(requestBody)) {
            operationName = extractOperationName(requestBody);
            query = requestBody[0]?.query || '';
          } else {
            operationName = requestBody.operationName || extractOperationName(requestBody.query);
            query = requestBody.query || '';
          }
          
          console.log('[Injected] Extracted from fetch request:', {
            operationName,
            query: query.slice(0, 100) + '...',
            hasQuery: !!query,
            requestBody
          });
        } catch (e) {
          console.error('[Injected] Failed to parse request body:', e);
        }
      }
      
      // Dispatch event with response data
      window.dispatchEvent(new CustomEvent('__graphql_response', {
        detail: {
          url: url instanceof Request ? url.url : url,
          status: response.status,
          body,
          operationName,
          query,
          requestBody
        }
      }));
      
      return response;
    } catch (e) {
      console.error('[Injected] Fetch error:', e);
      return originalFetch.apply(this, args);
    }
  }
  return originalFetch.apply(this, args);
};

// Intercept XHR
const XHR = XMLHttpRequest.prototype;
const originalOpen = XHR.open;
const originalSend = XHR.send;

XHR.open = function(method, url) {
  console.log('[Injected] XHR open:', { method, url });
  this._url = url;
  return originalOpen.apply(this, arguments);
};

XHR.send = function(data) {
  if (this._url && this._url.includes('graphql')) {
    console.log('[Injected] GraphQL XHR request detected');
    
    // Extract operation name and query from request body
    let operationName = 'Anonymous Operation';
    let query = '';
    let requestBody = null;
    if (data) {
      try {
        requestBody = JSON.parse(data);
        console.log('[Injected] XHR request body structure:', {
          type: typeof requestBody,
          isArray: Array.isArray(requestBody),
          keys: typeof requestBody === 'object' ? Object.keys(requestBody) : null,
          raw: requestBody
        });
        
        // Try to get operationName directly from request
        if (Array.isArray(requestBody)) {
          operationName = extractOperationName(requestBody);
          query = requestBody[0]?.query || '';
        } else {
          operationName = requestBody.operationName || extractOperationName(requestBody.query);
          query = requestBody.query || '';
        }
        
        console.log('[Injected] Extracted from XHR request:', {
          operationName,
          query: query.slice(0, 100) + '...',
          hasQuery: !!query,
          requestBody
        });
      } catch (e) {
        console.error('[Injected] Failed to parse XHR request body:', e);
      }
    }
    
    this.addEventListener('load', function() {
      console.log('[Injected] XHR response received:', {
        status: this.status,
        responseLength: this.responseText.length
      });
      
      try {
        const body = JSON.parse(this.responseText);
        console.log('[Injected] Parsed XHR response');
        
        // Dispatch event with response data
        window.dispatchEvent(new CustomEvent('__graphql_response', {
          detail: {
            url: this._url,
            status: this.status,
            body,
            operationName,
            query,
            requestBody
          }
        }));
      } catch (e) {
        console.error('[Injected] XHR parse error:', e);
      }
    });
  }
  return originalSend.apply(this, arguments);
};

console.log('[Injected] Request interception setup complete'); 