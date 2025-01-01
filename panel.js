// State management
let requests = [];
let typeFilter = 'all';
let statusFilter = 'all';
let pendingDisplayUpdate = false;
let starredGroups = new Set();

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Load saved settings and starred groups
    const settings = await storage.getSettings();
    starredGroups = new Set(settings.starredGroups || []);
    
    // Apply dark theme by default
    themes.applyTheme('dark');

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

  document.getElementById('type-filter')?.addEventListener('change', (e) => {
    typeFilter = e.target.value;
    debouncedUpdate();
  });

  document.getElementById('status-filter')?.addEventListener('change', (e) => {
    statusFilter = e.target.value;
    debouncedUpdate();
  });

  // Clear button
  document.getElementById('clear-btn').addEventListener('click', async () => {
    requests = [];
    await storage.clearHistory();
    requestDisplayUpdate();
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
        const query = request.body?.query || request.query || '';
        const operationType = getOperationType(query);
        const operationName = getOperationName(query) || 'Anonymous Operation';

        return `
          <div class="request-card ${request.status}" 
               data-index="${filteredRequests.indexOf(request)}" 
               data-status="${request.status}"
               data-type="${operationType.toLowerCase()}">
            <div class="request-info">
              <span class="operation-name">${operationName}</span>
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
  const query = request.query || request.body?.query || '';
  console.log('Query from request:', query);
  
  const operationType = getOperationType(query);
  const operationName = getOperationName(query) || 'Anonymous Operation';
  
  // Get variables from all possible locations
  const variables = request.variables || request.body?.variables || request.requestBody?.variables;
  
  // Format and highlight the query
  const formattedQuery = formatGraphQLQuery(query);
  console.log('Formatted query:', formattedQuery);
  
  const highlightedQuery = highlightGraphQLSyntax(
    operationType === 'nrql' ? formattedQuery : formattedQuery
  );
  console.log('Highlighted query:', highlightedQuery);

  document.querySelectorAll('.request-card').forEach(card => {
    card.classList.remove('selected');
  });
  document.querySelector(`[data-index="${requests.indexOf(request)}"]`).classList.add('selected');

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
              <div class="variables-title">Variables</div>
              <div class="query-section">
                <button class="copy-btn" onclick="copyToClipboard(this, \`${JSON.stringify(variables, null, 2)}\`)">
                  <i class="mdi mdi-content-copy"></i>
                  <span>Copy</span>
                </button>
                <pre><code>${formatJSON(variables)}</code></pre>
              </div>
            </div>
          ` : ''}
        </div>
        ${request.response ? `
          <div class="tab-panel" id="detail-response" style="display: none;">
            <div class="query-section">
              <button class="copy-btn" onclick="copyToClipboard(this, \`${JSON.stringify(request.response, null, 2)}\`)">
                <i class="mdi mdi-content-copy"></i>
                <span>Copy</span>
              </button>
              <pre><code>${formatJSON(request.response)}</code></pre>
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
    console.log('Original query:', query);

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

    console.log('After first pass:', formatted);

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

    console.log('Final formatted result:', result);
    return result;

  } catch (e) {
    console.error('Error formatting query:', e);
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


// Keep existing utility functions (formatGraphQLQuery, copyToClipboard, etc.) 