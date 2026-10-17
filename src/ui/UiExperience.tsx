import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { PanelsTopLeft } from 'lucide-react';

export type UiExperience = 'momentum' | 'studio' | 'classic';
const STORAGE_KEY = 'codemanus-ui-experience';

export function isUiExperience(value: string | null): value is UiExperience {
  return value === 'momentum' || value === 'studio' || value === 'classic';
}

export function readUiExperience(): UiExperience {
  const requested = new URLSearchParams(window.location.search).get('ui');
  if (isUiExperience(requested)) return requested;
  try { const saved = localStorage.getItem(STORAGE_KEY); return isUiExperience(saved) ? saved : 'momentum'; }
  catch { return 'momentum'; }
}

const ExperienceContext = createContext<{ experience: UiExperience; selectExperience: (value: UiExperience) => void }>({ experience: 'studio', selectExperience: () => undefined });

export function UiExperienceProvider({ children }: { children: ReactNode }) {
  const [experience, setExperience] = useState<UiExperience>(readUiExperience);
  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, experience); } catch { /* Storage is optional. */ } }, [experience]);
  function selectExperience(value: UiExperience) {
    setExperience(value);
    try { localStorage.setItem(STORAGE_KEY, value); } catch { /* Session-only selection still works. */ }
    const url = new URL(window.location.href);
    url.searchParams.set('ui', value);
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }
  return <ExperienceContext.Provider value={{ experience, selectExperience }}>{children}</ExperienceContext.Provider>;
}

export const useUiExperience = () => useContext(ExperienceContext);

export function UiExperienceSwitch({ className = '' }: { className?: string }) {
  const { experience, selectExperience } = useUiExperience();
  return <label className={`ui-experience-switch ${className}`}><PanelsTopLeft size={15} aria-hidden="true" /><select aria-label="Design theme" value={experience} onChange={event => { if (isUiExperience(event.target.value)) selectExperience(event.target.value); }}><option value="momentum">Study Momentum</option><option value="studio">Architecture Studio</option><option value="classic">Classic</option></select></label>;
}
