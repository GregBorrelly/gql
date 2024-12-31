// State management
let requests = [];
let searchTerm = '';
let typeFilter = 'all';
let statusFilter = 'all';
let currentTheme = 'light';
let starredGroups = new Set();

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Load saved settings and starred groups
    const settings = await storage.getSettings();
    currentTheme = settings.theme;
    starredGroups = new Set(settings.starredGroups || []);
    themes.applyTheme(currentTheme);

    // Setup event listeners
    setupEventListeners();
    
    // Load saved history
    const history = await storage.getHistory();
    requests = Array.isArray(history) ? history : [];
    updateDisplay();
  } catch (e) {
    console.error('Initialization error:', e);
  }
});

function setupEventListeners() {
  // Search and filters
  document.getElementById('search-input').addEventListener('input', (e) => {
    searchTerm = e.target.value.toLowerCase();
    updateDisplay();
  });

  document.getElementById('type-filter').addEventListener('change', (e) => {
    typeFilter = e.target.value;
    updateDisplay();
  });

  document.getElementById('status-filter').addEventListener('change', (e) => {
    statusFilter = e.target.value;
    updateDisplay();
  });

  // Clear button
  document.getElementById('clear-btn').addEventListener('click', async () => {
    requests = [];
    await storage.clearHistory();
    updateDisplay();
  });

  // Theme toggle
  document.getElementById('theme-toggle').addEventListener('click', async () => {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    themes.applyTheme(currentTheme);
    await storage.saveSettings({ ...await storage.getSettings(), theme: currentTheme });
    document.getElementById('theme-icon').textContent = currentTheme === 'light' ? '🌙' : '☀️';
  });
}

// Background connection
const backgroundPageConnection = chrome.runtime.connect({
  name: "devtools-page"
});

backgroundPageConnection.onMessage.addListener(async function (message) {
  console.log('[Panel] Message received:', {
    type: message.type,
    data: message.data
  });
  
  if (message.type === 'graphql-request') {
    console.log('[Panel] New request:', message.data);
    const request = {
      ...message.data,
      status: 'pending',
      duration: null,
      response: null
    };
    console.log('[Panel] Created request object:', request);
    requests.unshift(request);
    await storage.saveRequest(request);
    updateDisplay();
  } else if (message.type === 'request-completed') {
    console.log('[Panel] Request completed:', {
      id: message.data.id,
      status: message.data.status,
      hasResponse: !!message.data.response
    });
    
    const index = requests.findIndex(r => r.id === message.data.id);
    if (index !== -1) {
      const updatedRequest = {
        ...requests[index],
        status: message.data.status >= 200 && message.data.status < 300 ? 'success' : 'error',
        duration: message.data.duration,
        response: message.data.response
      };
      
      console.log('[Panel] Updating request:', {
        id: updatedRequest.id,
        status: updatedRequest.status,
        hasResponse: !!updatedRequest.response
      });
      
      requests[index] = updatedRequest;
      await storage.saveRequest(updatedRequest);
      
      // Force re-render if this request is selected
      const selectedRequest = document.querySelector('.request-card.selected');
      if (selectedRequest && selectedRequest.dataset.index === String(index)) {
        showDetails(updatedRequest);
      }
      
      updateDisplay();
    }
  } else if (message.type === 'request-error') {
    const index = requests.findIndex(r => r.id === message.data.id);
    if (index !== -1) {
      requests[index] = {
        ...requests[index],
        status: 'error',
        error: message.data.error
      };
      await storage.saveRequest(requests[index]);
      updateDisplay();
    }
  }
});

backgroundPageConnection.onDisconnect.addListener(() => {
  console.log('[Panel] Disconnected from background page');
});

// Add error handling for message sending
backgroundPageConnection.postMessage({
  type: 'init',
  tabId: chrome.devtools.inspectedWindow.tabId
}, response => {
  if (chrome.runtime.lastError) {
    console.error('[Panel] Error sending init message:', chrome.runtime.lastError);
  }
});

