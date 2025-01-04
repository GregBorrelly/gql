// State management
let requests = [];
let typeFilter = 'all';
let statusFilter = 'all';
let pendingDisplayUpdate = false;
let starredGroups = new Set();
let isGroupingEnabled = false;
let globalFilter = '';
let filterType = 'name';

// Input validation utilities
const InputValidation = {
  maxLength: 100,
  safeSearchRegex: /^[a-zA-Z0-9\s._\-:{}()[\]"']*$/,

  sanitizeInput(input) {
    if (!input) return '';
    // Trim and limit length
    input = input.trim().slice(0, this.maxLength);
    // Remove potentially dangerous characters
    return input.replace(/[^\w\s._\-:{}()[\]"']/g, '');
  },

  validateSearchInput(input) {
    return this.safeSearchRegex.test(input);
  }
};

// Helper function to check if two requests are duplicates
function isDuplicateRequest(newRequest, existingRequest) {
  // Compare query content
  const newQuery = newRequest.body?.query || newRequest.query || '';
  const existingQuery = existingRequest.body?.query || existingRequest.query || '';
  
  // Compare variables if they exist
  const newVars = JSON.stringify(newRequest.body?.variables || newRequest.variables || {});
  const existingVars = JSON.stringify(existingRequest.body?.variables || existingRequest.variables || {});
  
  return newQuery === existingQuery && newVars === existingVars;
}

// Helper function to add request without duplicates
function addRequestWithoutDuplicates(newRequest) {
  // Check last 5 requests for duplicates to avoid performance issues with large histories
  const recentRequests = requests.slice(0, 5);
  const isDuplicate = recentRequests.some(req => isDuplicateRequest(newRequest, req));
  
  if (!isDuplicate) {
    requests.unshift(newRequest);
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Apply dark theme by default
    themes.applyTheme('dark');

    // Setup event listeners
    setupEventListeners();
    
    // Clear any existing history on page load
    await storage.clearHistory();
    await storage.clearSettings();
    
    // Reset requests array
    requests = [];
    requestDisplayUpdate();
  } catch (e) {
    // Error handled silently
  }
});

function setupEventListeners() {
  // Global filter with debouncing
  const debouncedUpdate = utils.debounce(requestDisplayUpdate, 150);

  document.getElementById('filter-type')?.addEventListener('change', (e) => {
    filterType = e.target.value;
    const searchInput = document.getElementById('global-filter');
    if (searchInput) {
      searchInput.placeholder = filterType === 'name' 
        ? 'Filter by query name...' 
        : 'Filter in response data...';
    }
    debouncedUpdate();
  });

  document.getElementById('global-filter')?.addEventListener('input', (e) => {
    const rawInput = e.target.value.trim();
    
    // Validate and sanitize input
    if (!InputValidation.validateSearchInput(rawInput)) {
      e.target.value = InputValidation.sanitizeInput(rawInput);
      return;
    }
    
    globalFilter = e.target.value.trim().toLowerCase();
    debouncedUpdate();
  });

  document.getElementById('type-filter')?.addEventListener('change', (e) => {
    typeFilter = e.target.value;
    debouncedUpdate();
  });

  document.getElementById('status-filter')?.addEventListener('change', (e) => {
    statusFilter = e.target.value;
    debouncedUpdate();
  });

  // Group toggle button
  document.getElementById('group-toggle-btn').addEventListener('click', () => {
    isGroupingEnabled = !isGroupingEnabled;
    document.getElementById('group-toggle-btn').classList.toggle('active', isGroupingEnabled);
    requestDisplayUpdate();
  });

  // Clear button
  document.getElementById('clear-btn')?.addEventListener('click', async () => {
    requests = [];
    await storage.clearHistory();
    requestDisplayUpdate();
    
    // Reset details panel to empty state
    const detailsPanel = document.getElementById('details-panel');
    detailsPanel.innerHTML = `
      <div class="empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" style="width: 100px; height: 100px;">
          <rect width="200" height="200" fill="#1A1A1A"/>
          <g transform="translate(40, 40) scale(0.8)">
            <path d="
              M75 20 L125 45
              M125 45 L125 95
              M125 95 L75 120
              M75 120 L25 95
              M25 95 L25 45
              M25 45 L75 20
              M25 45 L125 95
              M125 45 L25 95
              M75 20 L75 120
            " stroke="white" stroke-width="4" fill="none"/>
            <circle cx="75" cy="20" r="10" fill="white"/>
            <circle cx="125" cy="45" r="10" fill="white"/>
            <circle cx="125" cy="95" r="10" fill="white"/>
            <circle cx="75" cy="120" r="10" fill="white"/>
            <circle cx="25" cy="95" r="10" fill="white"/>
            <circle cx="25" cy="45" r="10" fill="white"/>
            <circle cx="75" cy="70" r="12" fill="#FF69B4"/>
          </g>
          <g transform="translate(115, 115) rotate(-20)">
            <circle cx="0" cy="0" r="35" fill="none" stroke="white" stroke-width="8"/>
            <rect x="25" y="-4" width="45" height="8" fill="white" transform="rotate(45)" rx="4"/>
            <circle cx="0" cy="0" r="28" fill="none" stroke="#FF69B4" stroke-width="2" stroke-dasharray="4,4"/>
            <path d="M-20 -15 Q-10 -25 0 -20" stroke="white" stroke-width="3" fill="none"/>
          </g>
        </svg>
        <p>Select a request to view details</p>
      </div>
    `;
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
        batchData.forEach(request => {
          if (!requests.some(r => r.id === request.id)) {  // Only for new requests
            chrome.devtools.inspectedWindow.eval(
              'window.location.pathname',
              (result, isException) => {
                const currentPath = isException ? '/' : result;
                addRequestWithoutDuplicates({
                  ...request,
                  pagePath: currentPath
                });
              }
            );
          }
        });
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
              response: data.response,
              pagePath: requests[index].pagePath  // Preserve the original path
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
    if (!requests.some(r => r.id === message.data.id)) {  // Only for new requests
      chrome.devtools.inspectedWindow.eval(
        'window.location.pathname',
        (result, isException) => {
          const currentPath = isException ? '/' : result;
          addRequestWithoutDuplicates({
            ...message.data,
            pagePath: currentPath
          });
          requestDisplayUpdate();
        }
      );
    }
  } else if (message.type === 'request-completed') {
    const index = requests.findIndex(r => r.id === message.data.id);
    if (index !== -1) {
      requests[index] = {
        ...requests[index],
        status: message.data.status,
        duration: message.data.duration,
        response: message.data.response,
        pagePath: requests[index].pagePath  // Preserve the original path
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
    const matchesGlobalFilter = matchesFilter(request, globalFilter);
    return matchesType && matchesStatus && matchesGlobalFilter;
  });

  let html;
  
  if (isGroupingEnabled) {
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

    html = sortedGroups
      .map(([groupName, groupRequests]) => {
        const requestsHtml = groupRequests.map((request) => {
          const query = request.body?.query || request.query || '';
          const operationType = getOperationType(query);
          const operationName = getOperationName(query) || 'Anonymous Operation';
          const route = request.pagePath || '/';
          const matchLocations = globalFilter ? findMatchLocations(request, globalFilter) : [];
          const requestIndex = requests.indexOf(request); // Use original requests array index

          return `
            <div class="request-card ${request.status}" 
                 data-index="${requestIndex}" 
                 data-status="${request.status}"
                 data-type="${operationType.toLowerCase()}"
                 data-match-locations='${JSON.stringify(matchLocations)}'>
              <div class="request-info">
                <span class="operation-name">
                  <span class="query-type-pill ${operationType.toLowerCase()}">${operationType}</span>
                  <span class="operation-text">${highlightMatch(operationName, globalFilter)}</span>
                  ${matchLocations.length > 0 ? `<span class="match-indicator" title="${generateMatchTooltip(matchLocations)}">
                    <i class="mdi mdi-target"></i>
                    <span class="match-count">${matchLocations.length}</span>
                  </span>` : ''}
                </span>
                <span class="route-info">${highlightMatch(route, globalFilter)}</span>
              </div>
            </div>
          `;
        }).join('');

        return `
          <div class="request-group">
            <div class="group-header">
              <div class="group-header-left">
                <button class="star-btn ${starredGroups.has(groupName) ? 'starred' : ''}" 
                        data-group="${groupName}">
                  ${starredGroups.has(groupName) ? '' : '☆'}
                </button>
                ${highlightMatch(groupName, globalFilter)}
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
  } else {
    // Sequential view
    html = filteredRequests.map((request) => {
      const query = request.body?.query || request.query || '';
      const operationType = getOperationType(query);
      const operationName = getOperationName(query) || 'Anonymous Operation';
      const route = request.pagePath || '/';
      const matchLocations = globalFilter ? findMatchLocations(request, globalFilter) : [];
      const requestIndex = requests.indexOf(request); // Use original requests array index

      return `
        <div class="request-card ${request.status}" 
             data-index="${requestIndex}" 
             data-status="${request.status}"
             data-type="${operationType.toLowerCase()}"
             data-match-locations='${JSON.stringify(matchLocations)}'>
          <div class="request-info">
            <span class="operation-name">
              <span class="query-type-pill ${operationType.toLowerCase()}">${operationType}</span>
              <span class="operation-text">${highlightMatch(operationName, globalFilter)}</span>
              ${matchLocations.length > 0 ? `<span class="match-indicator" title="${generateMatchTooltip(matchLocations)}">
                <i class="mdi mdi-target"></i>
                <span class="match-count">${matchLocations.length}</span>
              </span>` : ''}
            </span>
            <span class="route-info">${highlightMatch(route, globalFilter)}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  container.innerHTML = html;
  setupEventHandlers(container);
}

function highlightMatch(text, filterValue) {
  if (!filterValue) return text;
  
  // Sanitize the filter value for safe regex usage
  const safeFilter = InputValidation.sanitizeInput(filterValue);
  try {
    const regex = new RegExp(`(${safeFilter})`, 'gi');
    return text.replace(regex, '<span class="highlight">$1</span>');
  } catch (e) {
    return text;
  }
}

function setupEventHandlers(container) {
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
      const requestIndex = parseInt(card.dataset.index);
      const request = requests[requestIndex]; // Use the original index to get the request
      if (request) {
        showDetails(request);
      }
    });
  });

  // Update group toggle button state
  document.getElementById('group-toggle-btn').classList.toggle('active', isGroupingEnabled);
}

function showDetails(request) {
  if (!request) {
    return;
  }

  const detailsPanel = document.getElementById('details-panel');
  const query = request.query || request.body?.query || '';
  
  const operationType = getOperationType(query);
  const operationName = getOperationName(query) || 'Anonymous Operation';
  
  // Get variables from all possible locations
  const variables = request.variables || request.body?.variables || request.requestBody?.variables;
  
  // Format and highlight the query
  const formattedQuery = formatGraphQLQuery(query);
  
  const highlightedQuery = highlightGraphQLSyntax(
    operationType === 'nrql' ? formattedQuery : formattedQuery
  );

  document.querySelectorAll('.request-card').forEach(card => {
    card.classList.remove('selected');
  });
  const selectedCard = document.querySelector(`[data-index="${requests.indexOf(request)}"]`);
  selectedCard.classList.add('selected');

  // Get match locations if there's a global filter
  const matchLocations = selectedCard.dataset.matchLocations ? JSON.parse(selectedCard.dataset.matchLocations) : [];

  // Format response with highlights if there's a global filter
  const formattedResponse = globalFilter ? 
    formatJSONWithHighlight(request.response, globalFilter).html : 
    formatJSON(request.response);

  detailsPanel.innerHTML = `
    <div class="details-content">
      <div class="details-header">
        <div class="details-title">${operationName}</div>
      </div>
      <div class="tabs">
        <div class="tab active" data-tab="query">Query</div>
        ${request.response ? '<div class="tab" data-tab="response">Response</div>' : ''}
      </div>
      <div class="tab-content">
        <div class="tab-panel" id="detail-query" style="display: block;">
          <div class="query-section">
            <button class="copy-btn" onclick="copyToClipboard(this, \`${formattedQuery.replace(/`/g, '\\`')}\`)">
              <i class="mdi mdi-content-copy"></i>
              <span>Copy</span>
            </button>
            <pre><code>${highlightedQuery}</code></pre>
          </div>
          ${variables ? `
            <div class="variables-section">
              <h3>Variables</h3>
              <pre><code>${formatJSON(variables)}</code></pre>
            </div>
          ` : ''}
        </div>
        ${request.response ? `
          <div class="tab-panel" id="detail-response" style="display: none;">
            <pre><code>${formattedResponse}</code></pre>
          </div>
        ` : ''}
      </div>
    </div>
  `;

  setupTabHandlers(detailsPanel);
  setupJsonToggles(detailsPanel);
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
    // Check if it's a NRQL query
    if (query.includes('nrql:"SELECT')) {
      const nrqlPart = query.match(/nrql:"(.*?)"/s)?.[1];
      if (nrqlPart) {
        return nrqlPart
          .replace(/\\n/g, '\n')
          .replace(/SELECT\s+/i, 'SELECT ')
          .replace(/FROM\s+/i, '\nFROM ')
          .replace(/WHERE\s+/i, '\nWHERE ')
          .replace(/TIMESERIES\s+/i, '\nTIMESERIES ')
          .replace(/SINCE\s+/i, '\nSINCE ')
          .replace(/UNTIL\s+/i, '\nUNTIL ')
          .replace(/\bAND\s+/ig, 'AND ')
          .replace(/\bAS\s+/ig, ' AS ')
          .replace(/\bIS\s+/ig, ' IS ')
          .replace(/\bNOT\s+/ig, ' NOT ')
          .replace(/\bNULL\b/ig, 'NULL')
          .replace(/\s{2,}/g, ' ')
          .replace(/,\s*/g, ',\n    ')
          .replace(/\n\s*\n/g, '\n');
      }
    }

    // First, remove all extra whitespace
    let formatted = query.trim().replace(/\s+/g, ' ');
    
    // Add spaces after keywords and fix initial structure
    formatted = formatted
      // Ensure space after 'query' keyword
      .replace(/^query/, 'query ')
      // Add space after operation name and arguments
      .replace(/(query\s+\w+)(\([^)]*\))?\s*{/, '$1 $2 {')
      // Add space after colons in arguments
      .replace(/(\w+):/g, '$1: ')
      // Fix spaces around argument values
      .replace(/:\s*{/g, ': {')
      .replace(/:\s*\[/g, ': [')
      // Add space after commas
      .replace(/,(?!\s)/g, ', ');
    
    // Second pass: handle nested structure
    let result = '';
    let depth = 0;
    let inBraces = false;
    let inParens = false;
    
    for (let i = 0; i < formatted.length; i++) {
      const char = formatted[i];
      const nextChar = formatted[i + 1] || '';
      const prevChar = formatted[i - 1] || '';
      
      switch (char) {
        case '{':
          if (prevChar !== ' ') result += ' ';
          result += '{\n' + '  '.repeat(depth + 1);
          depth++;
          inBraces = true;
          break;
        case '}':
          depth = Math.max(0, depth - 1);
          result = result.trimEnd() + '\n' + '  '.repeat(depth) + '}';
          inBraces = false;
          break;
        case '(':
          result += '(';
          inParens = true;
          break;
        case ')':
          result += ')';
          inParens = false;
          break;
        case ' ':
          // Only add space if not at the start of a line and not after certain characters
          if (result[result.length - 1] !== '\n' && !/[{(]/.test(prevChar)) {
            result += ' ';
          }
          break;
        default:
          // If we're starting a new field
          if (result[result.length - 1] === '\n') {
            result += '  '.repeat(depth);
          }
          result += char;
      }
      
      // Add newline after fields
      if (!inParens && char === ' ' && 
          nextChar !== '{' && nextChar !== '(' && 
          prevChar !== ')' && prevChar !== '{') {
        result += '\n' + '  '.repeat(depth);
      }
    }

    // Clean up
    result = result
      .replace(/\s+$/gm, '')  // Remove trailing spaces
      .replace(/\n\s*\n/g, '\n')  // Remove empty lines
      .replace(/{\s+}/g, '{ }')  // Clean up empty blocks
      .replace(/\(\s+\)/g, '()')  // Clean up empty parentheses
      .replace(/\(\s+/g, '(')  // Clean up spaces after opening parenthesis
      .replace(/\s+\)/g, ')')  // Clean up spaces before closing parenthesis
      .trim();

    return result;

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
  
  // Check for NRQL query pattern
  if (trimmed.includes('nrql:"SELECT')) {
    return 'nrql';
  }
  
  if (trimmed.startsWith('query')) return 'query';
  if (trimmed.startsWith('mutation')) return 'mutation';
  if (trimmed.startsWith('subscription')) return 'subscription';
  return 'query'; // Default to query
}

function getOperationName(query) {
  if (!query) return 'Anonymous Operation';
  
  // Handle NRQL queries
  if (query.includes('nrql:"SELECT')) {
    const nrqlQuery = query.match(/nrql:"(.*?)"/s)?.[1];
    if (nrqlQuery) {
      // Extract the first part of the SELECT statement
      const selectMatch = nrqlQuery.match(/SELECT\s+([^FROM]+)/i);
      if (selectMatch) {
        const selectPart = selectMatch[1].trim().split(' AS ')[0];
        return `NRQL Query: ${selectPart.slice(0, 30)}${selectPart.length > 30 ? '...' : ''}`;
      }
    }
    return 'NRQL Query';
  }
  
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
  // Check if it's a NRQL query
  if (query.includes('SELECT')) {
    return query
      // NRQL Keywords
      .replace(/\b(SELECT|FROM|WHERE|TIMESERIES|SINCE|UNTIL|AND|AS|IS|NOT|NULL)\b/gi, 
        '<span class="graphql-keyword">$1</span>')
      // Table names
      .replace(/\bFROM\s+(\w+)/g, 
        'FROM <span class="graphql-type">$1</span>')
      // Functions
      .replace(/(\w+)\(/g, 
        '<span class="graphql-field">$1</span>(')
      // Quoted strings
      .replace(/'([^']+)'/g, 
        '<span class="graphql-string">\'$1\'</span>')
      // Numbers with units
      .replace(/\b(\d+(?:\.\d+)?)\s*(DAY|DAYS|HOUR|HOURS|MINUTE|MINUTES)?\b/g, 
        '<span class="graphql-number">$1</span>$2')
      // Timestamps
      .replace(/\b(\d{13})\b/g, 
        '<span class="graphql-number">$1</span>')
      // Operators
      .replace(/\b(=|!=|>|<|>=|<=)\b/g, 
        '<span class="graphql-operator">$1</span>');
  }

  // Original GraphQL highlighting
  return query
    // First, handle the operation definition
    .replace(/^(query|mutation|subscription)\s+(\w+)(\s*\([^)]*\))?/g, (match, operation, name, args) => {
      return `<span class="graphql-keyword">${operation}</span> ` +
             `<span class="graphql-operation-name">${name}</span>` +
             (args ? highlightArguments(args) : '');
    })
    // Handle field arguments
    .replace(/(\w+)\s*\((.*?)\)/g, (match, field, args) => {
      return `<span class="graphql-field">${field}</span>(${highlightArguments(args)})`;
    })
    // Handle field names (but not inside argument values)
    .replace(/(\s|\{)(\w+)(?=\s|{|\(|$)/g, '$1<span class="graphql-field">$2</span>')
    // Handle special fields
    .replace(/__typename\b/g, '<span class="graphql-field">__typename</span>')
    // Handle braces
    .replace(/([{}])/g, '<span class="graphql-brace">$1</span>');
}

function highlightArguments(args) {
  return args
    // Highlight argument names
    .replace(/(\w+):/g, '<span class="graphql-argument-name">$1</span>:')
    // Highlight enum values
    .replace(/:\s*([A-Z][A-Z0-9_]*)\b/g, ': <span class="graphql-enum">$1</span>')
    // Highlight variables
    .replace(/\$(\w+)/g, '<span class="graphql-variable">$$1</span>')
    // Highlight string literals
    .replace(/"([^"]*?)"/g, '<span class="graphql-string">"$1"</span>')
    // Highlight numbers
    .replace(/:\s*(\d+(?:\.\d+)?)/g, ': <span class="graphql-number">$1</span>')
    // Highlight boolean and null
    .replace(/:\s*(true|false|null)\b/g, ': <span class="graphql-keyword">$1</span>');
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

function setupResponseFilter(request) {
  const filterInput = document.getElementById('response-filter');
  const filterMatches = document.getElementById('filter-matches');
  if (!filterInput || !filterMatches) return;

  let currentHighlightIndex = -1;
  let matches = [];

  filterInput.addEventListener('input', (e) => {
    const filterValue = e.target.value.trim().toLowerCase();
    const responseContent = document.getElementById('response-content');
    
    if (!filterValue) {
      // Reset highlighting when filter is empty
      responseContent.innerHTML = formatJSON(request.response);
      filterMatches.innerHTML = '';
      matches = [];
      currentHighlightIndex = -1;
      return;
    }

    // Format JSON with highlighting for matching values
    const { html, matchCount } = formatJSONWithHighlight(request.response, filterValue);
    responseContent.innerHTML = html;
    matches = document.querySelectorAll('.highlight');
    
    // Update matches count
    filterMatches.innerHTML = matchCount > 0 
      ? `<span class="match-count">${matchCount} matches found</span>` 
      : '<span class="no-matches">No matches found</span>';

    // Scroll to first match if exists
    if (matches.length > 0) {
      currentHighlightIndex = 0;
      matches[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
      matches[0].classList.add('current-highlight');
    }
  });

  // Add navigation buttons
  const navButtons = document.createElement('div');
  navButtons.className = 'filter-nav-buttons';
  navButtons.innerHTML = `
    <button class="nav-btn prev-match" title="Previous match">
      <i class="mdi mdi-chevron-up"></i>
    </button>
    <button class="nav-btn next-match" title="Next match">
      <i class="mdi mdi-chevron-down"></i>
    </button>
  `;
  filterInput.parentElement.appendChild(navButtons);

  // Handle navigation
  navButtons.querySelector('.prev-match').addEventListener('click', () => {
    if (matches.length === 0) return;
    matches[currentHighlightIndex]?.classList.remove('current-highlight');
    currentHighlightIndex = (currentHighlightIndex - 1 + matches.length) % matches.length;
    matches[currentHighlightIndex].classList.add('current-highlight');
    matches[currentHighlightIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  navButtons.querySelector('.next-match').addEventListener('click', () => {
    if (matches.length === 0) return;
    matches[currentHighlightIndex]?.classList.remove('current-highlight');
    currentHighlightIndex = (currentHighlightIndex + 1) % matches.length;
    matches[currentHighlightIndex].classList.add('current-highlight');
    matches[currentHighlightIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

function formatJSONWithHighlight(obj, filterValue) {
  if (typeof obj !== 'object' || obj === null) {
    return formatValueWithHighlight(obj, filterValue);
  }

  try {
    const json = JSON.stringify(obj, null, 2);
    let matchCount = 0;
    const html = json
      // Handle nested structures
      .replace(/^( *)("[\w-]+"):/gm, '$1<span class="json-key">$2</span>:')
      // Handle string values with highlighting
      .replace(/: "([^"]*)"/g, (match, value) => {
        if (value.toLowerCase().includes(filterValue)) {
          matchCount++;
          return `: <span class="json-string highlight">"${value}"</span>`;
        }
        return `: <span class="json-string">"${value}"</span>`;
      })
      // Handle numbers with highlighting
      .replace(/: (\d+\.?\d*)/g, (match, value) => {
        if (value.toString().toLowerCase().includes(filterValue)) {
          matchCount++;
          return `: <span class="json-number highlight">${value}</span>`;
        }
        return `: <span class="json-number">${value}</span>`;
      })
      // Handle booleans with highlighting
      .replace(/: (true|false)/g, (match, value) => {
        if (value.toLowerCase().includes(filterValue)) {
          matchCount++;
          return `: <span class="json-boolean highlight">${value}</span>`;
        }
        return `: <span class="json-boolean">${value}</span>`;
      })
      // Handle null with highlighting
      .replace(/: (null)/g, (match, value) => {
        if (value.toLowerCase().includes(filterValue)) {
          matchCount++;
          return `: <span class="json-null highlight">${value}</span>`;
        }
        return `: <span class="json-null">${value}</span>`;
      })
      // Handle array brackets and object braces
      .replace(/[\[\]{}]/g, '<span class="json-brace">$&</span>');

    return { html, matchCount };
  } catch (e) {
    return { html: String(obj), matchCount: 0 };
  }
}

function formatValueWithHighlight(value, filterValue) {
  let matchCount = 0;
  if (value === null) return { html: '<span class="json-null">null</span>', matchCount };
  
  if (typeof value === 'string') {
    if (value.toLowerCase().includes(filterValue)) {
      matchCount++;
      return { 
        html: `<span class="json-string highlight">"${value}"</span>`,
        matchCount 
      };
    }
    return { 
      html: `<span class="json-string">"${value}"</span>`,
      matchCount 
    };
  }
  
  if (typeof value === 'number') {
    if (value.toString().toLowerCase().includes(filterValue)) {
      matchCount++;
      return { 
        html: `<span class="json-number highlight">${value}</span>`,
        matchCount 
      };
    }
    return { 
      html: `<span class="json-number">${value}</span>`,
      matchCount 
    };
  }
  
  if (typeof value === 'boolean') {
    if (value.toString().toLowerCase().includes(filterValue)) {
      matchCount++;
      return { 
        html: `<span class="json-boolean highlight">${value}</span>`,
        matchCount 
      };
    }
    return { 
      html: `<span class="json-boolean">${value}</span>`,
      matchCount 
    };
  }
  
  return { html: value, matchCount };
}

function matchesFilter(request, filterValue) {
  if (!filterValue) return true;

  switch (filterType) {
    case 'name':
      // Only check operation name for name filter
      const operationName = request.operationName || 'Anonymous Operation';
      return operationName.toLowerCase().includes(filterValue);
    
    case 'response':
      // Use existing response matching functionality
      return request.response && JSON.stringify(request.response).toLowerCase().includes(filterValue);
    
    default:
      return false;
  }
}

function findMatchLocations(request, filterValue) {
  const locations = [];
  const matches = (value, path) => {
    if (value == null) return;
    if (typeof value === 'object') {
      Object.entries(value).forEach(([key, val]) => {
        matches(val, [...path, key]);
      });
    } else if (String(value).toLowerCase().includes(filterValue)) {
      locations.push({
        path: path.join('.'),
        value: String(value)
      });
    }
  };

  if (filterType === 'response' && request.response) {
    // For response filtering, search through the entire response object
    matches(request.response, ['response']);
  } else if (filterType === 'name') {
    // For name filtering, only look at the operation name
    if (request.operationName) {
      matches(request.operationName, ['operationName']);
    } else {
      matches('Anonymous Operation', ['operationName']);
    }
  }

  return locations;
}

function generateMatchTooltip(locations) {
  return locations.map(loc => `${loc.path}: ${truncateValue(loc.value)}`).join('\n');
}

function truncateValue(value, maxLength = 50) {
  if (value.length <= maxLength) return value;
  return value.substring(0, maxLength - 3) + '...';
}

// Keep existing utility functions (formatGraphQLQuery, copyToClipboard, etc.) 