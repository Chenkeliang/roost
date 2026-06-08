# Tauri Integration Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Tauri-webview integration gaps and sharpen feedback: external links open in the system browser; capture-blocked items show WHY (secret / too-large / managed); the 100MB capture cap becomes a configurable setting; git-push failures are surfaced clearly with a terminal fallback; and the 160MB `~/.config/raycast` cache is removed from backup.

**Architecture:** All additive — no architecture/contract breakage. A Tauri opener plugin + a tiny `openExternal` web helper handle external links. `ChangeSet` gains an optional `blockedDetail` field carrying per-item reasons. A new `roost/settings.yaml` holds `maxCaptureMB`, threaded into the existing `scanPathForSecrets` `maxBytes` param. The push endpoint flags auth failures; the Settings UI shows the full git error + a terminal hint.

**Tech Stack:** Tauri v2 + `tauri-plugin-opener`, TypeScript (strict), React, fastify, vitest, Node fs, js-yaml.

**Spec:** `docs/superpowers/specs/2026-06-08-roost-tauri-integration-fixes-design.md`. Adds ADR-0015.

**Context (verified against current code):**
- `packages/core/src/modules/dotfiles.ts`: `scanPathForSecrets(absPath, opts?: { maxFiles?; maxBytes?; maxScanFileBytes? })` returns `{ secretFiles, tooLarge, files, bytes }`; defaults `maxBytes = 100*1024*1024`. `capture` has 3 block sites that `blocked.push(id)`: `isRoostManaged(id)` (managed), `scan.tooLarge` (too-large), `scan.secretFiles.length>0` (secret). Returns `{ module, written, encrypted, blocked }`.
- `packages/core/src/modules/skills.ts`: `capture` blocks on `scan.tooLarge` and `scan.secretFiles.length>0` (via `scanPathForSecrets`), pushing to `blocked`.
- `packages/shared/src/types.ts`: `ChangeSet = { module; written: string[]; encrypted: string[]; blocked?: string[] }`.
- `packages/web/src/views/Overview.tsx`: holds `blocked: string[]` state + `handleEncryptRetry(paths)` (calls `addSelection("dotfiles-encrypt", p)` then re-capture) + a blocked panel (the "1 项被拦下 — 疑似密钥" UI).
- `packages/web/src/api.ts`: `removeSelection(module, id)`, `addSelection`, `gitPush()→GitOpResult{ok,output}`.
- `packages/cli/src/server.ts`: `POST /api/git/push` runs `git -C repoDir push`, returns `{ ok, output }`. `makeCtx`/`cache.invalidateAll()`/`reply.status()` available.
- `packages/web/src/views/Settings.tsx`: git push/pull buttons + inline `gitResult` (12px). Docs section renders `<a target="_blank" href>` (lines ~365-385).
- `packages/web/src-tauri/`: `Cargo.toml` (tauri v2 + tauri-plugin-shell), `src/main.rs` (has `.plugin(tauri_plugin_shell::init())`), `capabilities/default.json` (has shell:allow-execute). `@tauri-apps/api`+`@tauri-apps/cli` in web devDeps.
- Tests: core `pnpm exec vitest run <path>`; web `pnpm --filter @roost/web test`; cargo `cd packages/web/src-tauri && cargo check`. Build desktop: `pnpm build:desktop`.

---

## File Structure
**Create:** `docs/adr/0015-tauri-integration-fixes.md`; `packages/core/src/settings.ts` (+ test); `packages/web/src/openExternal.ts` (+ test).
**Modify:** `packages/web/src-tauri/{Cargo.toml,src/main.rs,capabilities/default.json}`, `packages/web/package.json`; `packages/shared/src/types.ts`; `packages/core/src/modules/{dotfiles.ts,skills.ts}` (+ tests), `packages/core/src/index.ts`; `packages/cli/src/server.ts` (+ test); `packages/web/src/{api.ts, views/Overview.tsx, views/Settings.tsx, i18n/strings.ts}` (+ tests).

---

