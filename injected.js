console.log('[Injected] Script starting');

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
      
      // Dispatch event with response data
      window.dispatchEvent(new CustomEvent('__graphql_response', {
        detail: {
          url: url instanceof Request ? url.url : url,
          status: response.status,
          body
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

XHR.send = function() {
  if (this._url && this._url.includes('graphql')) {
    console.log('[Injected] GraphQL XHR request detected');
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
            body
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