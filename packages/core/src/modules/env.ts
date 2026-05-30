import * as fs from "node:fs";
import * as path from "node:path";
import type {
  SyncModule,
  ModuleContext,
  Candidate,
  Selection,
  DriftReport,
  DriftItem,
  ChangeSet,
  ApplyPlan,
  ApplyResult,
  Health,
  EnvData,
  AliasItem,
  EnvVarItem,
  PathEntry,
} from "@roost/shared";
import { scanForSecrets } from "../secrets/scanner.js";
import { createOpBackend, createRbwBackend } from "../secrets/backend.js";
import { backupFiles } from "../apply.js";
import {
  loadEnvData,
  saveEnvData,
  emptyEnvData,
} from "../env-data.js";
import {
  defaultAgeKeyPath,
  envSecretPath,
  recipientFromKey,
  encryptEnvSecret,
  decryptEnvSecret,
} from "../env-crypto.js";

// ── paths ───────────────────────────────────────────────────────────────────

/** Local generated artifact — NOT committed, NOT tracked by chezmoi. */
export function envShPath(home: string): string {
  return path.join(home, ".config", "roost", "env.sh");
}

/** Roost-managed config dir under the user's home — excluded from dotfiles. */
export function roostConfigDir(home: string): string {
  return path.join(home, ".config", "roost");
}

const RC_FILES = [".zshrc", ".zprofile", ".bashrc", ".bash_profile"];

const SECRET_PLACEHOLDER = "<roost-secret:unset>";

// ── pure helpers ──────────────────────────────────────────────────────────────

