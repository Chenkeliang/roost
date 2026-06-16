import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { act } from "react";
import { AliasesEnv } from "./views/AliasesEnv";
import type { EnvData } from "@roost/shared";

const BASE_ENV: EnvData = {
  schemaVersion: 1,
  aliases: [
    { kind: "alias", name: "ll", value: "ls -lah", enabled: true },
    { kind: "alias", name: "ga", value: "git add", enabled: true },
  ],
  env: [
    { kind: "env", name: "EDITOR", value: "nvim", secret: false, enabled: true },
    // matches the "git" search alongside the `ga` alias above.
    { kind: "env", name: "GIT_EDITOR", value: "code --wait", secret: false, enabled: true },
    // Returned from server: secret with blank value → "encrypted" badge.
    { kind: "env", name: "OPENAI_API_KEY", value: "", secret: true, enabled: true },
  ],
  path: [
    { kind: "path", value: "$HOME/bin", position: "prepend", enabled: true },
    { kind: "path", value: "/usr/local/sbin", position: "append", enabled: true },
  ],
  functions: [{ kind: "function", name: "mkcd", body: "mkdir -p $1 && cd $1", enabled: true }],
};

vi.mock("./api", () => ({
  getEnv: vi.fn(),
  putEnv: vi.fn(),
  getDiscover: vi.fn(),
  applyEnv: vi.fn(),
  getHealth: vi.fn().mockRejectedValue(new Error("not mocked")),
  getEnvironment: vi.fn().mockResolvedValue({ checks: [] }),
}));

import { getEnv, putEnv, getDiscover, getHealth } from "./api";

function mockEnv(data: EnvData = BASE_ENV) {
  vi.mocked(getEnv).mockResolvedValue(structuredClone(data));
  // putEnv echoes back with secrets redacted (matches server contract).
  vi.mocked(putEnv).mockImplementation(async (d: EnvData) => ({
    ...d,
    env: d.env.map((e) => (e.secret ? { ...e, value: "" } : e)),
  }));
}

async function renderView() {
  await act(async () => {
    render(<AliasesEnv />);
  });
  // Wait for the first load to settle (skeleton → content).
  await waitFor(() => screen.getByRole("button", { name: /^Save$/i }));
}

