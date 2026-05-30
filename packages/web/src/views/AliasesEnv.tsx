import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Plus,
  Trash,
  FloppyDisk,
  DownloadSimple,
  CaretUp,
  CaretDown,
  LockKey,
  MagnifyingGlass,
  PencilSimple,
} from "@phosphor-icons/react";
import type {
  EnvData,
  AliasItem,
  EnvVarItem,
  EnvSecretSource,
  PathEntry,
  FunctionItem,
  Candidate,
} from "@roost/shared";
import type { HudMessage } from "../components/Hud";
import { Skeleton } from "../components/Skeleton";
import { getEnv, putEnv, getDiscover } from "../api";

interface AliasesEnvProps {
  showHud?: (msg: HudMessage) => void;
}

type ItemKind = "alias" | "env" | "path" | "function";
type ChipKind = "all" | ItemKind;

const CHIPS: { id: ChipKind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "alias", label: "Aliases" },
  { id: "env", label: "Env" },
  { id: "path", label: "PATH" },
  { id: "function", label: "Functions" },
];

// A flat reference into one of EnvData's four arrays. The unified list renders
// these; edits are mapped back to the owning array by (kind, idx).
type Ref =
  | { kind: "alias"; idx: number }
  | { kind: "env"; idx: number }
  | { kind: "path"; idx: number }
  | { kind: "function"; idx: number };

// ── shared styling helpers ───────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  appearance: "none",
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: "var(--rt)",
  color: "var(--text)",
  fontFamily: "var(--mono)",
  fontSize: 12,
  padding: "5px 9px",
  outline: "none",
  width: "100%",
};

const cardStyle: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border-soft)",
  borderRadius: "var(--rc)",
  overflow: "hidden",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,.035)",
};

function iconButton(color: string): React.CSSProperties {
  return {
    appearance: "none",
    border: "1px solid var(--border)",
    background: "var(--raise)",
    color,
    fontFamily: "var(--font)",
    fontSize: 11,
    padding: "4px 6px",
    borderRadius: 6,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
  };
}

const BADGE_COLOR: Record<ItemKind, { bg: string; fg: string }> = {
  alias: { bg: "rgba(154,154,162,.14)", fg: "#c8c8cf" },
  env: { bg: "rgba(78,201,201,.13)", fg: "var(--teal)" },
  path: { bg: "rgba(229,166,64,.14)", fg: "var(--amber)" },
  function: { bg: "rgba(180,142,240,.14)", fg: "var(--violet)" },
};

// Pill toggle reused for enabled / secret switches.
function Toggle({
  on,
  onChange,
  label,
  activeColor = "var(--green)",
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label: string;
  activeColor?: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!on);
      }}
      style={{
        appearance: "none",
        border: 0,
        cursor: "pointer",
        width: 30,
        height: 17,
        borderRadius: 999,
        padding: 2,
        background: on ? activeColor : "var(--border)",
        transition: "background .12s",
        display: "inline-flex",
        alignItems: "center",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          width: 13,
          height: 13,
          borderRadius: 999,
          background: "#0b0b0d",
          transform: on ? "translateX(13px)" : "translateX(0)",
          transition: "transform .12s",
        }}
      />
    </button>
  );
}

// ── secret source helpers (ADR-0004) ─────────────────────────────────────────

// "age" ⇒ encrypted-into-repo; "ref:op"/"ref:rbw" ⇒ resolved on apply from a
// password manager.
type SourceSel = "age" | "ref:op" | "ref:rbw";

function selToSource(sel: SourceSel): EnvSecretSource {
  if (sel === "ref:op") return { kind: "ref", backend: "op", ref: "" };
  if (sel === "ref:rbw") return { kind: "ref", backend: "rbw", ref: "" };
  return { kind: "age" };
}

function sourceSel(e: EnvVarItem): SourceSel {
  return e.source?.kind === "ref" ? `ref:${e.source.backend}` : "age";
}

// ── value preview for the list row ────────────────────────────────────────────

