type Theme = 'light' | 'dark' | 'auto';

export class ThemeManager {
  private currentTheme: Theme;
  private mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

  constructor() {
    const saved = localStorage.getItem('mdview-theme') as Theme | null;
    this.currentTheme = saved || 'auto';
    this.applyTheme();

    this.mediaQuery.addEventListener('change', () => {
      if (this.currentTheme === 'auto') this.applyTheme();
    });
  }

  toggle(): void {
    const order: Theme[] = ['auto', 'light', 'dark'];
    const idx = order.indexOf(this.currentTheme);
    this.setTheme(order[(idx + 1) % order.length]);
  }

  setTheme(theme: Theme): void {
    this.currentTheme = theme;
    this.applyTheme();
    localStorage.setItem('mdview-theme', theme);
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

    const iconMoon = document.getElementById('icon-moon');
    const iconSun = document.getElementById('icon-sun');
    if (iconMoon && iconSun) {
      iconMoon.style.display = isDark ? 'none' : 'inline';
      iconSun.style.display = isDark ? 'inline' : 'none';
    }
  }
}
