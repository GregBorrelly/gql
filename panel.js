// State management
let requests = [];
let typeFilter = 'all';
let statusFilter = 'all';
let currentTheme = 'light';
let starredGroups = new Set();
let pendingDisplayUpdate = false;

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
    requestDisplayUpdate();
  } catch (e) {
    console.error('Initialization error:', e);
  }
});

function setupEventListeners() {
  // Search and filters with debouncing
  const debouncedUpdate = utils.debounce(requestDisplayUpdate, 150);

  document.getElementById('type-filter').addEventListener('change', (e) => {
    typeFilter = e.target.value;
    debouncedUpdate();
  });

  document.getElementById('status-filter').addEventListener('change', (e) => {
    statusFilter = e.target.value;
    debouncedUpdate();
  });

  // Clear button
  document.getElementById('clear-btn').addEventListener('click', async () => {
    requests = [];
    await storage.clearHistory();
    requestDisplayUpdate();
  });

  // Theme toggle with debounced settings save
  const debouncedSaveSettings = utils.debounce(async (settings) => {
    await storage.saveSettings(settings);
  }, 1000);

  document.getElementById('theme-toggle').addEventListener('click', async () => {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    themes.applyTheme(currentTheme);
    document.getElementById('theme-icon').textContent = currentTheme === 'light' ? '🌙' : '☀️';
    
    const settings = await storage.getSettings();
    debouncedSaveSettings({ ...settings, theme: currentTheme });
  });
}

// Background connection
const backgroundPageConnection = chrome.runtime.connect({
  name: "devtools-page"
});

// Send init message with tab ID
backgroundPageConnection.postMessage({
  type: 'init',
  tabId: chrome.devtools.inspectedWindow.tabId
});

backgroundPageConnection.onMessage.addListener(async (message) => {
  // Handle batched messages
  if (message.type.endsWith('_batch')) {
    const baseType = message.type.replace('_batch', '');
    const batchData = message.data;

    switch (baseType) {
      case 'graphql-request':
        requests.unshift(...batchData);
        requestDisplayUpdate();
        break;
        
      case 'request-completed':
        let updated = false;
        batchData.forEach(data => {
          const index = requests.findIndex(r => r.id === data.id);
          if (index !== -1) {
            requests[index] = {
              ...requests[index],
              status: data.status,
              duration: data.duration,
              response: data.response
            };
            updated = true;
          }
        });
        if (updated) requestDisplayUpdate();
        break;
    }
    return;
  }

  // Handle individual messages (legacy support)
  if (message.type === 'graphql-request') {
    requests.unshift(message.data);
    requestDisplayUpdate();
  } else if (message.type === 'request-completed') {
    const index = requests.findIndex(r => r.id === message.data.id);
    if (index !== -1) {
      requests[index] = {
        ...requests[index],
        status: message.data.status,
        duration: message.data.duration,
        response: message.data.response
      };
      requestDisplayUpdate();
    }
  }
});

// Efficient display updates
function requestDisplayUpdate() {
  if (pendingDisplayUpdate) return;
  pendingDisplayUpdate = true;
  requestAnimationFrame(() => {
    updateDisplay();
    pendingDisplayUpdate = false;
  });
}

function updateDisplay() {
  const container = document.getElementById('requests');
  const filteredRequests = requests.filter(request => {
    const matchesType = typeFilter === 'all' || getOperationType(request.body?.query).toLowerCase() === typeFilter;
    const matchesStatus = statusFilter === 'all' || request.status === statusFilter;
    return matchesType && matchesStatus;
  });

  // Group the requests
  const groups = filteredRequests.reduce((acc, request) => {
    const operationName = request.operationName || 'Anonymous Operation';
    const group = getQueryGroup(operationName);
    if (!acc[group]) acc[group] = [];
    acc[group].push(request);
    return acc;
  }, {});

  // Sort groups to put starred ones first
  const sortedGroups = Object.entries(groups).sort(([groupA], [groupB]) => {
    const aStarred = starredGroups.has(groupA);
    const bStarred = starredGroups.has(groupB);
    if (aStarred && !bStarred) return -1;
    if (!aStarred && bStarred) return 1;
    return groupA.localeCompare(groupB);
  });

  // Build HTML efficiently
  const html = sortedGroups
    .map(([groupName, groupRequests]) => {
      const requestsHtml = groupRequests.map((request, index) => {
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
      }).join('');

      return `
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
            ${requestsHtml}
          </div>
        </div>
      `;
    })
    .join('');

  container.innerHTML = html;

  // Add event listeners efficiently
  const debouncedSaveSettings = utils.debounce(async (settings) => {
    await storage.saveSettings(settings);
  }, 1000);

  document.querySelectorAll('.star-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const groupName = btn.dataset.group;
      if (starredGroups.has(groupName)) {
        starredGroups.delete(groupName);
      } else {
        starredGroups.add(groupName);
      }
      
      const settings = await storage.getSettings();
      debouncedSaveSettings({
        ...settings,
        starredGroups: Array.from(starredGroups)
      });
      requestDisplayUpdate();
    });
  });

  document.querySelectorAll('.request-card').forEach(card => {
    card.addEventListener('click', () => {
      const request = filteredRequests[card.dataset.index];
      if (request) showDetails(request);
    });
  });
}

function showDetails(request) {
  if (!request) {
    console.log('[Panel] No request provided to showDetails');
    return;
  }

  const detailsPanel = document.getElementById('details-panel');
  const query = request.query || request.requestBody?.query || '';
  const formattedQuery = formatGraphQLQuery(query);
  const highlightedQuery = highlightGraphQLSyntax(formattedQuery);
  const operationType = getOperationType(query);
  const operationName = request.operationName || 'Anonymous Operation';

  document.querySelectorAll('.request-card').forEach(card => {
    card.classList.remove('selected');
  });
  document.querySelector(`[data-index="${requests.indexOf(request)}"]`).classList.add('selected');

  detailsPanel.innerHTML = `
    <div class="details-content">
      <div class="details-header">
        <div class="details-title">${operationName}</div>
        <div class="meta-info">
          <span class="operation-type ${operationType.toLowerCase()}">${operationType}</span>
          <span>${request.url}</span>
        </div>
      </div>
      <div class="tabs">
        <div class="tab active" data-tab="query">Query</div>
        <div class="tab" data-tab="payload">Payload</div>
        ${request.response ? '<div class="tab" data-tab="response">Response</div>' : ''}
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
        ${request.response ? `
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