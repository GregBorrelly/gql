console.log('[Background] Service worker started');

let connections = {};
let requests = new Map();

chrome.runtime.onConnect.addListener(function (port) {
  if (port.name !== "devtools-page") return;

  console.log('[Background] DevTools connected');
  
  port.onMessage.addListener(function (message) {
    if (message.type === 'init') {
      console.log('[Background] Panel initialized for tab:', message.tabId);
      connections[message.tabId] = port;
      port.onDisconnect.addListener(function() {
        delete connections[message.tabId];
      });
    }
  });
});

// Handle response from content script
chrome.runtime.onMessage.addListener(function(message, sender) {
  if (message.type !== 'graphql-response') return;

  const tabId = sender.tab.id;
  const requestId = Math.random().toString(36).substring(7); // Generate unique ID

  console.log('[Background] Received response from content:', {
    url: message.url,
    status: message.status,
    operationName: message.operationName,
    bodyPreview: message.body ? JSON.stringify(message.body).slice(0, 100) : null
  });

  // Create request object
  const request = {
    id: requestId,
    url: message.url,
    tabId: tabId,
    body: message.body,
    timestamp: new Date().toISOString(),
    status: message.status >= 200 && message.status < 300 ? 'success' : 'error',
    response: message.body,
    operationName: message.operationName || 'Anonymous Operation',
    query: message.query || '',
    requestBody: message.requestBody || null
  };

  // Store request
  requests.set(requestId, request);

  // Notify DevTools if connected
  if (tabId in connections) {
    // Send initial request
    connections[tabId].postMessage({
      type: 'graphql-request',
      data: request
    });

    // Send completion immediately after
    connections[tabId].postMessage({
      type: 'request-completed',
      data: request
    });
  }

  // Clean up request after delay
  setTimeout(() => requests.delete(requestId), 1000 * 60 * 5); // Keep for 5 minutes
  
  return true; // Keep message channel open for async response
});