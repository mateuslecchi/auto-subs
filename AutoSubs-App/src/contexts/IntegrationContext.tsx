import React, { createContext, useContext } from 'react';
import { useSettingsStore } from '@/stores/settings-store';

export type Integration = "davinci" | "premiere" | "aftereffects" | "filmcraft" | "standalone";

interface IntegrationContextType {
  selectedIntegration: Integration;
  setSelectedIntegration: (integration: Integration) => void;
  filmcraftToken: string;
  setFilmcraftToken: (token: string) => void;
}

const IntegrationContext = createContext<IntegrationContextType | null>(null);

export function IntegrationProvider({ children }: { children: React.ReactNode }) {
  const selectedIntegration = useSettingsStore((s) => s.preferredEditorIntegration);
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  // Keep the control credential in memory, never in the persisted settings store.
  const [filmcraftToken, setFilmcraftToken] = React.useState("");
  const setSelectedIntegration = React.useCallback((integration: Integration) => {
    updateSetting("preferredEditorIntegration", integration);
    // Standalone has no timeline to pull audio from; pin file mode on entry.
    // Deliberately not restored when switching away.
    if (integration === "standalone") {
      updateSetting("audioInputMode", "file");
    }
  }, [updateSetting]);

  return (
    <IntegrationContext.Provider value={{ selectedIntegration, setSelectedIntegration, filmcraftToken, setFilmcraftToken }}>
      {children}
    </IntegrationContext.Provider>
  );
}

export const useIntegration = () => {
  const context = useContext(IntegrationContext);
  if (!context) {
    throw new Error('useIntegration must be used within an IntegrationProvider');
  }
  return context;
};
