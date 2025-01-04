# GraphQL Request Inspector

A Chrome DevTools extension for inspecting and analyzing GraphQL network requests in real-time.

## Features

- Monitor GraphQL queries and mutations in real-time
- Syntax highlighting for GraphQL queries
- Request grouping and filtering
- Response inspection with JSON formatting
- Support for NRQL queries
- Dark mode interface

## Installation

1. Install from the Chrome Web Store
2. Open Chrome DevTools (F12 or Cmd+Option+I)
3. Navigate to the "GraphQL" panel

## Privacy & Security

- This extension only monitors GraphQL network requests on the pages you visit
- No data is collected or transmitted outside your browser
- All data processing happens locally in your browser
- Only requires minimal permissions necessary for functionality

## Storage Implementation

The extension uses several storage mechanisms to ensure performance while maintaining privacy:

### Chrome Storage (Persistent)
- Uses `chrome.storage.local` to store:
  - User preferences (theme, starred groups)
  - Request history (limited to 1000 items)
- All data remains in your browser
- Can be cleared via Chrome's clear browsing data options

### In-Memory Storage (Temporary)
- Implements LRU (Least Recently Used) cache for recent requests
- Uses message queuing for performance optimization
- Data is cleared when the browser is closed
- No persistence beyond browser session

### Data Limits
- Request history: Maximum 1000 items
- Message batching: 100ms delay for performance
- Rate limiting: 50 requests per second per tab

## Permissions Explained

- `storage`: Used to save your preferences and settings
- `*://*/*`: Required to monitor GraphQL requests on websites you visit

## Support

For issues or feature requests, please visit our GitHub repository.

## License

MIT License 