const storage = {
  async saveRequest(request) {
    const history = await this.getHistory();
    history.unshift(request);
    // Keep only last 1000 requests
    if (history.length > 1000) history.pop();
    await chrome.storage.local.set({ history });
  },

  async getHistory() {
    const data = await chrome.storage.local.get('history');
    return data.history || [];
  },

  async clearHistory() {
    await chrome.storage.local.set({ history: [] });
  },

  async saveSettings(settings) {
    await chrome.storage.local.set({ settings });
  },

  async getSettings() {
    const result = await chrome.storage.local.get('settings');
    return result.settings || { theme: 'light', starredGroups: [] };
  }
};

window.storage = storage; 