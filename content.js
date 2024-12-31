console.log('[Content] Script loaded');

// Inject script to intercept XHR and fetch
function injectInterceptor() {
  console.log('[Content] Injecting interceptor script');
  
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('injected.js');
  (document.head || document.documentElement).appendChild(script);
  script.onload = () => script.remove();
  
  console.log('[Content] Interceptor script injected');
}

// Listen for response events from injected script
window.addEventListener('__graphql_response', function(event) {
  const { url, status, body, operationName, query, requestBody } = event.detail;
  
  console.log('[Content] Received GraphQL response event:', {
    url,
    status,
    operationName,
    bodyPreview: JSON.stringify(body).slice(0, 100)
  });
  
  // Send to background script
  chrome.runtime.sendMessage({
    type: 'graphql-response',
    url,
    status,
    body,
    operationName,
    query,
    requestBody
  }, response => {
    console.log('[Content] Background script response:', response);
  });
});

// Inject as soon as possible
if (document.documentElement) {
  console.log('[Content] Document ready, injecting immediately');
  injectInterceptor();
} else {
  console.log('[Content] Waiting for document to be ready');
  document.addEventListener('DOMContentLoaded', () => {
    console.log('[Content] Document loaded, injecting now');
    injectInterceptor();
  });
}