## Task 1: ADR-0015
**Files:** Create `docs/adr/0015-tauri-integration-fixes.md`
- [ ] **Step 1:** Mirror `docs/adr/0014-skills-conflict-resolution.md` house style; content:
```markdown
# ADR-0015: Tauri integration fixes (opener, blockedDetail, maxCaptureMB)

- **Status**: ACCEPTED · 2026-06-08
- **Date**: 2026-06-08
- Extends: ADR-0013 (Tauri shell), ADR-0010 (capture/encrypt)

## Context
The Tauri webview differs from a browser: external links don't open, and the
100MB capture cap is hardcoded. Capture-blocked items lacked a reason, and
in-app git push fails silently when it can't reach git credentials.

## Decision
- Add `tauri-plugin-opener`; web opens external links via the opener in Tauri,
  `window.open` in a browser.
- `ChangeSet` gains an OPTIONAL `blockedDetail?: { id, reason }[]` (reason:
  secret | too-large | managed | error); `blocked: string[]` kept for back-compat.
- New `roost/settings.yaml` with `maxCaptureMB` (default 100), threaded into
  `scanPathForSecrets`'s maxBytes.
- Push failures surface the full git error + a terminal-fallback hint; the
  in-app push mechanism is unchanged (GUI credential limits are not bypassed).

## Consequences
- One Tauri plugin + one optional ChangeSet field + one settings file + UI.
- No architecture/contract break; macOS-only (I9).
```
- [ ] **Step 2:** `git add docs/adr/0015-tauri-integration-fixes.md && git commit -m "docs(adr): ADR-0015 Tauri integration fixes"`

---

## Task 2: A — external links via Tauri opener

**Files:** Modify `packages/web/src-tauri/Cargo.toml`, `src/main.rs`, `capabilities/default.json`, `packages/web/package.json`; Create `packages/web/src/openExternal.ts` + `packages/web/src/openExternal.test.ts`; Modify `packages/web/src/views/Settings.tsx`.

- [ ] **Step 1: Add deps.**
```bash
cd /Users/keliang/MacMove
pnpm --filter @roost/web add @tauri-apps/plugin-opener
cd packages/web/src-tauri && cargo add tauri-plugin-opener
```
(Confirm Cargo.toml now has `tauri-plugin-opener` and web package.json has `@tauri-apps/plugin-opener`.)

- [ ] **Step 2: Register the plugin** in `packages/web/src-tauri/src/main.rs` — add after the shell plugin line:
```rust
        .plugin(tauri_plugin_opener::init())
```
(Place it right after `.plugin(tauri_plugin_shell::init())`.)

- [ ] **Step 3: Capability.** In `packages/web/src-tauri/capabilities/default.json`, add `"opener:allow-open-url"` to the `permissions` array (alongside the existing shell permission). If the opener plugin's permission identifier differs in the installed version, use the one its docs specify (check `gen/schemas/` after `cargo check`); report what you used.

- [ ] **Step 4: cargo check** — `cd packages/web/src-tauri && cargo check 2>&1 | tail -15` (clean).

- [ ] **Step 5: Write failing test** `packages/web/src/openExternal.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { openExternal } from "./openExternal";

afterEach(() => { vi.restoreAllMocks(); delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; vi.resetModules(); });

describe("openExternal", () => {
  it("uses window.open in a browser (no Tauri)", async () => {
    const spy = vi.spyOn(window, "open").mockReturnValue(null);
    await openExternal("https://example.com");
    expect(spy).toHaveBeenCalledWith("https://example.com", "_blank", "noopener");
  });
});
```
(Testing the Tauri branch requires mocking the dynamic import of `@tauri-apps/plugin-opener`; the browser branch is the load-bearing test. Optionally add a Tauri-branch test with `vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }))` + setting `window.__TAURI_INTERNALS__ = {}` and asserting openUrl called — include it if straightforward.)

- [ ] **Step 6: Run, verify FAIL** — `pnpm --filter @roost/web test -- openExternal`

