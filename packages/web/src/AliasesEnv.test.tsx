import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { act } from "react";
import { AliasesEnv } from "./views/AliasesEnv";
import type { EnvData } from "@roost/shared";

const BASE_ENV: EnvData = {
  schemaVersion: 1,
  aliases: [{ kind: "alias", name: "ll", value: "ls -lah", enabled: true }],
  env: [
    { kind: "env", name: "EDITOR", value: "nvim", secret: false, enabled: true },
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
}));

import { getEnv, putEnv, getDiscover } from "./api";

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

  it("renders the four tabs", async () => {
    await renderView();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Aliases/i })).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: /^Env$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /PATH/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Functions/i })).toBeTruthy();
  });

  it("shows the dotfiles de-confusion explainer", async () => {
    await renderView();
    await waitFor(() => {
      expect(screen.getByText(/your existing dotfiles stay untouched/i)).toBeTruthy();
    });
  });

  it("adding an alias and saving calls putEnv with the new item", async () => {
    await renderView();
    await waitFor(() => screen.getByLabelText("new alias name"));

    fireEvent.change(screen.getByLabelText("new alias name"), {
      target: { value: "gs" },
    });
    fireEvent.change(screen.getByLabelText("new alias value"), {
      target: { value: "git status" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Add alias/i }));
    });

    // Save becomes enabled once dirty
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

  it("a secret env item shows the 'encrypted' badge and never renders its value", async () => {
    await renderView();
    // switch to Env tab
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Env$/i }));
    });
    await waitFor(() => {
      expect(screen.getByTestId("encrypted-OPENAI_API_KEY")).toBeTruthy();
    });
    // The value field for the stored secret must be a password input (masked),
    // and must not expose any plaintext value.
    const valueInput = screen.getByLabelText("env value OPENAI_API_KEY") as HTMLInputElement;
    expect(valueInput.type).toBe("password");
    expect(valueInput.value).toBe("");
  });

  it("toggling secret on a plain env var masks the input", async () => {
    await renderView();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Env$/i }));
    });
    await waitFor(() => screen.getByLabelText("env value EDITOR"));

    const before = screen.getByLabelText("env value EDITOR") as HTMLInputElement;
    expect(before.type).toBe("text");

    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: /mark env EDITOR secret/i }));
    });

    const after = screen.getByLabelText("env value EDITOR") as HTMLInputElement;
    expect(after.type).toBe("password");
  });

  it("entering a new secret value sends it via putEnv to be encrypted", async () => {
    await renderView();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Env$/i }));
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
      fireEvent.click(screen.getByRole("button", { name: /^Env$/i }));
    });
    await waitFor(() => screen.getByLabelText("env value EDITOR"));

    // Mark EDITOR secret so the source selector appears.
    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: /mark env EDITOR secret/i }));
    });
    // Switch its source to a 1Password reference.
    const sourceSel = screen.getByLabelText("env source EDITOR") as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(sourceSel, { target: { value: "ref:op" } });
    });

    // The ref input appears; the plaintext value field is gone.
    expect(screen.getByLabelText("env ref EDITOR")).toBeTruthy();
    expect(screen.queryByLabelText("env value EDITOR")).toBeNull();
  });

  it("PUT carries the ref source for a secret env item (ADR-0004)", async () => {
    await renderView();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Env$/i }));
    });
    await waitFor(() => screen.getByLabelText("env value EDITOR"));

    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: /mark env EDITOR secret/i }));
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("env source EDITOR"), { target: { value: "ref:rbw" } });
    });
    fireEvent.change(screen.getByLabelText("env ref EDITOR"), {
      target: { value: "my-entry" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    });

    const sent = vi.mocked(putEnv).mock.calls[0]![0];
    const item = sent.env.find((e) => e.name === "EDITOR")!;
    expect(item.secret).toBe(true);
    expect(item.source).toEqual({ kind: "ref", backend: "rbw", ref: "my-entry" });
  });

  it("PATH add and reorder updates state", async () => {
    await renderView();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /PATH/i }));
    });
    await waitFor(() => screen.getByLabelText("new path value"));

    // add a third entry
    fireEvent.change(screen.getByLabelText("new path value"), {
      target: { value: "/opt/homebrew/bin" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Add entry/i }));
    });
    expect(screen.getByLabelText("path value /opt/homebrew/bin")).toBeTruthy();

    // reorder: move the new (last) entry up, then save and assert order in payload
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /move up \/opt\/homebrew\/bin/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    });

    const sent = vi.mocked(putEnv).mock.calls[0]![0];
    const values = sent.path.map((p) => p.value);
    // moved from index 2 to index 1
    expect(values).toEqual(["$HOME/bin", "/opt/homebrew/bin", "/usr/local/sbin"]);
  });

  it("functions editor edits the body", async () => {
    await renderView();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Functions/i }));
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

  it("import picker merges chosen candidates into state", async () => {
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

    // merged alias should now appear in the Aliases tab
    await waitFor(() => {
      expect(screen.getByLabelText(/alias name gco/i)).toBeTruthy();
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
    await waitFor(() => screen.getByRole("button", { name: /^Save$/i }));
    const saveBtn = screen.getByRole("button", { name: /^Save$/i }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);

    // make an edit → enabled
    fireEvent.change(screen.getByLabelText("alias value ll"), {
      target: { value: "ls -la" },
    });
    expect((screen.getByRole("button", { name: /^Save$/i }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});
