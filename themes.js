const themes = {
  applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.getElementById('theme-icon').textContent = theme === 'light' ? '🌙' : '☀️';
  }
};

window.themes = themes; 