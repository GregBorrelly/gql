// Inject script to intercept XHR and fetch
function injectInterceptor() {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('injected.js');
  (document.head || document.documentElement).appendChild(script);
  script.onload = () => script.remove();
}

// Cleanup function to remove listeners
function cleanup() {
  window.removeEventListener('__graphql_response', handleGraphQLResponse);
}

// Handle GraphQL response events
function handleGraphQLResponse(event) {
  try {
    const { url, status, body, operationName, query, requestBody } = event.detail;
    
    // Send to background script
    chrome.runtime.sendMessage({
      type: 'graphql-response',
      url,
      status,
      body,
      operationName,
      query,
      requestBody
    }).catch(() => {
      // If message sending fails, clean up listeners
      cleanup();
    });
  } catch (error) {
    // If we hit an error (like invalid extension context), clean up
    cleanup();
  }
}

// Listen for extension invalidation
chrome.runtime.onSuspend?.addListener(cleanup);

// Add event listener with named function for removal
window.addEventListener('__graphql_response', handleGraphQLResponse);

// Inject as soon as possible
try {
  if (document.documentElement) {
    injectInterceptor();
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      injectInterceptor();
    });
  }
} catch (error) {
  // If injection fails, ensure we clean up
  cleanup();
}