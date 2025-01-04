# Privacy Policy for GraphQL Request Inspector

## Overview

The GraphQL Request Inspector extension does not collect, store, or transmit any personal data outside of your browser. Here's what you need to know:

### What We Do Collect
- GraphQL network requests made on pages you visit
- Your extension preferences (like dark mode settings)
- Request history (stored locally in your browser)

### How We Use the Data
- All data processing happens locally in your browser
- Network requests are only monitored to display them in the DevTools panel
- Preferences are saved locally to remember your settings
- Request history is stored temporarily in your browser's local storage

### Data Storage Implementation
- Chrome Storage (Persistent)
  - Uses Chrome's built-in storage API
  - Stores user preferences and request history
  - Limited to 1000 historical requests
  - Can be cleared through Chrome's settings
- In-Memory Storage (Temporary)
  - Uses efficient LRU caching for recent requests
  - Implements message batching for performance
  - Cleared automatically when browser closes
  - No persistence beyond browser session
- Data Limits
  - Maximum 1000 historical requests
  - Message batching every 100ms
  - Rate limiting: 50 requests per second per tab

### Data Storage Location
- All data is stored locally in your browser using Chrome's storage API
- No data is sent to external servers
- Data can be cleared by clearing your browser data or uninstalling the extension

### Third-Party Services
- This extension does not use any third-party services
- No analytics or tracking code is included
- No data is shared with any third parties

## Permissions

The extension requires these permissions:
- `storage`: To save your preferences locally
- `*://*/*`: To monitor GraphQL network requests on websites you visit

## Data Security
- All data processing happens locally in your browser
- No sensitive data is collected or transmitted
- The extension follows Chrome's security best practices

## Updates to Privacy Policy
We will update this privacy policy as needed to ensure it accurately reflects our practices and complies with relevant regulations.

## Contact
For questions about this privacy policy or the extension's privacy practices, please visit our GitHub repository.

Last updated: [Current Date] 