function valuePreview(
  kind: ItemKind,
  item: AliasItem | EnvVarItem | PathEntry | FunctionItem,
): string {
  if (kind === "function") {
    const body = (item as FunctionItem).body;
    const first = body.split("\n")[0] ?? "";
    return body.includes("\n") ? `${first} …` : first;
  }
  if (kind === "path") {
    const p = item as PathEntry;
    return `${p.position}  ·  ${p.value}`;
  }
  const ev = item as EnvVarItem;
  if (kind === "env" && ev.secret) return ""; // secret value is never shown
  return (item as AliasItem | EnvVarItem).value;
}

// Lowercased haystack a search query is matched against. Secret env values are
// blank server-side, so they won't match — that is acceptable.
function haystack(kind: ItemKind, item: AliasItem | EnvVarItem | PathEntry | FunctionItem): string {
  const parts: (string | undefined)[] = [kind];
  if (kind === "alias") {
    const a = item as AliasItem;
    parts.push(a.name, a.value);
  } else if (kind === "env") {
    const e = item as EnvVarItem;
    parts.push(e.name, e.secret ? "" : e.value, e.source?.kind === "ref" ? e.source.ref : "");
  } else if (kind === "path") {
    const p = item as PathEntry;
    parts.push(p.value, p.position);
  } else {
    const f = item as FunctionItem;
    parts.push(f.name, f.body);
  }
  return parts.filter(Boolean).join(" ").toLowerCase();
}

// ── inline editor (kind-adaptive) ─────────────────────────────────────────────

function AliasEditor({
  item,
  onChange,
}: {
  item: AliasItem;
  onChange: (next: Partial<AliasItem>) => void;
}) {
  return (
    <div style={editorGridStyle}>
      <Field label="name" width={200}>
        <input
          aria-label={`alias name ${item.name}`}
          value={item.name}
          onChange={(e) => onChange({ name: e.target.value })}
          style={inputStyle}
        />
      </Field>
      <Field label="value" flex>
        <input
          aria-label={`alias value ${item.name}`}
          value={item.value}
          onChange={(e) => onChange({ value: e.target.value })}
          style={inputStyle}
        />
      </Field>
    </div>
  );
}

function EnvEditor({
  item,
  onChange,
}: {
  item: EnvVarItem;
  onChange: (next: Partial<EnvVarItem>) => void;
}) {
  const sel = sourceSel(item);
  const isRef = item.secret && sel !== "age";
  // An age secret returned from the server has secret:true + empty value:
  // render an "encrypted" badge, never an input with the plaintext value.
  const isStoredSecret = item.secret && !isRef && item.value === "";

  return (
    <div>
      <div style={editorGridStyle}>
        <Field label="name" width={200}>
          <input
            aria-label={`env name ${item.name}`}
            value={item.name}
            onChange={(e) => onChange({ name: e.target.value })}
            style={inputStyle}
          />
        </Field>
        <Field label="secret">
          <span style={{ display: "inline-flex", alignItems: "center", height: 24 }}>
            <Toggle
              on={item.secret}
              onChange={(v) => onChange({ secret: v })}
              label={`mark env ${item.name} secret`}
              activeColor="var(--accent)"
            />
          </span>
        </Field>
        {item.secret && (
          <Field label="source">
            <select
              aria-label={`env source ${item.name}`}
              value={sel}
              onChange={(e) =>
                onChange({ source: selToSource(e.target.value as SourceSel), value: "" })
              }
              style={{ ...inputStyle, fontFamily: "var(--font)", cursor: "pointer" }}
            >
              <option value="age">Encrypted (age)</option>
              <option value="ref:op">1Password reference</option>
              <option value="ref:rbw">rbw reference</option>
            </select>
          </Field>
        )}
        {isRef ? (
          <Field label="reference" flex>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span data-testid={`encrypted-${item.name}`} style={lockBadgeStyle}>
                <LockKey size={11} weight="fill" />
                {sel === "ref:op" ? "1Password" : "rbw"}
              </span>
              <input
                aria-label={`env ref ${item.name}`}
                placeholder={sel === "ref:op" ? "op://Vault/Item/field" : "entry name"}
                value={item.source?.kind === "ref" ? item.source.ref : ""}
                onChange={(e) =>
                  onChange({
                    source: {
                      kind: "ref",
                      backend: sel === "ref:op" ? "op" : "rbw",
                      ref: e.target.value,
                    },
                  })
                }
                style={inputStyle}
              />
            </div>
          </Field>
        ) : isStoredSecret ? (
          <Field label="value" flex>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span data-testid={`encrypted-${item.name}`} style={lockBadgeStyle}>
                <LockKey size={11} weight="fill" />
                encrypted
              </span>
              <input
                aria-label={`env value ${item.name}`}
                type="password"
                placeholder="enter new value to re-encrypt"
                value={item.value}
                onChange={(e) => onChange({ value: e.target.value })}
                style={inputStyle}
              />
            </div>
          </Field>
        ) : (
          <Field label="value" flex>
            <input
              aria-label={`env value ${item.name}`}
              type={item.secret ? "password" : "text"}
              value={item.value}
              onChange={(e) => onChange({ value: e.target.value })}
              style={inputStyle}
            />
          </Field>
        )}
      </div>
      {item.secret && (
        <p style={hintStyle}>
          Secret value is never stored in the repo or shown here —{" "}
          {isRef ? "resolved from your password manager on apply." : "encrypted with your age key."}
        </p>
      )}
    </div>
  );
}

