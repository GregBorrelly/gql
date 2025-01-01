const themes = {
  dark: {
    '--bg-dark': '#0f0f0f',
    '--bg-light': '#1a1a1a',
    '--text-primary': '#d4d4d4',
    '--border-color': '#2a2a2a',
    '--primary': '#E535AB',
    '--primary-light': '#f198d4',
    '--hover-bg': 'rgba(229, 53, 171, 0.1)'
  },

  applyTheme(theme) {
    const themeColors = this[theme];
    if (!themeColors) return;

    // Apply CSS variables
    Object.entries(themeColors).forEach(([key, value]) => {
      document.documentElement.style.setProperty(key, value);
    });

    // Add dark mode class
    document.body.classList.add('dark-mode');
  }
};

window.themes = themes; 