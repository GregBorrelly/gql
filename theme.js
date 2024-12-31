const themes = {
  light: {
    '--bg-dark': '#ffffff',
    '--bg-light': '#f8f9fa',
    '--text-primary': '#172b4d',
    '--border-color': '#e1e4e8',
    '--primary': '#E535AB',
    '--primary-light': '#f198d4',
    '--success': '#28a745',
    '--error': '#dc3545',
    '--warning': '#ffc107'
  },
  dark: {
    '--bg-dark': '#1e1e1e',
    '--bg-light': '#252526',
    '--text-primary': '#d4d4d4',
    '--border-color': '#404040',
    '--primary': '#E535AB',
    '--primary-light': '#f198d4',
    '--success': '#4ec9b0',
    '--error': '#f14c4c',
    '--warning': '#cca700'
  }
};

const applyTheme = (themeName) => {
  const theme = themes[themeName];
  Object.entries(theme).forEach(([key, value]) => {
    document.documentElement.style.setProperty(key, value);
  });
};

window.themes = { themes, applyTheme }; 