function PathEditor({
  item,
  onChange,
  onMove,
  canMoveUp,
  canMoveDown,
}: {
  item: PathEntry;
  onChange: (next: Partial<PathEntry>) => void;
  onMove: (dir: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  return (
    <div>
      <div style={editorGridStyle}>
        <Field label="path" flex>
          <input
            aria-label={`path value ${item.value}`}
            value={item.value}
            onChange={(e) => onChange({ value: e.target.value })}
            style={inputStyle}
          />
        </Field>
        <Field label="position">
          <select
            aria-label={`path position ${item.value}`}
            value={item.position}
            onChange={(e) => onChange({ position: e.target.value as PathEntry["position"] })}
            style={{ ...inputStyle, fontFamily: "var(--font)", cursor: "pointer" }}
          >
            <option value="prepend">prepend</option>
            <option value="append">append</option>
          </select>
        </Field>
        <Field label="order">
          <span style={{ display: "flex", gap: 5 }}>
            <button
              aria-label={`move up ${item.value}`}
              disabled={!canMoveUp}
              onClick={() => onMove(-1)}
              style={{ ...iconButton("var(--muted)"), opacity: canMoveUp ? 1 : 0.4 }}
            >
              <CaretUp size={12} />
            </button>
            <button
              aria-label={`move down ${item.value}`}
              disabled={!canMoveDown}
              onClick={() => onMove(1)}
              style={{ ...iconButton("var(--muted)"), opacity: canMoveDown ? 1 : 0.4 }}
            >
              <CaretDown size={12} />
            </button>
          </span>
        </Field>
      </div>
      <p style={hintStyle}>
        PATH order matters — earlier <span className="mono">prepend</span> entries win. Order is
        preserved across Macs.
      </p>
    </div>
  );
}

function FunctionEditor({
  item,
  onChange,
}: {
  item: FunctionItem;
  onChange: (next: Partial<FunctionItem>) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Field label="name" width={240}>
        <input
          aria-label={`function name ${item.name}`}
          value={item.name}
          onChange={(e) => onChange({ name: e.target.value })}
          style={inputStyle}
        />
      </Field>
      <Field label="body">
        <textarea
          aria-label={`function body ${item.name}`}
          value={item.body}
          onChange={(e) => onChange({ body: e.target.value })}
          spellCheck={false}
          style={{
            ...inputStyle,
            minHeight: 150,
            lineHeight: 1.6,
            resize: "vertical",
            fontSize: 12.5,
          }}
        />
      </Field>
      <p style={hintStyle}>Function bodies are stored verbatim and run as-is.</p>
    </div>
  );
}

const editorGridStyle: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "flex-start",
  flexWrap: "wrap",
};

const hintStyle: React.CSSProperties = {
  color: "var(--faint)",
  fontSize: 11,
  margin: "8px 0 0",
};

const lockBadgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: "3px 9px",
  borderRadius: 999,
  background: "rgba(255,99,99,.12)",
  border: "1px solid var(--accent)",
  color: "var(--accent)",
  fontSize: 11,
  fontWeight: 540,
  flexShrink: 0,
};