function escapeSingleQuotes(value: string): string {
  // POSIX single-quote escaping: ' -> '\''
  return value.replace(/'/g, "'\\''");
}

// Defensive copy of the validator's identifier rule (see env-data.ts). Names are
// interpolated raw into env.sh, so generateEnvSh refuses to emit any item whose
// name isn't a POSIX identifier even if it somehow bypassed validateEnvData. (C1)
const SAFE_SHELL_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Comments are emitted after `# `; collapse any newline to a space so a crafted
// comment can never inject a second, executable line. (C2, belt-and-suspenders.)
function sanitizeComment(comment: string): string {
  return comment.replace(/\r?\n/g, " ");
}

/**
 * Render the flat POSIX-sh env file from structured data.
 *
 * The header is STATIC (no timestamp) so output is byte-identical across runs —
 * required for idempotent apply and meaningful diffs. Only `enabled` items are
 * emitted, in declaration order. Secret env values are inlined only when
 * `secretValues` carries them (apply time); otherwise a placeholder is emitted.
 */
export function generateEnvSh(data: EnvData, secretValues?: Map<string, string>): string {
  const lines: string[] = [];

  // Static header — must never change across runs.
  lines.push("# Managed by Roost — do not edit by hand.");
  lines.push("# Generated from roost/env.yaml. Regenerated on every `roost` apply.");
  lines.push("");

  // PATH
  // NOTE: non-secret PATH/alias/env values are written verbatim into env.sh and,
  // with `roost init --github`, pushed to the user's remote — mark sensitive
  // values as `secret` so they are encrypted instead. (M2)
  lines.push("# PATH");
  for (const entry of data.path) {
    if (!entry.enabled) continue;
    if (entry.comment) lines.push(`# ${sanitizeComment(entry.comment)}`);
    const v = entry.value;
    if (entry.position === "prepend") {
      lines.push(`export PATH="${v}:$PATH"`);
    } else {
      lines.push(`export PATH="$PATH:${v}"`);
    }
  }
  lines.push("");

  // Aliases
  lines.push("# Aliases");
  for (const a of data.aliases) {
    if (!a.enabled) continue;
    if (!SAFE_SHELL_NAME.test(a.name)) continue; // defensive — see C1
    if (a.comment) lines.push(`# ${sanitizeComment(a.comment)}`);
    lines.push(`alias ${a.name}='${escapeSingleQuotes(a.value)}'`);
  }
  lines.push("");

  // Environment
  lines.push("# Environment");
  for (const e of data.env) {
    if (!e.enabled) continue;
    if (!SAFE_SHELL_NAME.test(e.name)) continue; // defensive — see C1
    if (e.comment) lines.push(`# ${sanitizeComment(e.comment)}`);
    if (e.secret) {
      const resolved = secretValues?.get(e.name);
      if (resolved !== undefined) {
        lines.push(`export ${e.name}='${escapeSingleQuotes(resolved)}'`);
      } else {
        lines.push(`export ${e.name}='${SECRET_PLACEHOLDER}'`);
      }
    } else {
      lines.push(`export ${e.name}='${escapeSingleQuotes(e.value)}'`);
    }
  }
  lines.push("");

  // Functions
  lines.push("# Functions");
  for (const f of data.functions) {
    if (!f.enabled) continue;
    if (!SAFE_SHELL_NAME.test(f.name)) continue; // defensive — see C1
    if (f.comment) lines.push(`# ${sanitizeComment(f.comment)}`);
    lines.push(f.body);
  }
  lines.push("");

  return lines.join("\n");
}

const RC_MARKER_BEGIN = "# >>> roost env >>>";
const RC_MARKER_END = "# <<< roost env <<<";

// Matches a REAL marker block: the begin/end markers each on their own line with
// the source line between. Using one anchored regex (instead of substring
// `includes`) means a mere prose mention of the marker text is NOT a false
// positive, and it agrees with removeRcMarker's line-based stripping. (M3)
const RC_MARKER_BLOCK = /^# >>> roost env >>>$[\s\S]*?^# <<< roost env <<<$/m;

/** The exact idempotent source block Roost appends to each rc file. */
export function renderRcSourceLine(): string {
  return (
    `${RC_MARKER_BEGIN}\n` +
    `[ -f "$HOME/.config/roost/env.sh" ] && . "$HOME/.config/roost/env.sh"\n` +
    `${RC_MARKER_END}`
  );
}

/** True if the rc already contains the real Roost source block (not just prose). */
export function rcHasMarker(rcContent: string): boolean {
  return RC_MARKER_BLOCK.test(rcContent);
}

/**
 * Idempotently ensure the rc sources the Roost env file. If the marker block is
 * already present, returns the content unchanged. Otherwise appends the block.
 */
export function ensureRcSourced(rcContent: string): { content: string; changed: boolean } {
  if (rcHasMarker(rcContent)) {
    return { content: rcContent, changed: false };
  }
  const sep = rcContent.length === 0 || rcContent.endsWith("\n") ? "" : "\n";
  const prefix = rcContent.length === 0 ? "" : "\n";
  const content = `${rcContent}${sep}${prefix}${renderRcSourceLine()}\n`;
  return { content, changed: true };
}

/** Remove the Roost source block from rc content. */
export function removeRcMarker(rcContent: string): { content: string; changed: boolean } {
  if (!rcHasMarker(rcContent)) return { content: rcContent, changed: false };
  const lines = rcContent.split("\n");
  const out: string[] = [];
  let inBlock = false;
  for (const line of lines) {
    if (line.trim() === RC_MARKER_BEGIN) {
      inBlock = true;
      continue;
    }
    if (line.trim() === RC_MARKER_END) {
      inBlock = false;
      continue;
    }
    if (!inBlock) out.push(line);
  }
  return { content: out.join("\n"), changed: true };
}

const BLOCK_OPENERS = /^(if|case|for|while|until|function)\b|\{\s*$/;
const BLOCK_CLOSERS = /^(fi|esac|done)\b|^\}/;

interface ImportCandidates {
  aliases: AliasItem[];
  env: EnvVarItem[];
  path: PathEntry[];
}

/**
 * Conservative, read-only, line-based extraction of importable shell items from
 * an rc file. Only captures TOP-LEVEL (depth 0), non-indented, simple statements.
 * Skips anything inside a control block and any value containing command
 * substitution. Best-effort *suggestion* only — never authoritative.
 */
export function extractImportCandidates(rcContent: string): ImportCandidates {
  const aliases: AliasItem[] = [];
  const env: EnvVarItem[] = [];
  const pathEntries: PathEntry[] = [];

  let depth = 0;
  for (const rawLine of rcContent.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    const trimmed = line.trim();

    // Track block depth crudely. Closers first so single-line blocks net to 0.
    if (BLOCK_CLOSERS.test(trimmed)) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (BLOCK_OPENERS.test(trimmed)) {
      depth += 1;
      continue;
    }

    // Skip blank lines, comments, indented lines, and anything inside a block.
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    if (line !== trimmed) continue; // indented → not top-level
    if (depth > 0) continue;

    // Never import values with command substitution.
    const hasCmdSub = trimmed.includes("$(") || trimmed.includes("`");

    // alias name=...   (value forms: '...', "...", or a bare word)
    const aliasMatch = /^alias\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (aliasMatch) {
      const name = aliasMatch[1] ?? "";
      const rawValue = (aliasMatch[2] ?? "").trim();
      if (hasCmdSub) continue;
      const value = unquote(rawValue);
      if (value === null) continue;
      aliases.push({ kind: "alias", name, value, enabled: true });
      continue;
    }

    // export NAME=...  (PATH handled specially)
    const exportMatch = /^export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (exportMatch) {
      const name = exportMatch[1] ?? "";
      const rawValue = (exportMatch[2] ?? "").trim();
      if (name === "PATH") {
        const entry = parsePathExport(rawValue);
        if (entry) pathEntries.push(entry);
        continue;
      }
      if (hasCmdSub) continue;
      const value = unquote(rawValue);
      if (value === null) continue;
      env.push({ kind: "env", name, value, secret: false, enabled: true });
      continue;
    }
  }

  return { aliases, env, path: pathEntries };
}

/** Unquote a simple shell value. Returns null if it looks unsafe to import. */
function unquote(raw: string): string | null {
  if (raw.length === 0) return "";
  const first = raw[0];
  if (first === "'" && raw.endsWith("'") && raw.length >= 2) {
    return raw.slice(1, -1);
  }
  if (first === '"' && raw.endsWith('"') && raw.length >= 2) {
    const inner = raw.slice(1, -1);
    // Skip double-quoted values that reference other variables/expansions.
    if (inner.includes("$")) return null;
    return inner;
  }
  // Bare word — reject if it contains shell-significant chars or whitespace.
  if (/[\s'"$;&|<>()]/.test(raw)) return null;
  return raw;
}

/**
 * Parse `export PATH=...` into a single PathEntry when it is a simple prepend/append
 * of a literal segment around $PATH. Returns null for anything else (e.g. rewrites).
 */
function parsePathExport(raw: string): PathEntry | null {
  let inner = raw;
  if ((inner.startsWith('"') && inner.endsWith('"')) || (inner.startsWith("'") && inner.endsWith("'"))) {
    inner = inner.slice(1, -1);
  }
  if (inner.includes("$(") || inner.includes("`")) return null;

  const PATHVAR = /\$\{?PATH\}?/;
  if (!PATHVAR.test(inner)) return null;

  // Prepend: <seg>:$PATH  (a single literal segment, $VAR allowed e.g. $HOME/bin)
  const prepend = /^(.+?):\$\{?PATH\}?$/.exec(inner);
  if (prepend) {
    const seg = prepend[1] ?? "";
    if (seg.length === 0 || /\$\{?PATH\}?/.test(seg)) return null;
    return { kind: "path", value: seg, position: "prepend", enabled: true };
  }
  // Append: $PATH:<seg>
  const append = /^\$\{?PATH\}?:(.+)$/.exec(inner);
  if (append) {
    const seg = append[1] ?? "";
    if (seg.length === 0 || /\$\{?PATH\}?/.test(seg)) return null;
    return { kind: "path", value: seg, position: "append", enabled: true };
  }
  return null;
}

// ── candidate id helpers ──────────────────────────────────────────────────────

function managedId(kind: string, name: string): string {
  return `${kind}:${name}`;
}
function importId(kind: string, name: string): string {
  return `import:${kind}:${name}`;
}

/** Serialize the non-secret surface of EnvData for the secret scanner. */
function nonSecretSerialization(data: EnvData): string {
  const parts: string[] = [];
  for (const a of data.aliases) parts.push(`${a.name}=${a.value}`);
  for (const e of data.env) {
    if (e.secret) continue;
    parts.push(`${e.name}=${e.value}`);
  }
  for (const p of data.path) parts.push(p.value);
  return parts.join("\n");
}

function existingRcFiles(home: string): string[] {
  return RC_FILES.map((f) => path.join(home, f)).filter((p) => fs.existsSync(p));
}

/**
 * Read a file as utf8, returning null instead of throwing if it has vanished
 * between an existsSync check and the read (TOCTOU) or is otherwise unreadable. (L1)
 */
function readFileSafe(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

/**
 * Resolve every enabled secret env value into a name→plaintext map for inlining
 * into env.sh. Used by both apply and unmanage so a regenerated artifact keeps
 * real secret values rather than the `<roost-secret:unset>` placeholder. (L2)
 *
 * Per ADR-0004 a secret's `source` selects how the value is resolved:
 *  - `age` (or absent): decrypt `roost/env-secrets/<NAME>.age` with the local age key.
 *  - `ref`: resolve via the op/rbw backend (`exec`-only, I1/I3).
 *
 * Resolution is failure-safe (I10): if a source cannot produce a value the item
 * is SKIPPED (no entry in the map → generateEnvSh emits the placeholder, never a
 * half/blank assignment), with a warning carrying only the name (+ backend for
 * refs) — never the value, never a raw error that might contain it. (I6)
 */
async function resolveEnabledSecrets(ctx: ModuleContext, data: EnvData): Promise<Map<string, string>> {
  const secrets = new Map<string, string>();
  const keyPath = defaultAgeKeyPath(ctx.home);
  for (const e of data.env) {
    if (!e.secret || !e.enabled) continue;
    const src = e.source ?? { kind: "age" as const };
    if (src.kind === "ref") {
      const backend = src.backend === "op" ? createOpBackend(ctx.exec) : createRbwBackend(ctx.exec);
      try {
        const val = await backend.get(src.ref);
        secrets.set(e.name, val);
      } catch {
        // Never surface the caught error: its message may echo the secret/stderr.
        ctx.log.warn(
          `env: could not resolve secret "${e.name}" from ${src.backend} — using placeholder.`,
        );
      }
    } else {
      const plain = await decryptEnvSecret(ctx.exec, { repoDir: ctx.repoDir, name: e.name, keyPath });
      if (plain !== null) {
        secrets.set(e.name, plain);
      } else {
        ctx.log.warn(`env: could not decrypt secret "${e.name}" — using placeholder.`);
      }
    }
  }
  return secrets;
}

/**
 * `env.sh` can carry inlined secrets, so its backup copy must not be left
 * world-readable. `backupFiles` mirrors the source's absolute path under
 * backupDir; chmod that mirrored copy to 0600 if it exists. (M1)
 */
function chmodSecretBackups(backupDir: string, livePath: string): void {
  const mirrored = path.join(backupDir, livePath.replace(/^[/\\]/, ""));
  try {
    if (fs.existsSync(mirrored)) fs.chmodSync(mirrored, 0o600);
  } catch {
    // best-effort hardening — never fail apply over a backup chmod
  }
}

/**
 * Atomically write `content` to `dest` with mode 0600. The bytes go to a fresh
 * temp file in the SAME directory (so rename is atomic and stays on one device);
 * O_CREAT guarantees the 0600 mode regardless of any pre-existing file's perms,
 * then rename swaps it into place. This avoids the world-readable window that a
 * plain writeFileSync onto an existing 0644 file would open before chmod. (M1)
 */
function writeFile0600Atomic(dest: string, content: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = path.join(path.dirname(dest), `.${path.basename(dest)}.tmp-${process.pid}`);
  try {
    fs.writeFileSync(tmp, content, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmp, dest);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // best-effort cleanup
    }
    throw err;
  }
}

// ── envModule ─────────────────────────────────────────────────────────────────

export const envModule: SyncModule = {
  name: "env",

  async index(ctx: ModuleContext): Promise<import("@roost/shared").ModuleIndex> {
    // env is structural data injected via a generated file — no external tool to
    // probe, so it is always available. Count the managed structured surface.
    const data = loadEnvData(ctx.repoDir);
    const managed =
      data.aliases.length + data.env.length + data.path.length + data.functions.length;
    return { available: true, managed };
  },

  async discover(ctx: ModuleContext): Promise<Candidate[]> {
    const candidates: Candidate[] = [];

    // Managed items already authored in roost/env.yaml.
    const data = loadEnvData(ctx.repoDir);
    for (const a of data.aliases) {
      candidates.push({ id: managedId("alias", a.name), path: "roost/env.yaml", category: "env", recommendation: "track", note: "managed" });
    }
    for (const e of data.env) {
      candidates.push({ id: managedId("env", e.name), path: "roost/env.yaml", category: "env", recommendation: e.secret ? "encrypt" : "track", note: "managed" });
    }
    for (const p of data.path) {
      candidates.push({ id: managedId("path", p.value), path: "roost/env.yaml", category: "env", recommendation: "track", note: "managed" });
    }
    for (const f of data.functions) {
      candidates.push({ id: managedId("function", f.name), path: "roost/env.yaml", category: "env", recommendation: "track", note: "managed" });
    }

    // Read-only import suggestions from the user's rc files.
    for (const rc of existingRcFiles(ctx.home)) {
      let content: string;
      try {
        content = fs.readFileSync(rc, "utf8");
      } catch {
        continue;
      }
      const imp = extractImportCandidates(content);
      for (const a of imp.aliases) {
        candidates.push({ id: importId("alias", a.name), path: rc, category: "env", recommendation: "track", note: "importable from rc" });
      }
      for (const e of imp.env) {
        candidates.push({ id: importId("env", e.name), path: rc, category: "env", recommendation: "track", note: "importable from rc" });
      }
      for (const p of imp.path) {
        candidates.push({ id: importId("path", p.value), path: rc, category: "env", recommendation: "track", note: "importable from rc" });
      }
    }

    return candidates;
  },

  async status(ctx: ModuleContext, _sel: Selection): Promise<DriftReport> {
    const items: DriftItem[] = [];
    const data = loadEnvData(ctx.repoDir);

    // Compare the non-secret preview against the live artifact.
    const preview = generateEnvSh(data);
    const livePath = envShPath(ctx.home);
    const live = fs.existsSync(livePath) ? readFileSafe(livePath) : null;
    if (live === null) {
      items.push({ id: "env.sh", state: "untracked", detail: "env.sh not generated yet" });
    } else {
      items.push({ id: "env.sh", state: live === preview ? "synced" : "drift" });
    }

    // Check the rc marker block in each existing rc file.
    for (const rc of existingRcFiles(ctx.home)) {
      const content = readFileSafe(rc);
      if (content === null) continue;
      const has = rcHasMarker(content);
      items.push({
        id: `rc:${path.basename(rc)}`,
        state: has ? "synced" : "drift",
        detail: has ? undefined : "source line missing",
      });
    }

    return { module: "env", items };
  },

  async capture(ctx: ModuleContext, _sel: Selection): Promise<ChangeSet> {
    const data = loadEnvData(ctx.repoDir);
    const written: string[] = [];
    const encrypted: string[] = [];
    const blocked: string[] = [];

    // Secret scanner hard gate over non-secret fields + function bodies.
    const scanTarget = nonSecretSerialization(data) + "\n" + data.functions.map((f) => f.body).join("\n");
    const findings = scanForSecrets(scanTarget);
    if (findings.length > 0) {
      const ruleNames = findings.map((f) => f.rule).join(", ");
      ctx.log.warn(
        `env capture: a plaintext secret was detected in a non-secret field (${ruleNames}). ` +
        `Mark the offending env var as secret:true so Roost can encrypt it — capture blocked. ` +
        `(value not logged)`,
      );
      return { module: "env", written: [], encrypted: [], blocked: ["secret-in-plaintext"] };
    }

    if (ctx.dryRun) {
      // Report what would be written/encrypted without touching disk. A `ref`
      // secret (ADR-0004) is never encrypted, so it produces no ciphertext path.
      for (const e of data.env) {
        if (e.secret && (e.source?.kind ?? "age") === "age") {
          encrypted.push(envSecretPath(ctx.repoDir, e.name));
        }
      }
      return { module: "env", written: ["roost/env.yaml"], encrypted, blocked };
    }

    // Encrypt each secret env value that carries a fresh plaintext.
    const recipient = await recipientFromKey(ctx.exec, defaultAgeKeyPath(ctx.home));
    const persisted: EnvData = {
      schemaVersion: data.schemaVersion,
      aliases: data.aliases,
      path: data.path,
      functions: data.functions,
      env: [],
    };

    for (const e of data.env) {
      if (!e.secret) {
        persisted.env.push(e);
        continue;
      }
      // A `ref` secret (ADR-0004) keeps its locator in yaml and stores NO
      // ciphertext: the value is resolved on apply from op/rbw. Just blank the
      // (never-used) value and persist the item with its source.
      if (e.source?.kind === "ref") {
        persisted.env.push({ ...e, value: "" });
        continue;
      }
      if (e.value.length > 0) {
        if (recipient === null) {
          ctx.log.warn(
            `env capture: no age key available — cannot encrypt secret "${e.name}". ` +
            `Run \`roost init\`/\`age-keygen\` first. Skipping this value.`,
          );
          blocked.push(e.name);
        } else {
          const dest = await encryptEnvSecret(ctx.exec, {
            repoDir: ctx.repoDir,
            name: e.name,
            plaintext: e.value,
            recipient,
          });
          encrypted.push(dest);
        }
      }
      // Always blank the value in the committed yaml.
      persisted.env.push({ ...e, value: "" });
    }

    saveEnvData(ctx.repoDir, persisted);
    written.push("roost/env.yaml");
    return { module: "env", written, encrypted, blocked };
  },

  async apply(ctx: ModuleContext, _plan: ApplyPlan): Promise<ApplyResult> {
    const data = loadEnvData(ctx.repoDir);
    const livePath = envShPath(ctx.home);

    if (ctx.dryRun) {
      // Emit the would-be artifact (secrets redacted) — no writes.
      const preview = generateEnvSh(data);
      ctx.log.info(`env apply (dry-run): would write ${livePath}`);
      const skipped: string[] = [livePath];
      for (const rc of existingRcFiles(ctx.home)) {
        const content = readFileSafe(rc);
        if (content === null) continue;
        if (!rcHasMarker(content)) {
          ctx.log.info(`env apply (dry-run): would add source line to ${rc}`);
          skipped.push(rc);
        }
      }
      // preview is intentionally not logged in full (kept for callers/tests via generateEnvSh).
      void preview;
      return { module: "env", applied: [], backedUp: [], skipped };
    }

    // Decrypt secret env values into a Map for inlining.
    const secrets = await resolveEnabledSecrets(ctx, data);

    const applied: string[] = [];
    const backedUp: string[] = [];

    // Backup + write env.sh 0600 via temp-then-rename (no world-readable window).
    const newContent = generateEnvSh(data, secrets);
    const backupDir = path.join(ctx.home, ".roost-backups", "env");
    backedUp.push(...backupFiles([livePath], backupDir));
    chmodSecretBackups(backupDir, livePath);
    writeFile0600Atomic(livePath, newContent);
    applied.push(livePath);

    // Ensure each existing rc sources the file (idempotent).
    for (const rc of existingRcFiles(ctx.home)) {
      const content = readFileSafe(rc);
      if (content === null) continue;
      const { content: next, changed } = ensureRcSourced(content);
      if (changed) {
        backedUp.push(...backupFiles([rc], backupDir));
        fs.writeFileSync(rc, next, "utf8");
        applied.push(rc);
      }
    }

    return { module: "env", applied, backedUp, skipped: [] };
  },

  async diff(ctx: ModuleContext, _sel: Selection): Promise<string> {
    const data = loadEnvData(ctx.repoDir);
    const regenerated = generateEnvSh(data); // secrets redacted (placeholder)
    const livePath = envShPath(ctx.home);
    const live = (fs.existsSync(livePath) ? readFileSafe(livePath) : null) ?? "";
    if (live === regenerated) return "";

    const liveLines = live.split("\n");
    const newLines = regenerated.split("\n");
    const out: string[] = ["--- live env.sh", "+++ regenerated env.sh"];
    const max = Math.max(liveLines.length, newLines.length);
    for (let i = 0; i < max; i++) {
      const l = liveLines[i];
      const r = newLines[i];
      if (l === r) continue;
      if (l !== undefined) out.push(`-${l}`);
      if (r !== undefined) out.push(`+${r}`);
    }
    return out.join("\n");
  },

  async unmanage(ctx: ModuleContext, sel: Selection): Promise<ApplyResult> {
    const ids = sel.modules["env"] ?? [];
    const data = loadEnvData(ctx.repoDir);
    const idSet = new Set(ids);
    const removed: string[] = [];

    function keepAlias(a: AliasItem): boolean {
      if (idSet.has(managedId("alias", a.name))) {
        removed.push(managedId("alias", a.name));
        return false;
      }
      return true;
    }
    function keepEnv(e: EnvVarItem): boolean {
      if (idSet.has(managedId("env", e.name))) {
        removed.push(managedId("env", e.name));
        return false;
      }
      return true;
    }
    function keepPath(p: PathEntry): boolean {
      if (idSet.has(managedId("path", p.value))) {
        removed.push(managedId("path", p.value));
        return false;
      }
      return true;
    }

    const next: EnvData = {
      schemaVersion: data.schemaVersion,
      aliases: data.aliases.filter(keepAlias),
      env: data.env.filter(keepEnv),
      path: data.path.filter(keepPath),
      functions: data.functions.filter((f) => {
        if (idSet.has(managedId("function", f.name))) {
          removed.push(managedId("function", f.name));
          return false;
        }
        return true;
      }),
    };

    if (ctx.dryRun) {
      return { module: "env", applied: [], backedUp: [], skipped: removed };
    }

    saveEnvData(ctx.repoDir, next);

    const backedUp: string[] = [];
    // Regenerate the artifact to reflect the removals.
    const livePath = envShPath(ctx.home);
    const backupDir = path.join(ctx.home, ".roost-backups", "env");
    const isEmpty =
      next.aliases.length === 0 &&
      next.env.length === 0 &&
      next.path.length === 0 &&
      next.functions.length === 0;

    if (fs.existsSync(livePath) || !isEmpty) {
      // Re-inline the REMAINING secrets (decrypt like apply) so unmanaging one
      // item doesn't blank the others to the placeholder until the next apply. (L2)
      const secrets = await resolveEnabledSecrets(ctx, next);
      backedUp.push(...backupFiles([livePath], backupDir));
      chmodSecretBackups(backupDir, livePath);
      writeFile0600Atomic(livePath, generateEnvSh(next, secrets));
    }

    // If nothing remains, offer to remove the rc marker block (backup first).
    if (isEmpty) {
      for (const rc of existingRcFiles(ctx.home)) {
        const content = readFileSafe(rc);
        if (content === null) continue;
        const { content: stripped, changed } = removeRcMarker(content);
        if (changed) {
          backedUp.push(...backupFiles([rc], backupDir));
          fs.writeFileSync(rc, stripped, "utf8");
        }
      }
    }

    if (removed.length > 0) {
      ctx.log.warn(
        "unmanage: items removed from the working tree but git history is NOT purged. " +
        "If any removed file ever contained secrets, rotate them now and purge git history " +
        "with `git filter-repo` or BFG Repo Cleaner.",
      );
    }

    return { module: "env", applied: removed, backedUp, skipped: [] };
  },

  async doctor(ctx: ModuleContext): Promise<Health[]> {
    const health: Health[] = [];

    const rcFiles = existingRcFiles(ctx.home);
    health.push({
      name: "rc-files",
      ok: rcFiles.length > 0,
      detail: rcFiles.length > 0 ? rcFiles.map((r) => path.basename(r)).join(", ") : "no rc files found",
    });

    const wired = rcFiles.some((rc) => {
      const content = readFileSafe(rc);
      return content !== null && rcHasMarker(content);
    });
    health.push({
      name: "rc-sourced",
      ok: wired,
      detail: wired ? undefined : "no rc file sources ~/.config/roost/env.sh",
    });

    const recipient = await recipientFromKey(ctx.exec, defaultAgeKeyPath(ctx.home));
    health.push({
      name: "age-key",
      ok: recipient !== null,
      detail: recipient !== null ? undefined : "no age key — secret env vars cannot be encrypted",
    });

    // op / rbw availability — needed only for secret env items with a `ref`
    // source (ADR-0004). Probed via the single exec adapter. (I1/I3)
    for (const [name, cli] of [["op", "op"], ["rbw", "rbw"]] as const) {
      const probe = await ctx.exec.run(cli, ["--version"]);
      const ok = probe.code === 0;
      health.push({
        name,
        ok,
        detail: ok ? undefined : `${cli} not available — secret env vars referencing ${cli} cannot be resolved`,
      });
    }

    const livePath = envShPath(ctx.home);
    if (!fs.existsSync(livePath)) {
      health.push({ name: "env.sh", ok: false, detail: "not generated yet" });
    } else {
      const mode = fs.statSync(livePath).mode & 0o777;
      health.push({
        name: "env.sh",
        ok: mode === 0o600,
        detail: mode === 0o600 ? undefined : `mode is ${mode.toString(8)}, expected 600`,
      });
    }

    return health;
  },
};

// Re-export an empty data factory for callers that need a blank document.
export { emptyEnvData };