describe("AliasesEnv", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv();
  });

  it("renders the unified list with filter chips and their counts", async () => {
    await renderView();
    // chips (aria-label includes the live count)
    expect(screen.getByRole("tab", { name: /^All 8$/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /^Aliases 2$/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /^Env 3$/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /^PATH 2$/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /^Functions 1$/ })).toBeTruthy();
    // every kind shares one list — rows from each kind are visible at once
    expect(screen.getByRole("row", { name: /alias ll/i })).toBeTruthy();
    expect(screen.getByRole("row", { name: /env EDITOR/i })).toBeTruthy();
    expect(screen.getByRole("row", { name: /path \$HOME\/bin/i })).toBeTruthy();
    expect(screen.getByRole("row", { name: /function mkcd/i })).toBeTruthy();
    // "N of M items" count
    expect(screen.getByText(/8 of 8 items/i)).toBeTruthy();
  });

  it("shows the dotfiles de-confusion explainer", async () => {
    await renderView();
    expect(screen.getByText(/your existing dotfiles stay untouched/i)).toBeTruthy();
  });

  it("global search filters across kinds at once", async () => {
    await renderView();
    fireEvent.change(screen.getByLabelText(/^Search aliases/i), {
      target: { value: "git" },
    });
    await waitFor(() => {
      // matches both the `ga` alias (value "git add") and the GIT_EDITOR env var
      expect(screen.getByRole("row", { name: /alias ga/i })).toBeTruthy();
    });
    expect(screen.getByRole("row", { name: /env GIT_EDITOR/i })).toBeTruthy();
    // non-matching rows are gone
    expect(screen.queryByRole("row", { name: /alias ll/i })).toBeNull();
    expect(screen.queryByRole("row", { name: /function mkcd/i })).toBeNull();
  });

  it("a kind chip narrows the list to that kind", async () => {
    await renderView();
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: /^PATH 2$/ }));
    });
    await waitFor(() => {
      expect(screen.getByRole("row", { name: /path \$HOME\/bin/i })).toBeTruthy();
    });
    expect(screen.queryByRole("row", { name: /alias ll/i })).toBeNull();
    expect(screen.queryByRole("row", { name: /env EDITOR/i })).toBeNull();
    expect(screen.getByText(/2 of 8 items · PATH/i)).toBeTruthy();
  });

  it("adding an alias and saving calls putEnv with the new item", async () => {
    await renderView();
    // Add affordance creates a new alias and opens its editor
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Add alias/i }));
    });
    // new empty alias editor is open (name is empty → aria-label "alias name")
    await waitFor(() => screen.getByLabelText(/^alias name\s*$/i));

    fireEvent.change(screen.getByLabelText(/^alias name\s*$/i), { target: { value: "gs" } });
    fireEvent.change(screen.getByLabelText("alias value gs"), {
      target: { value: "git status" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    });

    expect(vi.mocked(putEnv)).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(putEnv).mock.calls[0]![0];
    expect(sent.aliases).toContainEqual({
      kind: "alias",
      name: "gs",
      value: "git status",
      enabled: true,
    });
  });

  it("a secret env item shows the lock badge and never renders its value", async () => {
    await renderView();
    // row-level lock badge
    expect(screen.getByTestId("lock-OPENAI_API_KEY")).toBeTruthy();
    // value preview is blank for a secret — open the editor to inspect the field
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /edit env OPENAI_API_KEY/i }));
    });
    await waitFor(() => screen.getByTestId("encrypted-OPENAI_API_KEY"));
    const valueInput = screen.getByLabelText("env value OPENAI_API_KEY") as HTMLInputElement;
    expect(valueInput.type).toBe("password");
    expect(valueInput.value).toBe("");
  });

  it("toggling secret reveals the source selector and masks the value", async () => {
    await renderView();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /edit env EDITOR/i }));
    });
    await waitFor(() => screen.getByLabelText("env value EDITOR"));

    const before = screen.getByLabelText("env value EDITOR") as HTMLInputElement;
    expect(before.type).toBe("text");
    // no source selector until secret is on
    expect(screen.queryByLabelText("env source EDITOR")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: /mark env EDITOR secret/i }));
    });

    const after = screen.getByLabelText("env value EDITOR") as HTMLInputElement;
    expect(after.type).toBe("password");
    // source selector now appears
    expect(screen.getByLabelText("env source EDITOR")).toBeTruthy();
  });

  it("entering a new secret value sends it via putEnv to be encrypted", async () => {
    await renderView();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /edit env OPENAI_API_KEY/i }));
    });
    await waitFor(() => screen.getByLabelText("env value OPENAI_API_KEY"));

    fireEvent.change(screen.getByLabelText("env value OPENAI_API_KEY"), {
      target: { value: "sk-newsecret" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    });

    const sent = vi.mocked(putEnv).mock.calls[0]![0];
    const secretItem = sent.env.find((e) => e.name === "OPENAI_API_KEY")!;
    expect(secretItem.secret).toBe(true);
    expect(secretItem.value).toBe("sk-newsecret");
  });

  it("choosing a 1Password reference shows the ref input and hides the value field (ADR-0004)", async () => {
    await renderView();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /edit env EDITOR/i }));
    });
    await waitFor(() => screen.getByLabelText("env value EDITOR"));

    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: /mark env EDITOR secret/i }));
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("env source EDITOR"), { target: { value: "ref:op" } });
    });

    expect(screen.getByLabelText("env ref EDITOR")).toBeTruthy();
    expect(screen.queryByLabelText("env value EDITOR")).toBeNull();
  });

  it("PUT carries the ref source for a secret env item (ADR-0004)", async () => {
    await renderView();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /edit env EDITOR/i }));
    });
    await waitFor(() => screen.getByLabelText("env value EDITOR"));

    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: /mark env EDITOR secret/i }));
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("env source EDITOR"), { target: { value: "ref:rbw" } });
    });
    fireEvent.change(screen.getByLabelText("env ref EDITOR"), { target: { value: "my-entry" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    });

    const sent = vi.mocked(putEnv).mock.calls[0]![0];
    const item = sent.env.find((e) => e.name === "EDITOR")!;
    expect(item.secret).toBe(true);
    expect(item.source).toEqual({ kind: "ref", backend: "rbw", ref: "my-entry" });
  });

  it("PATH reorder changes the saved order", async () => {
    await renderView();
    // open the second PATH entry's editor and move it up
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /edit path \/usr\/local\/sbin/i }));
    });
    await waitFor(() => screen.getByRole("button", { name: /move up \/usr\/local\/sbin/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /move up \/usr\/local\/sbin/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    });

    const sent = vi.mocked(putEnv).mock.calls[0]![0];
    expect(sent.path.map((p) => p.value)).toEqual(["/usr/local/sbin", "$HOME/bin"]);
  });

  it("functions editor edits the body", async () => {
    await renderView();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /edit function mkcd/i }));
    });
    await waitFor(() => screen.getByLabelText("function body mkcd"));

    fireEvent.change(screen.getByLabelText("function body mkcd"), {
      target: { value: "echo edited" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    });

    const sent = vi.mocked(putEnv).mock.calls[0]![0];
    expect(sent.functions.find((f) => f.name === "mkcd")!.body).toBe("echo edited");
  });

  it("import picker filters to import: candidates and merges chosen ones", async () => {
    vi.mocked(getDiscover).mockResolvedValue({
      candidates: {
        env: [
          {
            id: "import:alias:gco",
            path: "~/.zshrc",
            category: "env",
            recommendation: "track",
            note: "importable from rc",
          },
          {
            id: "import:env:LANG",
            path: "~/.zshrc",
            category: "env",
            recommendation: "track",
            note: "importable from rc",
          },
          // managed (non-import) candidate must be filtered out of the picker
          {
            id: "alias:ll",
            path: "roost/env.yaml",
            category: "env",
            recommendation: "track",
            note: "managed",
          },
        ],
      },
    });

    await renderView();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Import from your shell/i }));
    });
    await waitFor(() => screen.getByLabelText("import import:alias:gco"));

    // managed candidate is not offered
    expect(screen.queryByLabelText("import alias:ll")).toBeNull();

    fireEvent.click(screen.getByLabelText("import import:alias:gco"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Import 1$/i }));
    });

    // merged alias now appears in the unified list
    await waitFor(() => {
      expect(screen.getByRole("row", { name: /alias gco/i })).toBeTruthy();
    });

    // and it survives a save
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    });
    const sent = vi.mocked(putEnv).mock.calls[0]![0];
    expect(sent.aliases.some((a) => a.name === "gco")).toBe(true);
  });

  it("Save is disabled until there are local edits", async () => {
    await renderView();
    const saveBtn = screen.getByRole("button", { name: /^Save$/i }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);

    // open the ll alias and edit it → dirty
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /edit alias ll/i }));
    });
    await waitFor(() => screen.getByLabelText("alias value ll"));
    fireEvent.change(screen.getByLabelText("alias value ll"), { target: { value: "ls -la" } });

    expect((screen.getByRole("button", { name: /^Save$/i }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});

// ── Task 2: age-key awareness ─────────────────────────────────────────────────

const ageSecretEnv = {
  schemaVersion: 1, aliases: [], path: [], functions: [],
  // value non-empty so it is treated as a new (not yet encrypted) secret → isStoredSecret=false
  env: [{ kind: "env", name: "TOKEN", value: "sk-test", secret: true, source: { kind: "age" }, enabled: true }],
};

async function renderEnv() {
  await act(async () => { render(<AliasesEnv onOpenSettings={() => {}} />); });
  // Wait for the load to settle (skeleton → content) before interacting.
  await waitFor(() => screen.getByRole("button", { name: "edit env TOKEN" }));
  // open the TOKEN row so its editor (and hint) mounts
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "edit env TOKEN" })); });
}

