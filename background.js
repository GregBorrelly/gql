console.log('[Background] Service worker started');

let connections = {};
let requestData = new Map();
let responseData = new Map();

chrome.runtime.onConnect.addListener(function (port) {
  if (port.name !== "devtools-page") return;

  console.log('[Background] DevTools connected');
  
  port.onMessage.addListener(function (message) {
    if (message.type === 'init') {
      console.log('[Background] Panel initialized for tab:', message.tabId);
      connections[message.tabId] = port;
      port.onDisconnect.addListener(function() {
        console.log('[Background] Panel disconnected for tab:', message.tabId);
        delete connections[message.tabId];
      });
    }
  });
});

// Capture initial request
chrome.webRequest.onBeforeRequest.addListener(
  function(details) {
    console.log('[Background] onBeforeRequest:', {
      url: details.url,
      type: details.type,
      hasRequestBody: !!details.requestBody
    });
    
    if (isGraphQLRequest(details)) {
      console.log('[Background] GraphQL request detected:', {
        requestId: details.requestId,
        url: details.url
      });
      
      const requestBody = decodeRequest(details);
      const tabId = details.tabId;
      
      // Store request data with URL immediately
      requestData.set(details.requestId, {
        startTime: details.timeStamp,
        body: requestBody,
        tabId: tabId,
        url: details.url
      });
      
      console.log('[Background] Request data stored:', {
        requestId: details.requestId,
        requestData: requestData.get(details.requestId)
      });

      // Also create response entry early
      responseData.set(details.requestId, {
        tabId: tabId,
        url: details.url
      });
      
      if (tabId in connections) {
        console.log('[Background] Sending request to panel');
        connections[tabId].postMessage({
          type: 'graphql-request',
          data: {
            id: details.requestId,
            url: details.url,
            body: requestBody,
            timestamp: new Date().toISOString(),
            size: details.requestBody ? JSON.stringify(details.requestBody).length : 0
          }
        });
      }
    }
  },
  { urls: ["*://*/*"] },
  ["requestBody"]
);

// Message listener for content script responses
chrome.runtime.onMessage.addListener(function(message, sender) {
  if (message.type === 'graphql-response') {
    console.log('[Background] Received response from content:', {
      url: message.url,
      status: message.status,
      hasBody: !!message.body
    });
    
    // Find the matching request by URL
    let matched = false;
    for (const [requestId, data] of responseData.entries()) {
      if (data.url === message.url) {
        console.log('[Background] Matched response to request:', requestId);
        matched = true;
        
        // Update the response data
        responseData.set(requestId, {
          ...data,
          body: message.body,
          status: message.status
        });

        // If request is already completed, send an update
        const reqData = requestData.get(requestId);
        if (reqData && reqData.completed) {
          const tabId = reqData.tabId;
          if (tabId in connections) {
            console.log('[Background] Sending completion update to panel:', {
              id: requestId,
              status: message.status,
              hasBody: !!message.body
            });
            
            connections[tabId].postMessage({
              type: 'request-completed',
              data: {
                id: requestId,
                status: message.status,
                duration: reqData.duration,
                response: message.body
              }
            });
          }
        }
        break;
      }
    }
  }
  return true;
});

// Update headers when received
chrome.webRequest.onHeadersReceived.addListener(
  function(details) {
    const response = responseData.get(details.requestId);
    if (response) {
      const contentType = details.responseHeaders.find(
        h => h.name.toLowerCase() === 'content-type'
      );
      
      if (contentType && contentType.value.includes('application/json')) {
        // Update the existing response data
        responseData.set(details.requestId, {
          ...response,
          headers: details.responseHeaders
        });
      }
    }
  },
  { urls: ["*://*/*"] },
  ["responseHeaders"]
);

// Handle completed requests
chrome.webRequest.onCompleted.addListener(
  function(details) {
    const data = requestData.get(details.requestId);
    const response = responseData.get(details.requestId);
    
    console.log('[Background] Request completed:', {
      requestId: details.requestId,
      url: details.url,
      status: details.statusCode,
      hasResponse: !!response?.body
    });
    
    if (data && data.tabId in connections) {
      const duration = details.timeStamp - data.startTime;
      
      // Mark request as completed
      data.completed = true;
      data.status = details.statusCode;
      data.duration = duration;
      requestData.set(details.requestId, data);

      // Only send completion if we have response
      if (response?.body) {
        console.log('[Background] Sending completion with response:', {
          id: details.requestId,
          status: response.status || details.statusCode,
          hasBody: true
        });
        
        connections[data.tabId].postMessage({
          type: 'request-completed',
          data: {
            id: details.requestId,
            status: response.status || details.statusCode,
            duration: duration,
            response: response.body
          }
        });
        
        // Clean up after sending
        requestData.delete(details.requestId);
        responseData.delete(details.requestId);
      }
    }
  },
  { urls: ["*://*/*"] }
);

// Handle errors
chrome.webRequest.onErrorOccurred.addListener(
  function(details) {
    const tabId = details.tabId;
    if (tabId in connections) {
      connections[tabId].postMessage({
        type: 'request-error',
        data: {
          id: details.requestId,
          error: details.error
        }
      });
    }
    requestData.delete(details.requestId);
  },
  { urls: ["*://*/*"] }
);

function isGraphQLRequest(details) {
  if (!details.requestBody) return false;
  
  // Check URL contains GraphQL
  if (details.url.toLowerCase().includes('graphql')) return true;
  
  // Check request body for GraphQL query
  const data = decodeRequest(details);
  return data && (data.query || data.mutation);
}

function decodeRequest(details) {
  if (!details.requestBody) return null;
  
  if (details.requestBody.raw) {
    const decoder = new TextDecoder("utf-8");
    const raw = details.requestBody.raw[0].bytes;
    const decoded = decoder.decode(raw);
    try {
      return JSON.parse(decoded);
    } catch (e) {
      return null;
    }
  }
  
  return null;
} 