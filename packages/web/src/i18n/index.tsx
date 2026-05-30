import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { STRINGS, type Locale } from "./strings";

const STORAGE_KEY = "roost.locale";

// Look a key up for the given locale; fall back to en, then the key itself.
function translate(locale: Locale, key: string): string {
  const entry = STRINGS[key];
  if (!entry) return key;
  return entry[locale] || entry.en || key;
}

interface LocaleContextValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: string) => string;
}

// Default value works without a provider, rendering en — so views tested
// in isolation (no LocaleProvider) still resolve to English.
const LocaleContext = createContext<LocaleContextValue>({
  locale: "en",
  setLocale: () => {},
  t: (key) => translate("en", key),
});

function initialLocale(): Locale {
  if (typeof localStorage === "undefined") return "en";
  return localStorage.getItem(STORAGE_KEY) === "zh" ? "zh" : "en";
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const t = useCallback((key: string) => translate(locale, key), [locale]);

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t }}>{children}</LocaleContext.Provider>
  );
}

export function useT(): LocaleContextValue {
  return useContext(LocaleContext);
}
