// Utility functions for the extension
const utils = {
  calculateQueryDepth(query) {
    if (!query) return 0;
    const lines = query.split('\n');
    let maxDepth = 0;
    let currentDepth = 0;

    for (const line of lines) {
      if (line.includes('{')) currentDepth++;
      if (line.includes('}')) currentDepth--;
      maxDepth = Math.max(maxDepth, currentDepth);
    }

    return maxDepth;
  },

  formatBytes(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  },

  generateCurl(request) {
    return `curl '${request.url}' \\
  -H 'Content-Type: application/json' \\
  --data-raw '${JSON.stringify(request.body)}'`;
  },

  generateFetch(request) {
    return `fetch('${request.url}', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(${JSON.stringify(request.body, null, 2)})
})`;
  },

  debounce: (func, wait) => {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }
};

// Export for use in other files
window.utils = utils; 