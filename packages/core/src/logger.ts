import type { Logger } from "@roost/shared";
type Sink = (level: "info" | "warn" | "error", msg: string) => void;
const PATTERNS: RegExp[] = [
  /([A-Za-z0-9_-]*(?:token|secret|key|passwd|password)\s*[=:]\s*)\S+/gi,
  /(Bearer\s+)\S+/gi,
  /(ghp_|gho_|ghs_|github_pat_|glpat-|xox[baprs]-)[A-Za-z0-9_\-]+/g,
  /(sk-)[A-Za-z0-9]{20,}/g,
  /(AKIA)[0-9A-Z]{16}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
];
export function redact(s: string): string {
  return PATTERNS.reduce((acc, re) => acc.replace(re, (_m, p1 = "") => `${p1}***`), s);
}
export function createLogger(sink: Sink = (l, m) => console[l === "info" ? "log" : l](m)): Logger {
  const emit = (lvl: "info" | "warn" | "error") => (msg: string) => sink(lvl, redact(msg));
  return { info: emit("info"), warn: emit("warn"), error: emit("error") };
}
