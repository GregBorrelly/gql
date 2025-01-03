console.log('[Background] Service worker started');

// Efficient request store with LRU-like behavior
class RequestStore {
  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
    this.store = new Map();
    this.queue = [];
  }

  set(id, request) {
    if (this.queue.length >= this.maxSize) {
      const oldestId = this.queue.shift();
      this.store.delete(oldestId);
    }
    
    this.store.set(id, request);
    this.queue.push(id);
  }

  get(id) {
    return this.store.get(id);
  }

  delete(id) {
    this.store.delete(id);
    const index = this.queue.indexOf(id);
    if (index > -1) this.queue.splice(index, 1);
  }

  clear() {
    this.store.clear();
    this.queue = [];
  }
}

let connections = {};
const requests = new RequestStore();
const messageQueue = new Map(); // Tab ID -> Message array
let messageTimeout = null;
const MESSAGE_BATCH_DELAY = 100; // 100ms batching window

// Rate limiting implementation
const RateLimit = {
  windowMs: 1000, // 1 second window
  maxRequests: 50, // max requests per window
  requests: new Map(),

  checkLimit(tabId) {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    
    // Clean old requests
    this.requests.forEach((timestamps, id) => {
      this.requests.set(id, timestamps.filter(time => time > windowStart));
    });

    // Get/initialize request timestamps for this tab
    const timestamps = this.requests.get(tabId) || [];
    this.requests.set(tabId, timestamps);

    // Check if under limit
    if (timestamps.length >= this.maxRequests) {
      console.warn(`[Background] Rate limit exceeded for tab ${tabId}`);
      return false;
    }

    // Add new timestamp
    timestamps.push(now);
    return true;
  }
};

function sendBatchedMessages(tabId) {
  const messages = messageQueue.get(tabId) || [];
  if (!messages.length) return;

  const port = connections[tabId];
  if (!port) {
    messageQueue.delete(tabId);
    return;
  }

  // Group similar messages
  const groupedMessages = messages.reduce((acc, msg) => {
    if (!acc[msg.type]) acc[msg.type] = [];
    acc[msg.type].push(msg.data);
    return acc;
  }, {});

  // Send as batch
  Object.entries(groupedMessages).forEach(([type, dataArray]) => {
    port.postMessage({
      type: `${type}_batch`,
      data: dataArray
    });
  });

  messageQueue.delete(tabId);
}

function queueMessage(tabId, message) {
  if (!messageQueue.has(tabId)) {
    messageQueue.set(tabId, []);
  }
  messageQueue.get(tabId).push(message);

  if (messageTimeout) clearTimeout(messageTimeout);
  messageTimeout = setTimeout(() => {
    const tabs = Array.from(messageQueue.keys());
    tabs.forEach(sendBatchedMessages);
  }, MESSAGE_BATCH_DELAY);
}

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
  
  // Check rate limit
  if (!RateLimit.checkLimit(tabId)) {
    console.warn('[Background] Request dropped due to rate limiting');
    return true;
  }

  const requestId = Math.random().toString(36).substring(7);

  console.log('[Background] Received response from content:', {
    url: message.url,
    status: message.status,
    operationName: message.operationName,
    bodyPreview: message.body ? JSON.stringify(message.body).slice(0, 100) : null
  });

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

  // Queue messages for batching
  if (tabId in connections) {
    queueMessage(tabId, {
      type: 'graphql-request',
      data: request
    });
    
    queueMessage(tabId, {
      type: 'request-completed',
      data: request
    });
  }
  
  return true;
});