import type { Translate } from "@roost/shared";
import { en } from "./en.js";
import { zh } from "./zh.js";
const CATALOGS: Record<string, Record<string, string>> = { en, zh };
export function createT(locale: string): Translate {
  const cat = CATALOGS[locale] ?? en;
  return (key, vars) => {
    const tmpl = cat[key] ?? en[key] ?? key;
    return tmpl.replace(/\{(\w+)\}/g, (_m, k) => vars?.[k] ?? `{${k}}`);
  };
}
