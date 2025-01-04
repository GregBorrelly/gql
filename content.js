// Inject script to intercept XHR and fetch
function injectInterceptor() {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('injected.js');
  (document.head || document.documentElement).appendChild(script);
  script.onload = () => script.remove();
}

// Listen for response events from injected script
window.addEventListener('__graphql_response', function(event) {
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
  });
});

// Inject as soon as possible
if (document.documentElement) {
  injectInterceptor();
} else {
  document.addEventListener('DOMContentLoaded', () => {
    injectInterceptor();
  });
}