function Field({
  label,
  children,
  width,
  flex,
}: {
  label: string;
  children: React.ReactNode;
  width?: number;
  flex?: boolean;
}) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        fontSize: 11,
        color: "var(--muted)",
        letterSpacing: ".03em",
        width: width ?? undefined,
        flex: flex ? 1 : undefined,
      }}
    >
      {label}
      {children}
    </label>
  );
}

// ── Import picker ─────────────────────────────────────────────────────────────

// Build a fresh EnvData item from an importable candidate id (import:<kind>:<name>).
// Values aren't carried in the candidate, so imported items start with empty
// values that the user can fill before saving — a best-effort scan.
function candidateToItem(c: Candidate): AliasItem | EnvVarItem | PathEntry | null {
  const parts = c.id.split(":");
  if (parts[0] !== "import") return null;
  const kind = parts[1];
  const name = parts.slice(2).join(":");
  if (kind === "alias") return { kind: "alias", name, value: "", enabled: true };
  if (kind === "env") return { kind: "env", name, value: "", secret: false, enabled: true };
  if (kind === "path") return { kind: "path", value: name, position: "prepend", enabled: true };
  return null;
}

function ImportPicker({
  candidates,
  onMerge,
  onClose,
}: {
  candidates: Candidate[];
  onMerge: (chosen: Candidate[]) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div style={{ ...cardStyle, marginBottom: 16 }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-soft)" }}>
        <div style={{ fontWeight: 540, fontSize: 13 }}>Import from your shell</div>
        <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 3 }}>
          Best-effort scan of simple top-level <span className="mono">alias</span> /{" "}
          <span className="mono">export</span> lines in your rc files. Values aren&apos;t copied —
          fill them in after importing.
        </div>
      </div>
      {candidates.length === 0 ? (
        <div style={{ padding: "14px", color: "var(--muted)", fontSize: 12 }}>
          Nothing importable found in your shell rc files.
        </div>
      ) : (
        candidates.map((c) => (
          <label
            key={c.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 14px",
              borderBottom: "1px solid var(--border-soft)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              aria-label={`import ${c.id}`}
              checked={picked.has(c.id)}
              onChange={() => toggle(c.id)}
            />
            <span className="mono" style={{ flex: 1, color: "var(--text)" }}>
              {c.id.replace(/^import:/, "")}
            </span>
            <span style={{ color: "var(--muted)", fontSize: 11 }}>{c.note}</span>
          </label>
        ))
      )}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          padding: "10px 14px",
          background: "var(--surface-2)",
        }}
      >
        <button onClick={onClose} style={iconButton("var(--muted)")}>
          Cancel
        </button>
        <button
          onClick={() => onMerge(candidates.filter((c) => picked.has(c.id)))}
          disabled={picked.size === 0}
          style={{ ...iconButton("var(--accent)"), opacity: picked.size === 0 ? 0.5 : 1 }}
        >
          <DownloadSimple size={12} />
          Import {picked.size > 0 ? picked.size : ""}
        </button>
      </div>
    </div>
  );
}

// ── AliasesEnv (root) ─────────────────────────────────────────────────────────

