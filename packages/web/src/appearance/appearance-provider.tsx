import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { applyAppearance, loadAppearance, saveAppearance, type Appearance } from './appearance';

interface AppearanceContextValue {
  appearance: Appearance;
  update: (change: Partial<Appearance>) => void;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

/**
 * Holds the appearance preferences, applies each change at once and saves it.
 * Turning Developer mode on switches to Compact density and turning it off
 * returns to Comfortable; density can still be set on its own afterwards
 * (EXPERIENCE.md Foundation).
 */
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<Appearance>(() => loadAppearance());

  useEffect(() => {
    applyAppearance(appearance);
  }, [appearance]);

  const update = useCallback((change: Partial<Appearance>) => {
    setAppearance((previous) => {
      const next = { ...previous, ...change };
      if (change.developerMode !== undefined && change.developerMode !== previous.developerMode && change.density === undefined) {
        next.density = change.developerMode ? 'compact' : 'comfortable';
      }
      saveAppearance(next);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ appearance, update }), [appearance, update]);
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): AppearanceContextValue {
  const context = useContext(AppearanceContext);
  if (context === null) throw new Error('useAppearance must be used inside <AppearanceProvider>');
  return context;
}
