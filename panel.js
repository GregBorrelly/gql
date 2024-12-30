// Move these back to global scope
let requests = [];
let searchTerm = '';

document.addEventListener('DOMContentLoaded', () => {
  // Only keep event listener setup here
  document.getElementById('search-input').addEventListener('input', (e) => {
    searchTerm = e.target.value.toLowerCase();
    updateDisplay();
  });

  document.getElementById('clear-btn').addEventListener('click', () => {
    requests = [];
    updateDisplay();
  });
});

// Create a connection to the background page
const backgroundPageConnection = chrome.runtime.connect({
  name: "devtools-page"
});

// Listen for messages from the background script
backgroundPageConnection.onMessage.addListener(function (message) {
  if (message.type === 'graphql-request') {
    requests.unshift(message.data);
    updateDisplay();
  }
});

// Notify the background page that a devtools instance is running
backgroundPageConnection.postMessage({
  type: 'init',
  tabId: chrome.devtools.inspectedWindow.tabId
});

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

function renderJSON(obj, level = 0) {
  if (typeof obj !== 'object' || obj === null) {
    return formatValue(obj);
  }

  const isArray = Array.isArray(obj);
  const items = Object.entries(obj);
  
  if (items.length === 0) {
    return isArray ? '[]' : '{}';
  }

  const indent = '  '.repeat(level);
  
  const content = items.map(([key, value]) => {
    const isObject = typeof value === 'object' && value !== null;
    const formattedValue = isObject ? '' : formatValue(value);
    const keyDisplay = isArray ? '' : `<span class="json-key">"${key}"</span>: `;
    
    let html = `
      <div class="json-item">
        <span class="${isObject ? 'json-toggle' : ''}">${keyDisplay}${isObject ? (isArray ? '[' : '{') : ''}${formattedValue}</span>
    `;

    if (isObject) {
      html += `
        <div class="json-item hidden-json">
          ${renderJSON(value, level + 1)}
          ${indent}${Array.isArray(value) ? ']' : '}'}
        </div>
      `;
    }

    html += '</div>';
    return html;
  }).join('');

  return content;
}

function updateDisplay() {
  const container = document.getElementById('requests');
  const filteredRequests = requests.filter(request => 
    JSON.stringify(request).toLowerCase().includes(searchTerm)
  );

  container.innerHTML = filteredRequests.map((request, index) => {
    const query = request.body?.query || '';
    const operationType = getOperationType(query);
    const operationName = getOperationName(query);
    const timestamp = new Date(request.timestamp).toLocaleTimeString();

    return `
      <div class="request-card" data-index="${index}">
        <div class="request-header">
          <div class="request-info">
            <span class="operation-name">${operationName}</span>
            <span class="operation-type ${operationType.toLowerCase()}">${operationType}</span>
            <span class="timestamp">${timestamp}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Add click handlers after the HTML is inserted
  document.querySelectorAll('.request-card').forEach((card, index) => {
    card.addEventListener('click', () => showDetails(index));
  });
}

function showDetails(index) {
  const request = requests[index];
  if (!request) return;  // Guard against invalid index

  const detailsPanel = document.getElementById('details-panel');
  const query = request.body?.query || '';
  const formattedQuery = formatGraphQLQuery(query);
  const operationType = getOperationType(query);
  const operationName = getOperationName(query);

  // Update selected state
  document.querySelectorAll('.request-card').forEach(card => {
    card.classList.remove('selected');
  });
  document.querySelector(`[data-index="${index}"]`).classList.add('selected');

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
        <div class="tab active" onclick="switchDetailTab(${index}, 'query')">Query</div>
        <div class="tab" onclick="switchDetailTab(${index}, 'payload')">Payload</div>
      </div>
      <div class="tab-content">
        <div class="tab-panel active" id="detail-query-${index}">
          <div class="query-section">
            <button class="copy-btn" onclick="copyToClipboard(\`${formattedQuery.replace(/`/g, '\\`')}\`)">
              <i class="mdi mdi-content-copy"></i>
              Copy
            </button>
            <pre>${formattedQuery}</pre>
          </div>
          ${request.body.variables ? `
            <div class="query-section" style="margin-top: 16px;">
              <button class="copy-btn" onclick="copyToClipboard('${JSON.stringify(request.body.variables, null, 2)}')">
                <i class="mdi mdi-content-copy"></i>
                Copy
              </button>
              <pre>${JSON.stringify(request.body.variables, null, 2)}</pre>
            </div>
          ` : ''}
        </div>
        <div class="tab-panel" id="detail-payload-${index}" style="display: none;">
          <div class="json-viewer">
            ${renderJSON(request.body)}
          </div>
        </div>
      </div>
    </div>
  `;

  // Add click handlers for JSON toggles in the details panel
  detailsPanel.querySelectorAll('.json-toggle').forEach(toggle => {
    toggle.onclick = (e) => {
      e.stopPropagation();
      toggle.classList.toggle('open');
      const nextSibling = toggle.nextElementSibling;
      if (nextSibling && nextSibling.classList.contains('json-item')) {
        nextSibling.classList.toggle('hidden-json');
      }
    };
  });
}

window.switchDetailTab = function(index, tabName) {
  const detailsPanel = document.getElementById('details-panel');
  const tabs = detailsPanel.querySelectorAll('.tab');
  const panels = detailsPanel.querySelectorAll('.tab-panel');
  
  tabs.forEach(tab => tab.classList.remove('active'));
  panels.forEach(panel => panel.style.display = 'none');
  
  const activeTab = detailsPanel.querySelector(`.tab:nth-child(${tabName === 'query' ? 1 : 2})`);
  const activePanel = detailsPanel.querySelector(`#detail-${tabName}-${index}`);
  
  activeTab.classList.add('active');
  activePanel.style.display = 'block';
};

window.copyToClipboard = copyToClipboard; 