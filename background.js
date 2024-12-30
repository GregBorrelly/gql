let connections = {};

chrome.runtime.onConnect.addListener(function (port) {
  if (port.name !== "devtools-page") {
    return;
  }

  // Listen to messages sent from the DevTools page
  port.onMessage.addListener(function (message) {
    if (message.type === 'init') {
      connections[message.tabId] = port;
      port.onDisconnect.addListener(function() {
        delete connections[message.tabId];
      });
    }
  });
});

chrome.webRequest.onBeforeRequest.addListener(
  function(details) {
    if (isGraphQLRequest(details)) {
      const requestBody = decodeRequest(details);
      // Send message to the DevTools page
      const tabId = details.tabId;
      if (tabId in connections) {
        connections[tabId].postMessage({
          type: 'graphql-request',
          data: {
            url: details.url,
            body: requestBody,
            timestamp: new Date().toISOString()
          }
        });
      }
    }
  },
  { urls: ["<all_urls>"] },
  ["requestBody"]
);

chrome.webRequest.onCompleted.addListener(
  function(details) {
    const tabId = details.tabId;
    if (tabId in connections) {
      // Update the corresponding request with response status
      connections[tabId].postMessage({
        type: 'request-completed',
        data: {
          requestId: details.requestId,
          status: details.statusCode,
          timeStamp: details.timeStamp
        }
      });
    }
  },
  { urls: ["<all_urls>"] }
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