import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ApplyResult, ModuleContext, Selection, SyncModule } from "@roost/shared";
import { ModuleRegistry, saveSelection, loadSelection, emptySelection, addItem } from "@roost/core";
import { runUnmanage } from "./unmanage.js";

function makeCtx(overrides: { home: string; repoDir: string; dryRun?: boolean }): ModuleContext {
  return {
    repoDir: overrides.repoDir,
    home: overrides.home,
    profile: "base",
    dryRun: overrides.dryRun ?? false,
    log: { info: () => {}, warn: () => {}, error: () => {} },
    exec: { async run() { return { code: 0, stdout: "", stderr: "" }; } },
    t: (key: string) => key,
  };
}

function makeFakeModule(name: string, onUnmanage: (sel: Selection) => void): SyncModule {
  return {
    name,
    async discover() { return []; },
    async status() { return { module: name, items: [] }; },
    async capture() { return { module: name, written: [], encrypted: [] }; },
    async apply() { return { module: name, applied: [], backedUp: [], skipped: [] }; },
    async diff() { return ""; },
    async unmanage(_ctx: ModuleContext, sel: Selection): Promise<ApplyResult> {
      onUnmanage(sel);
      return { module: name, applied: sel.modules[name] ?? [], backedUp: [], skipped: [] };
    },
    async doctor() { return [{ name, ok: true }]; },
  };
}

let tmpDir: string;
let repoDir: string;
let home: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-cli-unmanage-"));
  repoDir = path.join(tmpDir, "repo");
  home = path.join(tmpDir, "home");
  fs.mkdirSync(repoDir, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("runUnmanage", () => {
  it("calls the owning module with a single-item selection and removes the item from selection.yaml", async () => {
    let sel = emptySelection();
    sel = addItem(sel, "dotfiles", "a");
    sel = addItem(sel, "dotfiles", "b");
    saveSelection(repoDir, sel);

    const seen: Selection[] = [];
    const reg = new ModuleRegistry();
    reg.register(makeFakeModule("dotfiles", (s) => seen.push(s)));

    const ctx = makeCtx({ home, repoDir });
    const result = await runUnmanage({ repoDir, ctx, registry: reg, module: "dotfiles", id: "a" });

    // module was called with exactly the one item
    expect(seen).toHaveLength(1);
    expect(seen[0]?.modules["dotfiles"]).toEqual(["a"]);

    // selection.yaml now only has "b"
    const after = loadSelection(repoDir);
    expect(after.modules["dotfiles"]).toEqual(["b"]);

    expect(result.unmanaged?.applied).toEqual(["a"]);
  });

  it("dry-run does not write selection.yaml and does not call unmanage with a live ctx", async () => {
    let sel = emptySelection();
    sel = addItem(sel, "dotfiles", "a");
    saveSelection(repoDir, sel);
    const before = fs.readFileSync(path.join(repoDir, "roost", "selection.yaml"), "utf8");

    let called = false;
    const reg = new ModuleRegistry();
    reg.register(makeFakeModule("dotfiles", () => { called = true; }));

    const ctx = makeCtx({ home, repoDir, dryRun: true });
    await runUnmanage({ repoDir, ctx, registry: reg, module: "dotfiles", id: "a", dryRun: true });

    // selection.yaml unchanged
    const after = fs.readFileSync(path.join(repoDir, "roost", "selection.yaml"), "utf8");
    expect(after).toEqual(before);
    // module.unmanage not invoked in dry-run (modules already handle their own dryRun,
    // but we must not mutate the repo file)
    expect(called).toBe(false);
  });

  it("errors cleanly for an unknown module", async () => {
    saveSelection(repoDir, emptySelection());
    const reg = new ModuleRegistry();
    reg.register(makeFakeModule("dotfiles", () => {}));
    const ctx = makeCtx({ home, repoDir });
    await expect(
      runUnmanage({ repoDir, ctx, registry: reg, module: "nope", id: "x" }),
    ).rejects.toThrow(/unknown module/i);
  });

  it("errors cleanly when the id is not currently managed", async () => {
    let sel = emptySelection();
    sel = addItem(sel, "dotfiles", "a");
    saveSelection(repoDir, sel);
    const reg = new ModuleRegistry();
    reg.register(makeFakeModule("dotfiles", () => {}));
    const ctx = makeCtx({ home, repoDir });
    await expect(
      runUnmanage({ repoDir, ctx, registry: reg, module: "dotfiles", id: "missing" }),
    ).rejects.toThrow(/not managed|not selected|not found/i);
  });
});