- [ ] **Step 7: Implement** `packages/web/src/openExternal.ts`:
```ts
// Open an external URL in the system browser. In a normal browser, window.open;
// inside Tauri (where window.open / <a target=_blank> are no-ops in the webview),
// use the opener plugin.
export async function openExternal(href: string): Promise<void> {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(href);
    return;
  }
  window.open(href, "_blank", "noopener");
}
```

- [ ] **Step 8: Run, verify PASS** + `pnpm --filter @roost/web typecheck`.

- [ ] **Step 9: Wire Settings doc links.** In `packages/web/src/views/Settings.tsx`, import `openExternal` from `../openExternal`, and change each doc `<a>` to keep `href` but intercept the click:
```tsx
<a key={label} href={href}
   onClick={(e) => { e.preventDefault(); void openExternal(href); }}
   style={{ ...row, color: "var(--text)", textDecoration: "none", justifyContent: "space-between" }}>
```
Also grep the whole web src for other external links (`grep -rn 'target="_blank"\|href="http' packages/web/src`) and route them through `openExternal` too (e.g. a bottom "Docs" link if present).

- [ ] **Step 10: Verify + commit.** `pnpm --filter @roost/web test` + `pnpm --filter @roost/web typecheck` + `pnpm lint`.
```bash
git add packages/web/src/openExternal.ts packages/web/src/openExternal.test.ts packages/web/src/views/Settings.tsx packages/web/package.json pnpm-lock.yaml packages/web/src-tauri/Cargo.toml packages/web/src-tauri/Cargo.lock packages/web/src-tauri/src/main.rs packages/web/src-tauri/capabilities/default.json
git commit -m "feat(desktop): open external links via Tauri opener (window.open is a no-op in webview)"
```

---

## Task 3: B — blockedDetail in shared + core capture

**Files:** Modify `packages/shared/src/types.ts`, `packages/core/src/modules/dotfiles.ts` (+ `dotfiles.test.ts`), `packages/core/src/modules/skills.ts` (+ `skills.test.ts`).

- [ ] **Step 1: shared types.** In `packages/shared/src/types.ts`, add above `ChangeSet`:
```ts
export type BlockReason = "secret" | "too-large" | "managed" | "error";
export interface BlockedItem { id: string; reason: BlockReason; detail?: string }
```
and add the optional field to `ChangeSet`:
```ts
export interface ChangeSet { module: string; written: string[]; encrypted: string[]; blocked?: string[]; blockedDetail?: BlockedItem[]; }
```