export function AliasesEnv({ showHud }: AliasesEnvProps) {
  const [data, setData] = useState<EnvData | null>(null);
  const [serverData, setServerData] = useState<EnvData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [importCandidates, setImportCandidates] = useState<Candidate[] | null>(null);

  const [query, setQuery] = useState("");
  const [chip, setChip] = useState<ChipKind>("all");
  const [open, setOpen] = useState<Ref | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const env = await getEnv();
      setData(env);
      setServerData(env);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const dirty = useMemo(
    () => JSON.stringify(data) !== JSON.stringify(serverData),
    [data, serverData],
  );

  const save = useCallback(async () => {
    if (!data) return;
    setSaving(true);
    try {
      const saved = await putEnv(data);
      setData(saved);
      setServerData(saved);
      showHud?.({ text: "Saved aliases & env", type: "success" });
    } catch (e) {
      showHud?.({ text: e instanceof Error ? e.message : "Save failed", type: "error" });
    } finally {
      setSaving(false);
    }
  }, [data, showHud]);

  const openImport = useCallback(async () => {
    try {
      const disc = await getDiscover();
      const envCands = disc.candidates.env ?? [];
      setImportCandidates(envCands.filter((c) => c.id.startsWith("import:")));
    } catch (e) {
      showHud?.({ text: e instanceof Error ? e.message : "Could not scan shell", type: "error" });
    }
  }, [showHud]);

  const mergeImports = useCallback(
    (chosen: Candidate[]) => {
      setData((prev) => {
        if (!prev) return prev;
        const next: EnvData = {
          ...prev,
          aliases: [...prev.aliases],
          env: [...prev.env],
          path: [...prev.path],
        };
        for (const c of chosen) {
          const item = candidateToItem(c);
          if (!item) continue;
          if (item.kind === "alias" && !next.aliases.some((a) => a.name === item.name)) {
            next.aliases.push(item);
          } else if (item.kind === "env" && !next.env.some((e) => e.name === item.name)) {
            next.env.push(item);
          } else if (item.kind === "path" && !next.path.some((p) => p.value === item.value)) {
            next.path.push(item);
          }
        }
        return next;
      });
      setImportCandidates(null);
      showHud?.({ text: `Imported ${chosen.length} item(s) — review & save`, type: "success" });
    },
    [showHud],
  );

  // ── mutators keyed by (kind, idx) into the owning array ──────────────────────

  const patchAlias = useCallback((idx: number, next: Partial<AliasItem>) => {
    setData((p) =>
      p ? { ...p, aliases: p.aliases.map((a, i) => (i === idx ? { ...a, ...next } : a)) } : p,
    );
  }, []);
  const patchEnv = useCallback((idx: number, next: Partial<EnvVarItem>) => {
    setData((p) =>
      p ? { ...p, env: p.env.map((e, i) => (i === idx ? { ...e, ...next } : e)) } : p,
    );
  }, []);
  const patchPath = useCallback((idx: number, next: Partial<PathEntry>) => {
    setData((p) =>
      p ? { ...p, path: p.path.map((x, i) => (i === idx ? { ...x, ...next } : x)) } : p,
    );
  }, []);
  const patchFn = useCallback((idx: number, next: Partial<FunctionItem>) => {
    setData((p) =>
      p ? { ...p, functions: p.functions.map((f, i) => (i === idx ? { ...f, ...next } : f)) } : p,
    );
  }, []);

  const movePath = useCallback((idx: number, dir: -1 | 1) => {
    setData((p) => {
      if (!p) return p;
      const target = idx + dir;
      if (target < 0 || target >= p.path.length) return p;
      const path = [...p.path];
      const [item] = path.splice(idx, 1);
      path.splice(target, 0, item!);
      return { ...p, path };
    });
    // keep the open editor pointed at the moved item
    setOpen((o) =>
      o && o.kind === "path" && o.idx === idx ? { kind: "path", idx: idx + dir } : o,
    );
  }, []);

  const removeRef = useCallback((ref: Ref) => {
    setData((p) => {
      if (!p) return p;
      if (ref.kind === "alias") return { ...p, aliases: p.aliases.filter((_, i) => i !== ref.idx) };
      if (ref.kind === "env") return { ...p, env: p.env.filter((_, i) => i !== ref.idx) };
      if (ref.kind === "path") return { ...p, path: p.path.filter((_, i) => i !== ref.idx) };
      return { ...p, functions: p.functions.filter((_, i) => i !== ref.idx) };
    });
    setOpen(null);
  }, []);

  const addItem = useCallback((kind: ItemKind) => {
    setData((p) => {
      if (!p) return p;
      if (kind === "alias") {
        const idx = p.aliases.length;
        setOpen({ kind: "alias", idx });
        return { ...p, aliases: [...p.aliases, { kind: "alias", name: "", value: "", enabled: true }] };
      }
      if (kind === "env") {
        const idx = p.env.length;
        setOpen({ kind: "env", idx });
        return {
          ...p,
          env: [...p.env, { kind: "env", name: "", value: "", secret: false, enabled: true }],
        };
      }
      if (kind === "path") {
        const idx = p.path.length;
        setOpen({ kind: "path", idx });
        return {
          ...p,
          path: [...p.path, { kind: "path", value: "", position: "prepend", enabled: true }],
        };
      }
      const idx = p.functions.length;
      setOpen({ kind: "function", idx });
      return {
        ...p,
        functions: [...p.functions, { kind: "function", name: "", body: "", enabled: true }],
      };
    });
  }, []);

  if (loading) {
    return (
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px" }}>
        <div style={cardStyle}>
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-soft)" }}
            >
              <Skeleton width={220} height={16} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px" }}>
        <div
          role="alert"
          style={{
            padding: "10px 14px",
            background: "rgba(242,85,90,.1)",
            border: "1px solid var(--red)",
            borderRadius: "var(--rr)",
            color: "var(--red)",
            fontSize: 13,
          }}
        >
          {error ?? "Could not load env data."} —{" "}
          <button
            onClick={() => void fetchData()}
            style={{
              background: "none",
              border: "none",
              color: "var(--accent)",
              cursor: "pointer",
              fontFamily: "var(--font)",
              fontSize: 13,
              padding: 0,
            }}
          >
            retry
          </button>
        </div>
      </div>
    );
  }

  // Build the unified, ordered list of refs + the per-kind counts.
  const allRefs: Ref[] = [
    ...data.aliases.map((_, idx) => ({ kind: "alias" as const, idx })),
    ...data.env.map((_, idx) => ({ kind: "env" as const, idx })),
    ...data.path.map((_, idx) => ({ kind: "path" as const, idx })),
    ...data.functions.map((_, idx) => ({ kind: "function" as const, idx })),
  ];

  const itemFor = (
    ref: Ref,
  ): AliasItem | EnvVarItem | PathEntry | FunctionItem => {
    if (ref.kind === "alias") return data.aliases[ref.idx]!;
    if (ref.kind === "env") return data.env[ref.idx]!;
    if (ref.kind === "path") return data.path[ref.idx]!;
    return data.functions[ref.idx]!;
  };

  const counts: Record<ChipKind, number> = {
    all: allRefs.length,
    alias: data.aliases.length,
    env: data.env.length,
    path: data.path.length,
    function: data.functions.length,
  };

  const q = query.trim().toLowerCase();
  const shown = allRefs.filter((ref) => {
    if (chip !== "all" && ref.kind !== chip) return false;
    if (q === "") return true;
    return haystack(ref.kind, itemFor(ref)).includes(q);
  });

  const sameRef = (a: Ref | null, b: Ref) => a !== null && a.kind === b.kind && a.idx === b.idx;

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px" }}>
      {/* explainer */}
      <p
        style={{
          color: "var(--muted)",
          fontSize: 12.5,
          lineHeight: 1.55,
          margin: "0 0 14px",
          maxWidth: 720,
        }}
      >
        Portable aliases &amp; environment Roost manages for you and carries across Macs — your
        existing dotfiles stay untouched.
      </p>

      {/* search input (filters across all kinds) */}
      <div style={{ position: "relative", marginBottom: 13 }}>
        <MagnifyingGlass
          size={16}
          style={{
            position: "absolute",
            left: 13,
            top: "50%",
            transform: "translateY(-50%)",
            color: "var(--faint)",
          }}
        />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(null);
          }}
          placeholder="Search aliases, env, PATH, functions…"
          aria-label="Search aliases, env, PATH, functions"
          autoComplete="off"
          style={{
            width: "100%",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--rc)",
            color: "var(--text)",
            fontFamily: "var(--font)",
            fontSize: 14,
            padding: "12px 14px 12px 38px",
            outline: "none",
          }}
        />
      </div>

      {/* toolbar: filter chips + actions */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <div role="tablist" aria-label="Filter by kind" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {CHIPS.map((c) => {
            const active = chip === c.id;
            return (
              <button
                key={c.id}
                role="tab"
                aria-selected={active}
                aria-label={`${c.label} ${counts[c.id]}`}
                onClick={() => {
                  setChip(c.id);
                  setOpen(null);
                }}
                style={{
                  appearance: "none",
                  border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                  background: active ? "rgba(255,99,99,.13)" : "transparent",
                  color: active ? "var(--accent)" : "var(--muted)",
                  fontFamily: "var(--font)",
                  fontSize: 12.5,
                  padding: "5px 11px",
                  borderRadius: 999,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  transition: "all .12s",
                }}
              >
                {c.label}
                <span style={{ fontSize: 11, opacity: 0.7 }}>{counts[c.id]}</span>
              </button>
            );
          })}
        </div>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => addItem(chip === "all" ? "alias" : chip)}
            style={{ ...iconButton("var(--text)"), padding: "6px 11px" }}
          >
            <Plus size={13} />
            Add {chip === "all" ? "alias" : CHIPS.find((c) => c.id === chip)!.label.toLowerCase()}
          </button>
          <button
            onClick={() => void openImport()}
            style={{
              ...iconButton("var(--text)"),
              border: "1px dashed var(--border)",
              background: "transparent",
              padding: "6px 11px",
            }}
          >
            <DownloadSimple size={13} />
            Import from your shell
          </button>
          {dirty && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "3px 9px",
                borderRadius: 999,
                border: "1px solid var(--amber)",
                color: "var(--amber)",
                fontSize: 11,
                fontWeight: 540,
              }}
            >
              Unsaved
            </span>
          )}
          <button
            onClick={() => void save()}
            disabled={!dirty || saving}
            style={{
              appearance: "none",
              border: 0,
              background: dirty ? "var(--accent)" : "var(--raise)",
              color: dirty ? "#0b0b0d" : "var(--muted)",
              fontFamily: "var(--font)",
              fontSize: 13,
              fontWeight: 560,
              padding: "6px 13px",
              borderRadius: "var(--rr)",
              cursor: dirty && !saving ? "pointer" : "default",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              opacity: saving ? 0.7 : 1,
            }}
          >
            <FloppyDisk size={13} weight="fill" />
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {importCandidates !== null && (
        <ImportPicker
          candidates={importCandidates}
          onMerge={mergeImports}
          onClose={() => setImportCandidates(null)}
        />
      )}

      {/* result count */}
      <div style={{ color: "var(--faint)", fontSize: 11.5, margin: "0 2px 8px" }}>
        {shown.length} of {counts.all} item{counts.all === 1 ? "" : "s"}
        {query ? ` matching “${query}”` : ""}
        {chip !== "all" ? ` · ${CHIPS.find((c) => c.id === chip)!.label}` : ""}
      </div>

      {/* unified list */}
      <div style={cardStyle}>
        {shown.length === 0 ? (
          <div
            style={{ padding: "34px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}
          >
            {counts.all === 0
              ? "Nothing managed yet. Add an item or import from your shell."
              : "No matches. Try a different search or chip."}
          </div>
        ) : (
          shown.map((ref) => {
            const item = itemFor(ref);
            const isOpen = sameRef(open, ref);
            const ev = ref.kind === "env" ? (item as EnvVarItem) : null;
            const name =
              ref.kind === "path" ? (item as PathEntry).value : (item as { name: string }).name;
            const badge = BADGE_COLOR[ref.kind];
            return (
              <div key={`${ref.kind}-${ref.idx}`}>
                <div
                  role="row"
                  onClick={() => setOpen(isOpen ? null : ref)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 11,
                    padding: "9px 14px",
                    borderBottom: "1px solid var(--border-soft)",
                    background: isOpen ? "var(--surface-2)" : "transparent",
                    cursor: "pointer",
                  }}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: ".04em",
                      textTransform: "uppercase",
                      padding: "2px 7px",
                      borderRadius: 5,
                      width: 64,
                      textAlign: "center",
                      background: badge.bg,
                      color: badge.fg,
                    }}
                  >
                    {ref.kind === "function" ? "fn" : ref.kind}
                  </span>
                  <span
                    className="mono"
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      flexShrink: 0,
                      minWidth: 150,
                      color: "var(--text)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {name || <span style={{ color: "var(--faint)" }}>(unnamed)</span>}
                  </span>
                  <span
                    className="mono"
                    style={{
                      fontSize: 12.5,
                      color: "var(--muted)",
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {valuePreview(ref.kind, item)}
                  </span>
                  {ev?.secret && (
                    <span data-testid={`lock-${ev.name}`} style={lockBadgeStyle}>
                      <LockKey size={11} weight="fill" />
                      {ev.source?.kind === "ref"
                        ? ev.source.backend === "op"
                          ? "1Password"
                          : "rbw"
                        : "encrypted"}
                    </span>
                  )}
                  <span style={{ display: "flex", alignItems: "center", gap: 9, flexShrink: 0 }}>
                    <Toggle
                      on={(item as { enabled: boolean }).enabled}
                      onChange={(v) => {
                        if (ref.kind === "alias") patchAlias(ref.idx, { enabled: v });
                        else if (ref.kind === "env") patchEnv(ref.idx, { enabled: v });
                        else if (ref.kind === "path") patchPath(ref.idx, { enabled: v });
                        else patchFn(ref.idx, { enabled: v });
                      }}
                      label={`toggle ${ref.kind} ${name}`}
                      activeColor={ev?.secret ? "var(--accent)" : "var(--green)"}
                    />
                    <button
                      aria-label={`edit ${ref.kind} ${name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpen(isOpen ? null : ref);
                      }}
                      style={iconButton("var(--muted)")}
                    >
                      <PencilSimple size={12} />
                    </button>
                    <button
                      aria-label={`delete ${ref.kind} ${name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeRef(ref);
                      }}
                      style={iconButton("var(--red)")}
                    >
                      <Trash size={12} />
                    </button>
                  </span>
                </div>
                {isOpen && (
                  <div
                    style={{
                      padding: "13px 16px 16px",
                      background: "var(--bg)",
                      borderBottom: "1px solid var(--border-soft)",
                    }}
                  >
                    {ref.kind === "alias" && (
                      <AliasEditor
                        item={item as AliasItem}
                        onChange={(next) => patchAlias(ref.idx, next)}
                      />
                    )}
                    {ref.kind === "env" && (
                      <EnvEditor
                        item={item as EnvVarItem}
                        onChange={(next) => patchEnv(ref.idx, next)}
                      />
                    )}
                    {ref.kind === "path" && (
                      <PathEditor
                        item={item as PathEntry}
                        onChange={(next) => patchPath(ref.idx, next)}
                        onMove={(dir) => movePath(ref.idx, dir)}
                        canMoveUp={ref.idx > 0}
                        canMoveDown={ref.idx < data.path.length - 1}
                      />
                    )}
                    {ref.kind === "function" && (
                      <FunctionEditor
                        item={item as FunctionItem}
                        onChange={(next) => patchFn(ref.idx, next)}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
