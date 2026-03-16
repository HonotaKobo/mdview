type Theme = 'light' | 'dark' | 'auto';

export class ThemeManager {
  private currentTheme: Theme;
  private mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

  constructor() {
    const saved = localStorage.getItem('tsumugi-theme') as Theme | null;
    this.currentTheme = saved || 'auto';
    this.applyTheme();

    this.mediaQuery.addEventListener('change', () => {
      if (this.currentTheme === 'auto') this.applyTheme();
    });
  }

  setTheme(theme: Theme): void {
    this.currentTheme = theme;
    this.applyTheme();
    localStorage.setItem('tsumugi-theme', theme);
  }

  getTheme(): Theme {
    return this.currentTheme;
  }

  private applyTheme(): void {
    const isDark =
      this.currentTheme === 'auto'
        ? this.mediaQuery.matches
        : this.currentTheme === 'dark';
    document.documentElement.setAttribute(
      'data-theme',
      isDark ? 'dark' : 'light'
    );
  }
}