function updateDisplay() {
  const container = document.getElementById('requests');
  const filteredRequests = requests.filter(request => {
    const matchesSearch = JSON.stringify(request).toLowerCase().includes(searchTerm);
    const matchesType = typeFilter === 'all' || getOperationType(request.body?.query).toLowerCase() === typeFilter;
    const matchesStatus = statusFilter === 'all' || request.status === statusFilter;
    return matchesSearch && matchesType && matchesStatus;
  });

  // Group the requests
  const groups = {};
  filteredRequests.forEach(request => {
    const operationName = request.operationName || 'Anonymous Operation';
    const group = getQueryGroup(operationName);
    
    if (!groups[group]) {
      groups[group] = [];
    }
    groups[group].push(request);
  });

  // Sort groups to put starred ones first
  const sortedGroups = Object.entries(groups).sort(([groupA], [groupB]) => {
    const aStarred = starredGroups.has(groupA);
    const bStarred = starredGroups.has(groupB);
    if (aStarred && !bStarred) return -1;
    if (!aStarred && bStarred) return 1;
    return groupA.localeCompare(groupB);
  });

  container.innerHTML = sortedGroups
    .map(([groupName, groupRequests]) => `
      <div class="request-group">
        <div class="group-header">
          <div class="group-header-left">
            <button class="star-btn ${starredGroups.has(groupName) ? 'starred' : ''}" 
                    data-group="${groupName}">
              ${starredGroups.has(groupName) ? '⭐' : '☆'}
            </button>
            ${groupName}
          </div>
          <span class="group-count">${groupRequests.length}</span>
        </div>
        <div class="group-content">
          ${groupRequests.map((request, index) => {
            const query = request.body?.query || '';
            const operationType = getOperationType(query);
            const operationName = request.operationName || 'Anonymous Operation';
            const statusBadge = getStatusBadge(request.status);

            return `
              <div class="request-card ${request.status}" 
                   data-index="${filteredRequests.indexOf(request)}" 
                   data-status="${request.status}"
                   data-type="${operationType.toLowerCase()}">
                <div class="request-info">
                  <span class="operation-name">${operationName}</span>
                </div>
                ${statusBadge}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `).join('');

  // Add star button handlers
  document.querySelectorAll('.star-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const groupName = btn.dataset.group;
      if (starredGroups.has(groupName)) {
        starredGroups.delete(groupName);
      } else {
        starredGroups.add(groupName);
      }
      // Save to storage
      await storage.saveSettings({
        ...await storage.getSettings(),
        starredGroups: Array.from(starredGroups)
      });
      updateDisplay();
    });
  });

  // Setup click handlers
  document.querySelectorAll('.request-card').forEach((card, index) => {
    card.addEventListener('click', () => showDetails(filteredRequests[card.dataset.index]));
  });
}

function showDetails(request) {
  if (!request) {
    console.log('[Panel] No request provided to showDetails');
    return;
  }

  console.log('[Panel] Showing details:', {
    id: request.id,
    status: request.status,
    hasResponse: request.response !== null && request.response !== undefined,
    responseType: typeof request.response,
    response: request.response,
    query: request.query,
    requestBody: request.requestBody,
    fullRequest: request
  });

  const detailsPanel = document.getElementById('details-panel');
  const query = request.query || request.requestBody?.query || '';
  const formattedQuery = formatGraphQLQuery(query);
  const highlightedQuery = highlightGraphQLSyntax(formattedQuery);
  const operationType = getOperationType(query);
  const operationName = request.operationName || 'Anonymous Operation';
  const queryDepth = utils.calculateQueryDepth(query);

  document.querySelectorAll('.request-card').forEach(card => {
    card.classList.remove('selected');
  });
  document.querySelector(`[data-index="${requests.indexOf(request)}"]`).classList.add('selected');

  // Add logging to debug response data
  console.log('[Panel] Request data for details:', {
    operationName,
    query,
    formattedQuery,
    requestBody: request.requestBody
  });
  
  // Count GraphQL errors if they exist
  const graphqlErrors = request.response?.errors || [];
  const errorCount = graphqlErrors.length;
  const hasErrors = errorCount > 0;
  const hasResponse = request.response !== null && request.response !== undefined;

  detailsPanel.innerHTML = `
    <div class="details-content">
      <div class="details-header">
        <div class="details-title">${operationName}</div>
        <div class="meta-info">
          <span class="operation-type ${operationType.toLowerCase()}">${operationType}</span>
          <span>${request.url}</span>
        </div>
        <div class="metrics">
          <div class="metric">
            <span class="metric-label">Status</span>
            <span class="metric-value">${getStatusBadge(request.status)}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Duration</span>
            <span class="metric-value">${request.duration ? `${request.duration.toFixed(0)}ms` : 'Pending'}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Size</span>
            <span class="metric-value">${utils.formatBytes(request.size)}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Depth</span>
            <span class="metric-value">${queryDepth}</span>
          </div>
        </div>
      </div>
      <div class="actions-menu">
        <button class="action-btn" onclick="copyToClipboard(utils.generateCurl(${JSON.stringify(request)}))" title="Copy as cURL">
          <i class="mdi mdi-console"></i>
        </button>
        <button class="action-btn" onclick="copyToClipboard(utils.generateFetch(${JSON.stringify(request)}))" title="Copy as fetch">
          <i class="mdi mdi-code-tags"></i>
        </button>
      </div>
      <div class="tabs">
        <div class="tab active" data-tab="query">Query</div>
        <div class="tab" data-tab="payload">Payload</div>
        ${hasResponse ? '<div class="tab" data-tab="response">Response</div>' : ''}
        ${hasErrors ? `<div class="tab error-tab" data-tab="errors">Errors (${errorCount})</div>` : ''}
      </div>
      <div class="tab-content">
        <div class="tab-panel" id="detail-query" style="display: block;">
          <div class="query-section">
            <button class="copy-btn" onclick="copyToClipboard(\`${formattedQuery.replace(/`/g, '\\`')}\`)">
              <span>📋</span>
              Copy
            </button>
            <pre>${highlightedQuery}</pre>
          </div>
          ${request.requestBody?.variables ? `
            <div class="variables-section">
              <div class="variables-title">Variables</div>
              <div class="query-section">
                <button class="copy-btn" onclick="copyToClipboard('${JSON.stringify(request.requestBody.variables, null, 2)}')">
                  <span>📋</span>
                  Copy
                </button>
                <pre>${formatJSON(request.requestBody.variables)}</pre>
              </div>
            </div>
          ` : ''}
        </div>
        <div class="tab-panel" id="detail-payload" style="display: none;">
          <div class="query-section">
            <button class="copy-btn" onclick="copyToClipboard('${JSON.stringify(request.requestBody || {}, null, 2)}')">
              <span>📋</span>
              Copy
            </button>
            <pre>${formatJSON(request.requestBody || {})}</pre>
          </div>
        </div>
        ${hasResponse ? `
          <div class="tab-panel" id="detail-response" style="display: none;">
            <div class="query-section">
              <button class="copy-btn" onclick="copyToClipboard('${JSON.stringify(request.response, null, 2)}')">
                <span>📋</span>
                Copy
              </button>
              <pre>${formatJSON(request.response)}</pre>
            </div>
          </div>
        ` : ''}
        ${hasErrors ? `
          <div class="tab-panel" id="detail-errors" style="display: none;">
            <div class="query-section error-section">
              <button class="copy-btn" onclick="copyToClipboard('${JSON.stringify(graphqlErrors, null, 2)}')">
                <span>📋</span>
                Copy
              </button>
              <pre>${formatJSON(graphqlErrors)}</pre>
            </div>
          </div>
        ` : ''}
      </div>
    </div>
  `;

  setupTabHandlers(detailsPanel);
}

function setupTabHandlers(container) {
  container.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      const panels = container.querySelectorAll('.tab-panel');
      const tabs = container.querySelectorAll('.tab');
      
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(panel => {
        if (panel.id === `detail-${tabName}`) {
          panel.style.display = 'block';
        } else {
          panel.style.display = 'none';
        }
      });
      
      tab.classList.add('active');
    });
  });
}

function setupJsonToggles(container) {
  container.querySelectorAll('.json-toggle.expandable').forEach(toggle => {
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const line = toggle.closest('.json-line');
      toggle.classList.toggle('expanded');
      const nested = line.querySelector('.json-nested');
      if (nested) {
        nested.classList.toggle('expanded');
      }
    });
  });
}

function getStatusBadge(status) {
  const statusClasses = {
    success: 'success',
    error: 'error',
    pending: 'pending'
  };
  return `<span class="status-badge ${statusClasses[status]}">${status}</span>`;
}

function formatGraphQLQuery(query) {
  try {
    return prettier.format(query, {
      parser: "graphql",
      plugins: prettierPlugins
    });
  } catch (e) {
    return query;
  }
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    // Could add a toast notification here
  });
}

function getOperationType(query) {
  if (!query) return 'unknown';
  const trimmed = query.trim();
  if (trimmed.startsWith('query')) return 'query';
  if (trimmed.startsWith('mutation')) return 'mutation';
  if (trimmed.startsWith('subscription')) return 'subscription';
  return 'query'; // Default to query
}

function getOperationName(query) {
  if (!query) return 'Anonymous Operation';
  const match = query.match(/(?:query|mutation|subscription)\s+(\w+)/);
  return match ? match[1] : 'Anonymous Operation';
}

function formatValue(value) {
  if (value === null) return '<span class="json-null">null</span>';
  if (typeof value === 'string') return `<span class="json-string">"${value}"</span>`;
  if (typeof value === 'number') return `<span class="json-number">${value}</span>`;
  if (typeof value === 'boolean') return `<span class="json-boolean">${value}</span>`;
  return value;
}

function formatJSON(obj) {
  if (typeof obj !== 'object' || obj === null) {
    return formatValue(obj);
  }

  try {
    const json = JSON.stringify(obj, null, 2);
    return json
      // Handle nested structures
      .replace(/^( *)("[\w-]+"):/gm, '$1<span class="json-key">$2</span>:')
      // Handle string values
      .replace(/: "([^"]*)"/g, ': <span class="json-string">"$1"</span>')
      // Handle numbers
      .replace(/: (\d+\.?\d*)/g, ': <span class="json-number">$1</span>')
      // Handle booleans
      .replace(/: (true|false)/g, ': <span class="json-boolean">$1</span>')
      // Handle null
      .replace(/: (null)/g, ': <span class="json-null">$1</span>')
      // Handle array brackets and object braces
      .replace(/[\[\]{}]/g, '<span class="json-brace">$&</span>');
  } catch (e) {
    return String(obj);
  }
}

function highlightGraphQLSyntax(query) {
  return query
    // Comments
    .replace(/#[^\n]*/g, '<span class="graphql-comment">$&</span>')
    // Keywords
    .replace(/\b(query|mutation|subscription|fragment|on|type|input|enum|interface|union|scalar|directive|extend|schema)\b/g, '<span class="graphql-keyword">$1</span>')
    // Operation names
    .replace(/(?:query|mutation|subscription)\s+(\w+)/g, (match, name) => {
      return match.replace(name, `<span class="graphql-operation-name">${name}</span>`);
    })
    // Field names (including aliases)
    .replace(/(\w+\s*:)?\s*(\w+)(?=\s*[\{\(\@\:\)]|\s*$)/g, (match, alias, field) => {
      if (alias) {
        return `<span class="graphql-field">${alias.trim()}</span> <span class="graphql-field">${field}</span>`;
      }
      return `<span class="graphql-field">${field}</span>`;
    })
    // Arguments
    .replace(/(\w+):\s*([^,\)\n\}]+)/g, (match, name, value) => {
      return `<span class="graphql-argument-name">${name}</span>: <span class="graphql-argument-value">${value}</span>`;
    })
    // Variables
    .replace(/(\$\w+)/g, '<span class="graphql-variable">$1</span>')
    // Directives
    .replace(/(@\w+)/g, '<span class="graphql-directive">$1</span>')
    // Types
    .replace(/:\s*(\[?\w+!?\]?!?)/g, (match, type) => {
      return `: <span class="graphql-type">${type}</span>`;
    })
    // Braces and parentheses
    .replace(/([\{\}\(\)])/g, '<span class="graphql-brace">$1</span>')
    // Enum values (uppercase words)
    .replace(/\b([A-Z][A-Z0-9_]+)\b/g, '<span class="graphql-enum">$1</span>')
    // Scalar values
    .replace(/\b(true|false|null|\d+(\.\d+)?)\b/g, '<span class="graphql-scalar">$1</span>');
}

// Add this function to help with grouping
function getQueryGroup(operationName) {
  // Remove common suffixes and numbers
  const baseName = operationName
    .replace(/(?:Query|Mutation)$/, '')  // Remove Query/Mutation suffix
    .replace(/\d+$/, '')                 // Remove trailing numbers
    .replace(/([a-z])([A-Z])/g, '$1 $2') // Split camelCase
    .toLowerCase();
  
  // Get the first two words as the group
  const words = baseName.split(' ');
  return words.slice(0, 2).join(' ');
}

// Keep existing utility functions (formatGraphQLQuery, copyToClipboard, etc.) 