describe("AliasesEnv — no age key guidance", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the dual-option note for an age secret when no key exists", async () => {
    (getEnv as ReturnType<typeof vi.fn>).mockResolvedValue(ageSecretEnv);
    (getHealth as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, name: "r", ageKey: false });
    await renderEnv();
    await waitFor(() => expect(screen.getByText(/No age key on this Mac/)).toBeInTheDocument());
    expect(screen.getByText(/switch the source to a 1Password \/ rbw reference/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "generate or import one in Settings" })).toBeInTheDocument();
  });

  it("hides the note when an age key exists", async () => {
    (getEnv as ReturnType<typeof vi.fn>).mockResolvedValue(ageSecretEnv);
    (getHealth as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, name: "r", ageKey: true });
    await renderEnv();
    await waitFor(() => expect(screen.getByLabelText("env name TOKEN")).toBeInTheDocument());
    expect(screen.queryByText(/No age key on this Mac/)).toBeNull();
  });
});

describe("AliasesEnv — save with no age key", () => {
  beforeEach(() => vi.clearAllMocks());

  it("translates a 'no age key' 400 into the dual-option HUD message", async () => {
    const dirtyEnv = {
      schemaVersion: 1, aliases: [], path: [], functions: [],
      env: [{ kind: "env", name: "TOKEN", value: "", secret: true, source: { kind: "age" }, enabled: true }],
    };
    (getEnv as ReturnType<typeof vi.fn>).mockResolvedValue(dirtyEnv);
    (getHealth as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, name: "r", ageKey: false });
    (putEnv as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('cannot encrypt secret "TOKEN": no age key available'),
    );
    const showHud = vi.fn();
    await act(async () => { render(<AliasesEnv showHud={showHud} onOpenSettings={() => {}} />); });
    // type a value so the page is dirty + the secret carries plaintext
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "edit env TOKEN" })); });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("env value TOKEN"), { target: { value: "sk-123" } });
    });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Save/ })); });
    await waitFor(() =>
      expect(showHud).toHaveBeenCalledWith(
        expect.objectContaining({ type: "error", text: expect.stringContaining("No age key on this Mac") }),
      ),
    );
  });
});
