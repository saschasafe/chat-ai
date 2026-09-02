import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getDefaultVoice } from "../../utils/speech";

const STORAGE_KEY = "chat-ai-live-mode-settings";

export const DEFAULT_LIVE_SETTINGS = {
  language: "en",
  voice: getDefaultVoice("en"),
  visionEnabled: false,
  visionModel: "",
  source: "camera", // "camera" | "screen"
  deviceId: "",
  intervalMs: 4000,
};

function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return { ...DEFAULT_LIVE_SETTINGS, ...stored };
  } catch {
    return { ...DEFAULT_LIVE_SETTINGS };
  }
}

const LiveModeContext = createContext(null);

/**
 * Holds whether live mode is open plus its settings.
 *
 * The overlay itself is rendered by ChatPage, where the conversation state
 * lives, while the trigger sits in the prompt bar.
 */
export function LiveModeProvider({ children }) {
  const [isOpen, setIsOpen] = useState(false);
  const [settings, setSettings] = useState(loadSettings);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Settings are a convenience, ignore quota or privacy mode failures
    }
  }, [settings]);

  const updateSettings = useCallback((patch) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const open = useCallback((patch = {}) => {
    if (patch && Object.keys(patch).length > 0) {
      setSettings((prev) => ({ ...prev, ...patch }));
    }
    setIsOpen(true);
  }, []);

  const close = useCallback(() => setIsOpen(false), []);

  const value = useMemo(
    () => ({ isOpen, open, close, settings, updateSettings }),
    [close, isOpen, open, settings, updateSettings]
  );

  return (
    <LiveModeContext.Provider value={value}>{children}</LiveModeContext.Provider>
  );
}

export function useLiveMode() {
  const context = useContext(LiveModeContext);
  if (!context) {
    throw new Error("useLiveMode must be used within a LiveModeProvider");
  }
  return context;
}
