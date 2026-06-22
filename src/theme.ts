export type ThemeMode = 'dark' | 'light' | 'pearl';

export const themeModes: ThemeMode[] = ['dark', 'light', 'pearl'];

export function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'dark' || value === 'light' || value === 'pearl';
}

export function getNextTheme(theme: ThemeMode): ThemeMode {
  if (theme === 'dark') return 'light';
  if (theme === 'light') return 'pearl';
  return 'dark';
}

export function getThemeToggleLabel(theme: ThemeMode): string {
  if (theme === 'dark') return 'Light';
  if (theme === 'light') return 'Pearl';
  return 'Dark';
}

export function getThemeToggleTitle(theme: ThemeMode): string {
  return `Switch to ${getThemeToggleLabel(theme).toLowerCase()} mode`;
}
