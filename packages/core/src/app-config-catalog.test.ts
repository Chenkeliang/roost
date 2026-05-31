import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  DEFAULT_APP_CONFIG_CATALOG,
  loadAppConfigCatalog,
  expandCatalogPath,
} from "./app-config-catalog.js";

let repoDir: string;
let home: string;

beforeEach(() => {
  repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-cat-repo-"));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "roost-cat-home-"));
  fs.mkdirSync(path.join(repoDir, "roost"), { recursive: true });
});
afterEach(() => {
  fs.rmSync(repoDir, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

describe("default catalog", () => {
  it("includes VS Code family and JetBrains; JetBrains is encrypt-recommended; only file paths (no plist)", () => {
    const names = DEFAULT_APP_CONFIG_CATALOG.map((a) => a.name);
    expect(names.some((n) => n.includes("VS Code"))).toBe(true);
    expect(names).toContain("JetBrains");
    const jb = DEFAULT_APP_CONFIG_CATALOG.find((a) => a.name === "JetBrains")!;
    expect(jb.encryptRecommended).toBe(true);
    const allPaths = DEFAULT_APP_CONFIG_CATALOG.flatMap((a) => a.paths);
    expect(allPaths.some((p) => p.endsWith(".plist"))).toBe(false); // plist → appconfig module
  });
});

describe("loadAppConfigCatalog — merge by name, user wins", () => {
  it("returns defaults when no override", () => {
    expect(loadAppConfigCatalog(repoDir).length).toBe(DEFAULT_APP_CONFIG_CATALOG.length);
  });

  it("user override replaces an app's paths by name and can add new apps", () => {
    fs.writeFileSync(
      path.join(repoDir, "roost", "app-config-catalog.yaml"),
      [
        "apps:",
        "  - name: VS Code",
        "    paths: [ 'Library/Application Support/Code/User/settings.json' ]",
        "  - name: MyTool",
        "    paths: [ '.config/mytool' ]",
      ].join("\n"),
    );
    const cat = loadAppConfigCatalog(repoDir);
    const vscode = cat.find((a) => a.name === "VS Code")!;
    expect(vscode.paths).toEqual(["Library/Application Support/Code/User/settings.json"]); // replaced
    expect(cat.find((a) => a.name === "MyTool")).toBeDefined(); // added
  });

  it("malformed override falls back to defaults", () => {
    fs.writeFileSync(path.join(repoDir, "roost", "app-config-catalog.yaml"), "not: [valid");
    expect(loadAppConfigCatalog(repoDir).length).toBe(DEFAULT_APP_CONFIG_CATALOG.length);
  });
});

describe("expandCatalogPath", () => {
  it("expands a glob to existing absolute paths only", () => {
    fs.mkdirSync(path.join(home, "Library/Application Support/JetBrains/DataGrip2026.1/options"), { recursive: true });
    fs.mkdirSync(path.join(home, "Library/Application Support/JetBrains/GoLand2025.2/options"), { recursive: true });
    const got = expandCatalogPath(home, "Library/Application Support/JetBrains/*/options").sort();
    expect(got).toEqual([
      path.join(home, "Library/Application Support/JetBrains/DataGrip2026.1/options"),
      path.join(home, "Library/Application Support/JetBrains/GoLand2025.2/options"),
    ]);
  });

  it("returns [] for a path that does not exist", () => {
    expect(expandCatalogPath(home, "Library/Application Support/Nope/x")).toEqual([]);
  });
});