- [ ] **Step 2: dotfiles tests** — add to `packages/core/src/modules/dotfiles.test.ts` (match its harness; it already creates temp home/repo + selection). Add a test that captures (a) a managed path, (b) a too-large dir (create >100MB or set a tiny cap — simplest: a dir of >2001 files to trip maxFiles, OR rely on Task 5's maxBytes; here trip `maxFiles` with 2001 tiny files), (c) a secret-bearing file, and asserts `blockedDetail` contains the right reasons:
```ts
it("capture reports blockedDetail reasons", async () => {
  // secret file selected as a dotfile
  const secret = path.join(home, ".secretrc");
  fs.writeFileSync(secret, 'AKIAIOSFODNN7EXAMPLE aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
  const sel = { modules: { dotfiles: [secret] } };
  const cs = await dotfilesModule.capture(ctx(), sel);
  const d = cs.blockedDetail ?? [];
  expect(d.find((b) => b.id === secret)?.reason).toBe("secret");
});
```
(Use whatever ctx/home helpers the test file already defines. Add a too-large case if cheap; otherwise the secret + a managed case suffice — add a managed case using a path under `~/.config/roost`.)

- [ ] **Step 3: Run, verify FAIL.**

- [ ] **Step 4: dotfiles impl.** In `dotfiles.ts capture`, alongside the existing `const blocked: string[] = []`, add `const blockedDetail: BlockedItem[] = []` (import `BlockedItem`). At each of the 3 block sites push BOTH:
  - managed: `blocked.push(id); blockedDetail.push({ id, reason: "managed" });`
  - tooLarge: `blocked.push(id); blockedDetail.push({ id, reason: "too-large", detail: \`${Math.round(scan.bytes/1048576)}MB / ${scan.files} files\` });`
  - secret: `blocked.push(id); blockedDetail.push({ id, reason: "secret", detail: \`${scan.secretFiles.length} file(s)\` });`
  Return `{ module: "dotfiles", written, encrypted, blocked, blockedDetail }`.

- [ ] **Step 5: skills impl + test.** Same treatment in `skills.ts capture` (reasons `secret` / `too-large`). Add a skills.test.ts case asserting `blockedDetail` for a secret skill (reuse the existing AWS-key secret test setup, assert `reason: "secret"`).

- [ ] **Step 6: Verify + commit.**
```bash
pnpm --filter @roost/shared build && pnpm exec vitest run packages/core/src/modules/dotfiles.test.ts packages/core/src/modules/skills.test.ts
pnpm test && pnpm --filter @roost/core typecheck && pnpm lint
git add packages/shared/src/types.ts packages/core/src/modules/dotfiles.ts packages/core/src/modules/dotfiles.test.ts packages/core/src/modules/skills.ts packages/core/src/modules/skills.test.ts
git commit -m "feat(core): ChangeSet.blockedDetail — per-item block reasons (secret/too-large/managed)"
```

---

## Task 4: B — Overview renders reasons + i18n

**Files:** Modify `packages/web/src/api.ts` (re-export BlockedItem type), `packages/web/src/views/Overview.tsx` (+ `Overview` test if present), `packages/web/src/i18n/strings.ts`.

- [ ] **Step 1: api.ts** — ensure `ChangeSet`/`BlockedItem` types flow to web. `api.ts` re-exports shared types (`ChangeSet`); add `BlockedItem`/`BlockReason` to the re-export from `@roost/shared`.

- [ ] **Step 2: i18n** — add to `strings.ts` (en+zh): `overview.blocked.secret` ("suspected secret"/"疑似密钥"), `overview.blocked.tooLarge` ("too large — exceeds the capture size limit"/"太大,超过捕获上限"), `overview.blocked.managed` ("already managed by Roost"/"已被 Roost 管理"), `overview.blocked.error` ("error"/"错误"), `overview.blocked.remove` ("Remove"/"移除"), `overview.blocked.raiseLimit` ("Raise the limit in Settings"/"可在设置调高上限").

- [ ] **Step 3: Overview.tsx** — capture the `blockedDetail` from the capture result (store `blockedDetail: BlockedItem[]` state alongside `blocked`). Render the blocked panel grouped by reason:
  - For `reason==="secret"`: existing copy + the existing 「加密并重试」 button (handleEncryptRetry).
  - For `reason==="too-large"`: show `t("overview.blocked.tooLarge")` + `detail` + a **Remove** button → `await removeSelection("dotfiles", id); await fetchData();` + a note `t("overview.blocked.raiseLimit")`. NO encrypt-retry.
  - For `reason==="managed"`/`"error"`: show the reason text, no action.
  - Fallback: if `blockedDetail` is absent (older capture), keep the current `blocked`-based rendering.
  Import `removeSelection` from `../api`.

- [ ] **Step 4: test** — if an Overview test exists, add a case: a capture result with `blockedDetail: [{id:"/x", reason:"too-large", detail:"160MB"}]` renders a Remove button and the too-large text, and clicking Remove calls `removeSelection("dotfiles","/x")`. If no Overview test file exists, create a minimal one mirroring other view tests' api-mock pattern. Run `pnpm --filter @roost/web test -- Overview`.

- [ ] **Step 5: Verify + commit.** `pnpm --filter @roost/web test` + typecheck + lint.
```bash
git add packages/web/src/api.ts packages/web/src/views/Overview.tsx packages/web/src/i18n/strings.ts packages/web/src/Overview.test.tsx 2>/dev/null
git commit -m "feat(web): blocked panel shows per-item reason; too-large gets Remove not encrypt-retry"
```

---

## Task 5: E — `maxCaptureMB` setting in core

**Files:** Create `packages/core/src/settings.ts` + `packages/core/src/settings.test.ts`; Modify `packages/core/src/modules/dotfiles.ts` (+ test), `packages/core/src/index.ts`.

- [ ] **Step 1: settings tests** `packages/core/src/settings.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs"; import * as os from "node:os"; import * as path from "node:path";
import { DEFAULT_ROOST_SETTINGS, loadRoostSettings, saveRoostSettings } from "./settings.js";
let repo: string;
beforeEach(() => { repo = fs.mkdtempSync(path.join(os.tmpdir(), "roost-set-")); });
afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });
describe("roost settings", () => {
  it("defaults maxCaptureMB to 100", () => { expect(DEFAULT_ROOST_SETTINGS.maxCaptureMB).toBe(100); });
  it("returns defaults when no file", () => { expect(loadRoostSettings(repo)).toEqual(DEFAULT_ROOST_SETTINGS); });
  it("round-trips", () => { saveRoostSettings(repo, { maxCaptureMB: 500 }); expect(loadRoostSettings(repo).maxCaptureMB).toBe(500); expect(fs.existsSync(path.join(repo, "roost", "settings.yaml"))).toBe(true); });
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement** `packages/core/src/settings.ts`:
```ts
import * as fs from "node:fs"; import * as path from "node:path"; import * as yaml from "js-yaml";
export interface RoostSettings { maxCaptureMB: number }
export const DEFAULT_ROOST_SETTINGS: RoostSettings = { maxCaptureMB: 100 };
function p(repoDir: string) { return path.join(repoDir, "roost", "settings.yaml"); }
export function loadRoostSettings(repoDir: string): RoostSettings {
  try {
    const raw = yaml.load(fs.readFileSync(p(repoDir), "utf8"));
    if (raw && typeof raw === "object" && typeof (raw as { maxCaptureMB?: unknown }).maxCaptureMB === "number") {
      return { maxCaptureMB: (raw as { maxCaptureMB: number }).maxCaptureMB };
    }
  } catch { /* fall through */ }
  return { ...DEFAULT_ROOST_SETTINGS };
}
export function saveRoostSettings(repoDir: string, s: RoostSettings): void {
  fs.mkdirSync(path.join(repoDir, "roost"), { recursive: true });
  fs.writeFileSync(p(repoDir), yaml.dump(s), "utf8");
}
```

- [ ] **Step 4: Export** from `packages/core/src/index.ts`: `export { DEFAULT_ROOST_SETTINGS, loadRoostSettings, saveRoostSettings } from "./settings.js"; export type { RoostSettings } from "./settings.js";`

- [ ] **Step 5: Wire into dotfiles capture.** In `dotfiles.ts capture`, at the top read `const maxBytes = loadRoostSettings(ctx.repoDir).maxCaptureMB * 1024 * 1024;` and pass `scanPathForSecrets(id, { maxBytes })` at each scan call. (Import `loadRoostSettings`.) Add a dotfiles test: with `saveRoostSettings(repo, { maxCaptureMB: 0 })`, even a small dir trips `too-large` (proves the setting is honored). Run the dotfiles tests.

- [ ] **Step 6: Verify + commit.**
```bash
pnpm exec vitest run packages/core/src/settings.test.ts packages/core/src/modules/dotfiles.test.ts
pnpm test && pnpm --filter @roost/core typecheck && pnpm lint
git add packages/core/src/settings.ts packages/core/src/settings.test.ts packages/core/src/index.ts packages/core/src/modules/dotfiles.ts packages/core/src/modules/dotfiles.test.ts
git commit -m "feat(core): configurable maxCaptureMB (roost/settings.yaml) wired into capture size guard"
```

---

## Task 6: E — `/api/settings` + Settings UI

**Files:** Modify `packages/cli/src/server.ts` (+ `server.test.ts`), `packages/web/src/api.ts`, `packages/web/src/views/Settings.tsx`, `packages/web/src/i18n/strings.ts`.

- [ ] **Step 1: server tests** (append to server.test.ts): `GET /api/settings` returns `{ maxCaptureMB: 100 }` default; `POST /api/settings` with `{ maxCaptureMB: 250 }` persists (re-GET returns 250). Use the `buildServer`+inject+tmp-repo pattern.

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: server impl** — import `loadRoostSettings, saveRoostSettings` from `@roost/core`; add:
```ts
  server.get("/api/settings", async (_req, reply) => reply.send(loadRoostSettings(repoDir)));
  server.post("/api/settings", async (req, reply) => {
    const b = (req.body ?? {}) as { maxCaptureMB?: unknown };
    const n = typeof b.maxCaptureMB === "number" && b.maxCaptureMB > 0 ? b.maxCaptureMB : 100;
    saveRoostSettings(repoDir, { maxCaptureMB: n });
    cache.invalidateAll();
    return reply.send({ ok: true, maxCaptureMB: n });
  });
```

- [ ] **Step 4: web api.ts** — `getSettings(): Promise<{maxCaptureMB:number}>` (GET /api/settings) + `saveSettings(maxCaptureMB:number)` (POST). Mirror existing helper style.

- [ ] **Step 5: Settings.tsx** — add a "最大捕获大小 (MB)" number input bound to a `maxCaptureMB` state (load via getSettings on mount), saving via `saveSettings(value)` on change/blur, with a note `t("settings.maxCapture.note")` ("Raising this enlarges the repo & every push; cache dirs like raycast aren't worth backing up"). Add i18n keys `settings.maxCapture.label`/`.note` (en+zh).

- [ ] **Step 6: Verify + commit.**
```bash
pnpm exec vitest run packages/cli/src/server.test.ts && pnpm --filter @roost/cli typecheck
pnpm --filter @roost/web test && pnpm --filter @roost/web typecheck && pnpm lint
git add packages/cli/src/server.ts packages/cli/src/server.test.ts packages/web/src/api.ts packages/web/src/views/Settings.tsx packages/web/src/i18n/strings.ts
git commit -m "feat: /api/settings + Settings UI for maxCaptureMB"
```

---

## Task 7: D — push failure surfacing

**Files:** Modify `packages/cli/src/server.ts` (+ `server.test.ts`), `packages/web/src/api.ts`, `packages/web/src/views/Settings.tsx`, `packages/web/src/i18n/strings.ts`.

- [ ] **Step 1: server test** — `POST /api/git/push` on a repo with no remote (or a bogus remote) returns `ok:false` and, when output matches an auth pattern, includes `hint: "auth"`. Simplest deterministic test: set up a tmp git repo with a remote URL that fails fast, OR unit-test a small exported `classifyGitError(output): "auth" | undefined` helper. Prefer extracting + testing `classifyGitError` (pure, deterministic):
```ts
it("classifyGitError flags auth failures", () => {
  expect(classifyGitError("fatal: could not read Username for 'https://github.com'")).toBe("auth");
  expect(classifyGitError("Authentication failed")).toBe("auth");
  expect(classifyGitError("Everything up-to-date")).toBeUndefined();
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: server impl** — add an exported pure helper in server.ts (or a small util):
```ts
export function classifyGitError(output: string): "auth" | undefined {
  return /authentication failed|could not read username|could not read password|permission denied|fatal: could not read|terminal prompts disabled/i.test(output) ? "auth" : undefined;
}
```
In `/api/git/push`, on `!ok` set `hint = classifyGitError(output)` and return `{ ok, output, hint }`. (Set `GIT_TERMINAL_PROMPT=0` in the exec env so a credential-less push fails fast instead of hanging: pass `{ env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }` to `exec.run` if the exec adapter supports env — check; if not, leave it, the classify still works.)

- [ ] **Step 4: web api.ts** — extend `GitOpResult` with `hint?: "auth"`.

- [ ] **Step 5: Settings.tsx** — on push failure, render the result PROMINENTLY (not 12px): a bordered red block showing the full `output` (monospace, selectable), and when `hint==="auth"` (or output matches auth) append `t("settings.git.authHint")` = "In-app push may lack git credentials. Run in a terminal: `cd <repoPath> && git push`" (en) / 中文等价, interpolating the repo path from `gitStatus`/health. Don't auto-clear the error.

- [ ] **Step 6: Verify + commit.**
```bash
pnpm exec vitest run packages/cli/src/server.test.ts && pnpm --filter @roost/cli typecheck
pnpm --filter @roost/web test && pnpm --filter @roost/web typecheck && pnpm lint
git add packages/cli/src/server.ts packages/cli/src/server.test.ts packages/web/src/api.ts packages/web/src/views/Settings.tsx packages/web/src/i18n/strings.ts
git commit -m "feat: surface git push failures prominently + terminal fallback hint (auth)"
```

---

## Task 8: C — remove raycast + desktop rebuild + regression

**Files:** none (operational + verification).

- [ ] **Step 1: Remove raycast from backup** (config repo). Use the CLI against the real repo:
```bash
cd /Users/keliang/MacMove
pnpm --filter @roost/core build && pnpm --filter @roost/cli build
node packages/cli/dist/index.js unmanage dotfiles /Users/keliang/.config/raycast
grep -c "config/raycast" ~/.local/share/chezmoi/roost/selection.yaml || echo "raycast removed from selection (good)"
```
Expected: selection.yaml no longer lists `/Users/keliang/.config/raycast`. (It was never captured, so nothing to forget.)

- [ ] **Step 2: Rebuild the desktop app** with all fixes:
```bash
cd /Users/keliang/MacMove
ROOST_ARCHES=arm64 pnpm build:desktop 2>&1 | tail -3
```
Expected: produces `Roost.app` + `Roost_0.1.0_aarch64.dmg`.

- [ ] **Step 3: Install + relaunch + regression-check** (real machine):
```bash
osascript -e 'tell application "Roost" to quit' 2>/dev/null; sleep 2; pkill -f 'MacOS/roost' 2>/dev/null; sleep 1
rm -rf /Applications/Roost.app && cp -R packages/web/src-tauri/target/release/bundle/macos/Roost.app /Applications/
xattr -dr com.apple.quarantine /Applications/Roost.app 2>/dev/null
open /Applications/Roost.app; sleep 6
pgrep -f 'MacOS/roost-desktop' >/dev/null && echo "app running" || echo "FAIL not running"
```
Then, using the preview tooling or the live window, verify: (a) Settings → a doc link opens the system browser (external link works); (b) Settings shows the maxCaptureMB field; (c) the Overview blocked panel no longer lists raycast; (d) clicking Push shows a prominent result (and on auth failure, the terminal hint). Report what you observed. (Do NOT execute a real `git push` of the config repo here — just confirm the UI surfaces the result.)

- [ ] **Step 4:** No commit (operational/verification). Report results.

---

## Self-Review Notes
- **Spec coverage:** §2 A→Task 2; §3 B→Tasks 3-4; §4 C→Task 8; §5 D→Task 7; §6 E→Tasks 5-6; §7 ADR→Task 1; §8 tests embedded per task. All covered.
- **Naming consistency:** `BlockReason`/`BlockedItem`/`ChangeSet.blockedDetail` (Task 3) used in Tasks 4. `RoostSettings`/`maxCaptureMB`/`loadRoostSettings`/`saveRoostSettings` (Task 5) used in Tasks 6 + dotfiles. `openExternal` (Task 2). `classifyGitError`/`GitOpResult.hint` (Task 7). `/api/settings` consistent (Tasks 5/6). `maxCaptureMB * 1024 * 1024 → maxBytes` consistent.
- **Additive/no-break:** ChangeSet/`blocked` kept; settings file new; opener plugin additive; push hint additive. Existing suites stay green (verified each task).
- **Tauri risk:** Task 2 opener permission identifier may differ by version — implementer verifies via cargo check + gen/schemas and reports.
- **Sequencing:** shared type (Task 3) before web consumer (Task 4); core settings (Task 5) before server/UI (Task 6). C+rebuild last (Task 8) so the shipped app has all fixes.
```
