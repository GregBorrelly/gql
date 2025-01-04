// Helper function to extract operation name
function extractOperationName(query) {
  if (!query) return 'Anonymous Operation';
  
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
  
  if (url.toString().includes('graphql')) {
    try {
      const response = await originalFetch.apply(this, args);
      const clone = response.clone();
      
      // Get response data
      const text = await clone.text();
      const body = JSON.parse(text);

      // Extract operation name and query from request body
      let operationName = 'Anonymous Operation';
      let query = '';
      let requestBody = null;
      if (options.body) {
        try {
          requestBody = JSON.parse(options.body);
          
          // Try to get operationName directly from request
          if (Array.isArray(requestBody)) {
            operationName = extractOperationName(requestBody);
            query = requestBody[0]?.query || '';
          } else {
            operationName = requestBody.operationName || extractOperationName(requestBody.query);
            query = requestBody.query || '';
          }
        } catch (e) {
          // Error handled silently
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
  this._url = url;
  return originalOpen.apply(this, arguments);
};

XHR.send = function(data) {
  if (this._url && this._url.includes('graphql')) {
    // Extract operation name and query from request body
    let operationName = 'Anonymous Operation';
    let query = '';
    let requestBody = null;
    if (data) {
      try {
        requestBody = JSON.parse(data);
        
        // Try to get operationName directly from request
        if (Array.isArray(requestBody)) {
          operationName = extractOperationName(requestBody);
          query = requestBody[0]?.query || '';
        } else {
          operationName = requestBody.operationName || extractOperationName(requestBody.query);
          query = requestBody.query || '';
        }
      } catch (e) {
        // Error handled silently
      }
    }
    
    this.addEventListener('load', function() {
      try {
        const body = JSON.parse(this.responseText);
        
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
        // Error handled silently
      }
    });
  }
  return originalSend.apply(this, arguments);
}; 