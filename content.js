console.log('[Content] Script loaded');

// Intercept fetch requests
const originalFetch = window.fetch;
window.fetch = async function(...args) {
  const url = args[0];
  console.log('[Content] Fetch intercepted:', url);
  const response = await originalFetch.apply(this, args);
  
  if (url.includes('graphql')) {
    try {
      console.log('[Content] GraphQL request detected:', url);
      const clone = response.clone();
      const body = await clone.json();
      console.log('[Content] Response body:', {
        url: url,
        status: response.status,
        body: body
      });
      
      // Send response to background script
      chrome.runtime.sendMessage({
        type: 'graphql-response',
        url: url,
        status: response.status,
        body: body
      }, response => {
        if (chrome.runtime.lastError) {
          console.error('[Content] Error sending message:', chrome.runtime.lastError);
        } else {
          console.log('[Content] Message sent successfully');
        }
      });
    } catch (e) {
      console.error('[Content] Error capturing response:', e);
    }
  }
  return response;
};

// Intercept XHR requests
const originalXHR = window.XMLHttpRequest.prototype.open;
const originalSend = window.XMLHttpRequest.prototype.send;

window.XMLHttpRequest.prototype.open = function(method, url) {
  this._url = url; // Store URL for later
  return originalXHR.apply(this, arguments);
};

window.XMLHttpRequest.prototype.send = function() {
  if (this._url && this._url.includes('graphql')) {
    const xhr = this;
    const originalOnLoad = xhr.onload;
    
    xhr.onload = function() {
      try {
        const body = JSON.parse(xhr.responseText);
        console.log('[Content] XHR Response:', {
          url: xhr._url,
          status: xhr.status,
          body: body
        });
        
        // Send response to background script
        chrome.runtime.sendMessage({
          type: 'graphql-response',
          url: xhr._url,
          status: xhr.status,
          body: body
        }, response => {
          if (chrome.runtime.lastError) {
            console.error('[Content] Error sending message:', chrome.runtime.lastError);
          } else {
            console.log('[Content] Message sent successfully');
          }
        });
      } catch (e) {
        console.error('[Content] Error capturing XHR response:', e);
      }
      
      if (originalOnLoad) {
        originalOnLoad.apply(this, arguments);
      }
    };
  }
  
  return originalSend.apply(this, arguments);
};