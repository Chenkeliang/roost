import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Exec, ExecResult } from "@roost/shared";
import { itemDiff } from "./item-diff.js";

function fakeExec(handler: (cmd: string, args: string[]) => Partial<ExecResult>): Exec {
  return {
    async run(cmd, args) {
      const r = handler(cmd, args);
      return { code: r.code ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
  };
}

describe("itemDiff", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roost-idiff-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("dotfiles: local from disk, repo from chezmoi cat", async () => {
    const file = path.join(tmp, ".zshrc");
    fs.writeFileSync(file, "local content\n", "utf8");
    const exec = fakeExec((cmd, args) => {
      if (cmd === "chezmoi" && args.includes("cat")) return { code: 0, stdout: "repo content\n" };
      return { code: 0 };
    });
    const out = await itemDiff({ repoDir: tmp, home: tmp, exec }, "dotfiles", file);
    expect(out.kind).toBe("text");
    expect(out.local).toBe("local content\n");
    expect(out.repo).toBe("repo content\n");
  });

  it("dotfiles: a directory id falls back to a summary", async () => {
    const dir = path.join(tmp, ".config");
    fs.mkdirSync(dir, { recursive: true });
    const exec = fakeExec(() => ({ code: 0, stdout: "" }));
    const out = await itemDiff({ repoDir: tmp, home: tmp, exec }, "dotfiles", dir);
    expect(out.kind).toBe("summary");
  });

  it("appconfig: local from defaults export, repo from stored plist", async () => {
    const dir = path.join(tmp, "roost", "appconfig");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "com.example.app.plist"), "<plist>REPO</plist>", "utf8");
    const exec = fakeExec((cmd) => {
      if (cmd === "defaults") return { code: 0, stdout: "<plist>LIVE</plist>" };
      return { code: 0 };
    });
    const out = await itemDiff({ repoDir: tmp, home: tmp, exec }, "appconfig", "domain:com.example.app");
    expect(out.kind).toBe("text");
    expect(out.local).toBe("<plist>LIVE</plist>");
    expect(out.repo).toBe("<plist>REPO</plist>");
  });

  it("appconfig: per-key diff lists only changed keys", async () => {
    const dir = path.join(tmp, "roost", "appconfig");
    fs.mkdirSync(dir, { recursive: true });
    const repoPlist =
      "<plist><dict><key>tilesize</key><integer>48</integer><key>autohide</key><false/></dict></plist>";
    fs.writeFileSync(path.join(dir, "com.apple.dock.plist"), repoPlist, "utf8");
    const livePlist =
      "<plist><dict><key>tilesize</key><integer>64</integer><key>autohide</key><false/></dict></plist>";
    const exec = fakeExec((cmd) => (cmd === "defaults" ? { code: 0, stdout: livePlist } : { code: 0 }));
    const out = await itemDiff({ repoDir: tmp, home: tmp, exec }, "appconfig", "domain:com.apple.dock");
    expect(out.keys).toBeDefined();
    expect(out.keys).toEqual([{ key: "tilesize", local: "64", repo: "48" }]);
  });

  it("packages: summary kind", async () => {
    const exec = fakeExec(() => ({ code: 0 }));
    const out = await itemDiff({ repoDir: tmp, home: tmp, exec }, "packages", "Brewfile");
    expect(out.kind).toBe("summary");
  });
});
