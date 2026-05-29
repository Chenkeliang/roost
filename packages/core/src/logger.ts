import type { Logger } from "@roost/shared";
type Sink = (level: "info" | "warn" | "error", msg: string) => void;
const PATTERNS: RegExp[] = [
  /([A-Za-z0-9_-]*(?:token|secret|key|passwd|password)\s*[=:]\s*)\S+/gi,
  /(Bearer\s+)\S+/gi,
  /(ghp_|sk-|xox[baprs]-)[A-Za-z0-9-]+/g,
];
export function redact(s: string): string {
  return PATTERNS.reduce((acc, re) => acc.replace(re, (_m, p1 = "") => `${p1}***`), s);
}
export function createLogger(sink: Sink = (l, m) => console[l === "info" ? "log" : l](m)): Logger {
  const emit = (lvl: "info" | "warn" | "error") => (msg: string) => sink(lvl, redact(msg));
  return { info: emit("info"), warn: emit("warn"), error: emit("error") };
}
