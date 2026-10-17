import { Moon, Sparkles, Sun } from 'lucide-react';
import { isThemeMode, type ThemeMode } from '../theme';
import { useUiExperience } from './UiExperience';

export function ThemePicker({ theme, onChange }: { theme: ThemeMode; onChange: (theme: ThemeMode) => void }) {
  const { experience } = useUiExperience();
  if (experience === 'momentum') return null;
  const Icon = theme === 'dark' ? Moon : theme === 'pearl' ? Sparkles : Sun;
  return <label className="studio-theme-picker"><Icon size={15} aria-hidden="true" /><select aria-label="Color theme" value={theme} onChange={event => { if (isThemeMode(event.target.value)) onChange(event.target.value); }}><option value="light">Light</option><option value="dark">Dark</option><option value="pearl">Pearl</option></select></label>;
}
