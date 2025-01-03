const storage = {
  _cache: {
    history: null,
    settings: null
  },
  _pendingWrites: [],
  _writeTimeout: null,
  _maxBatchSize: 10,
  _batchDelay: 1000,

  async _processPendingWrites() {
    if (this._pendingWrites.length === 0) return;
    
    const writes = this._pendingWrites.splice(0);
    const updates = {};
    
    writes.forEach(({key, value}) => {
      updates[key] = value;
      this._cache[key] = value;
    });
    
    await chrome.storage.local.set(updates);
  },

  _scheduleWrite(key, value) {
    this._pendingWrites.push({key, value});
    
    if (this._pendingWrites.length >= this._maxBatchSize) {
      clearTimeout(this._writeTimeout);
      this._processPendingWrites();
      return;
    }
    
    if (this._writeTimeout) clearTimeout(this._writeTimeout);
    this._writeTimeout = setTimeout(() => this._processPendingWrites(), this._batchDelay);
  },

  async saveRequest(request) {
    const history = await this.getHistory();
    history.unshift(request);
    if (history.length > 1000) history.pop();
    this._scheduleWrite('history', history);
  },

  async getHistory() {
    if (this._cache.history !== null) return this._cache.history;
    
    const data = await chrome.storage.local.get('history');
    this._cache.history = data.history || [];
    return this._cache.history;
  },

  async clearHistory() {
    this._cache.history = [];
    this._scheduleWrite('history', []);
  },

  async saveSettings(settings) {
    this._cache.settings = settings;
    this._scheduleWrite('settings', settings);
  },

  async getSettings() {
    if (this._cache.settings !== null) return this._cache.settings;
    
    const result = await chrome.storage.local.get('settings');
    this._cache.settings = result.settings || { theme: 'light', starredGroups: [] };
    return this._cache.settings;
  }
};

window.storage = storage; 