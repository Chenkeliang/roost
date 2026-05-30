import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Terminal,
  BracketsCurly,
  ListNumbers,
  Function as FunctionIcon,
  Plus,
  Trash,
  FloppyDisk,
  DownloadSimple,
  Eye,
  EyeSlash,
  CaretUp,
  CaretDown,
  LockKey,
} from "@phosphor-icons/react";
import type {
  EnvData,
  AliasItem,
  EnvVarItem,
  PathEntry,
  FunctionItem,
  Candidate,
} from "@roost/shared";
import type { HudMessage } from "../components/Hud";
import { Skeleton } from "../components/Skeleton";
import { EmptyState } from "../components/EmptyState";
import { getEnv, putEnv, getDiscover } from "../api";

interface AliasesEnvProps {
  showHud?: (msg: HudMessage) => void;
}

type EnvTab = "aliases" | "env" | "path" | "functions";

const TABS: { id: EnvTab; label: string; icon: React.ReactNode }[] = [
  { id: "aliases", label: "Aliases", icon: <Terminal size={14} /> },
  { id: "env", label: "Env", icon: <BracketsCurly size={14} /> },
  { id: "path", label: "PATH", icon: <ListNumbers size={14} /> },
  { id: "functions", label: "Functions", icon: <FunctionIcon size={14} /> },
];

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
      onClick={() => onChange(!on)}
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

function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      style={{
        ...inputStyle,
        fontFamily: "var(--font)",
        width: 220,
        flexShrink: 0,
      }}
    />
  );
}

// ── Aliases tab ──────────────────────────────────────────────────────────────

function AliasesTab({
  aliases,
  onChange,
}: {
  aliases: AliasItem[];
  onChange: (next: AliasItem[]) => void;
}) {
  const [filter, setFilter] = useState("");
  const [draftName, setDraftName] = useState("");
  const [draftValue, setDraftValue] = useState("");

  const shown = aliases.filter(
    (a) =>
      filter.trim() === "" ||
      a.name.toLowerCase().includes(filter.toLowerCase()) ||
      a.value.toLowerCase().includes(filter.toLowerCase()),
  );

  const add = () => {
    const name = draftName.trim();
    if (name === "") return;
    onChange([...aliases, { kind: "alias", name, value: draftValue, enabled: true }]);
    setDraftName("");
    setDraftValue("");
  };

  const patch = (idx: number, next: Partial<AliasItem>) => {
    onChange(aliases.map((a, i) => (i === idx ? { ...a, ...next } : a)));
  };
  const remove = (idx: number) => onChange(aliases.filter((_, i) => i !== idx));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <SearchBox value={filter} onChange={setFilter} placeholder="Filter aliases" />
      </div>
      <div style={cardStyle}>
        {/* header */}
        <div
          style={{
            display: "flex",
            gap: 10,
            padding: "7px 14px",
            borderBottom: "1px solid var(--border-soft)",
            fontSize: 11,
            letterSpacing: ".06em",
            textTransform: "uppercase",
            color: "var(--muted)",
            fontWeight: 600,
          }}
        >
          <span style={{ width: 160 }}>Name</span>
          <span style={{ flex: 1 }}>Value</span>
          <span style={{ width: 86, textAlign: "right" }}>Actions</span>
        </div>

        {aliases.length === 0 ? (
          <div style={{ padding: "14px", color: "var(--muted)", fontSize: 12 }}>
            No aliases yet. Add one below.
          </div>
        ) : (
          shown.map((a) => {
            const idx = aliases.indexOf(a);
            return (
              <div
                key={`${a.name}-${idx}`}
                role="row"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "7px 14px",
                  borderBottom: "1px solid var(--border-soft)",
                }}
              >
                <input
                  aria-label={`alias name ${a.name}`}
                  value={a.name}
                  onChange={(e) => patch(idx, { name: e.target.value })}
                  style={{ ...inputStyle, width: 160 }}
                />
                <input
                  aria-label={`alias value ${a.name}`}
                  value={a.value}
                  onChange={(e) => patch(idx, { value: e.target.value })}
                  style={{ ...inputStyle, flex: 1 }}
                />
                <Toggle
                  on={a.enabled}
                  onChange={(v) => patch(idx, { enabled: v })}
                  label={`toggle alias ${a.name}`}
                />
                <button
                  aria-label={`delete alias ${a.name}`}
                  onClick={() => remove(idx)}
                  style={iconButton("var(--red)")}
                >
                  <Trash size={12} />
                </button>
              </div>
            );
          })
        )}

        {/* add row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "9px 14px",
            background: "var(--surface-2)",
          }}
        >
          <input
            aria-label="new alias name"
            placeholder="ll"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            style={{ ...inputStyle, width: 160 }}
          />
          <input
            aria-label="new alias value"
            placeholder="ls -lah"
            value={draftValue}
            onChange={(e) => setDraftValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
            style={{ ...inputStyle, flex: 1 }}
          />
          <button onClick={add} style={iconButton("var(--accent)")}>
            <Plus size={12} />
            Add alias
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Env tab ──────────────────────────────────────────────────────────────────

function EnvTabPanel({
  env,
  onChange,
}: {
  env: EnvVarItem[];
  onChange: (next: EnvVarItem[]) => void;
}) {
  const [filter, setFilter] = useState("");
  const [reveal, setReveal] = useState<Record<number, boolean>>({});
  const [draftName, setDraftName] = useState("");
  const [draftValue, setDraftValue] = useState("");

  const shown = env.filter(
    (e) => filter.trim() === "" || e.name.toLowerCase().includes(filter.toLowerCase()),
  );

  const add = () => {
    const name = draftName.trim();
    if (name === "") return;
    onChange([...env, { kind: "env", name, value: draftValue, secret: false, enabled: true }]);
    setDraftName("");
    setDraftValue("");
  };
  const patch = (idx: number, next: Partial<EnvVarItem>) =>
    onChange(env.map((e, i) => (i === idx ? { ...e, ...next } : e)));
  const remove = (idx: number) => onChange(env.filter((_, i) => i !== idx));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <SearchBox value={filter} onChange={setFilter} placeholder="Filter env vars" />
      </div>
      <div style={cardStyle}>
        <div
          style={{
            display: "flex",
            gap: 10,
            padding: "7px 14px",
            borderBottom: "1px solid var(--border-soft)",
            fontSize: 11,
            letterSpacing: ".06em",
            textTransform: "uppercase",
            color: "var(--muted)",
            fontWeight: 600,
          }}
        >
          <span style={{ width: 160 }}>Name</span>
          <span style={{ flex: 1 }}>Value</span>
          <span style={{ width: 52, textAlign: "center" }}>Secret</span>
          <span style={{ width: 86, textAlign: "right" }}>Actions</span>
        </div>

        {env.length === 0 ? (
          <div style={{ padding: "14px", color: "var(--muted)", fontSize: 12 }}>
            No environment variables yet. Add one below.
          </div>
        ) : (
          shown.map((e) => {
            const idx = env.indexOf(e);
            // A secret returned from the server has secret:true + empty value:
            // render an "encrypted" badge, never an input with the value.
            const isStoredSecret = e.secret && e.value === "";
            const masked = e.secret && !reveal[idx];
            return (
              <div
                key={`${e.name}-${idx}`}
                role="row"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "7px 14px",
                  borderBottom: "1px solid var(--border-soft)",
                }}
              >
                <input
                  aria-label={`env name ${e.name}`}
                  value={e.name}
                  onChange={(ev) => patch(idx, { name: ev.target.value })}
                  style={{ ...inputStyle, width: 160 }}
                />
                {isStoredSecret ? (
                  <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      data-testid={`encrypted-${e.name}`}
                      style={{
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
                      }}
                    >
                      <LockKey size={11} weight="fill" />
                      encrypted
                    </span>
                    <input
                      aria-label={`env value ${e.name}`}
                      type="password"
                      placeholder="enter new value to re-encrypt"
                      value={e.value}
                      onChange={(ev) => patch(idx, { value: ev.target.value })}
                      style={{ ...inputStyle, flex: 1 }}
                    />
                  </div>
                ) : (
                  <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
                    <input
                      aria-label={`env value ${e.name}`}
                      type={masked ? "password" : "text"}
                      value={e.value}
                      onChange={(ev) => patch(idx, { value: ev.target.value })}
                      style={{ ...inputStyle, flex: 1 }}
                    />
                    {e.secret && (
                      <button
                        aria-label={`${masked ? "reveal" : "hide"} env ${e.name}`}
                        onClick={() => setReveal((r) => ({ ...r, [idx]: !r[idx] }))}
                        style={iconButton("var(--muted)")}
                      >
                        {masked ? <Eye size={12} /> : <EyeSlash size={12} />}
                      </button>
                    )}
                  </div>
                )}
                <span style={{ width: 52, display: "flex", justifyContent: "center" }}>
                  <Toggle
                    on={e.secret}
                    onChange={(v) => patch(idx, { secret: v })}
                    label={`mark env ${e.name} secret`}
                    activeColor="var(--accent)"
                  />
                </span>
                <Toggle
                  on={e.enabled}
                  onChange={(v) => patch(idx, { enabled: v })}
                  label={`toggle env ${e.name}`}
                />
                <button
                  aria-label={`delete env ${e.name}`}
                  onClick={() => remove(idx)}
                  style={iconButton("var(--red)")}
                >
                  <Trash size={12} />
                </button>
              </div>
            );
          })
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "9px 14px",
            background: "var(--surface-2)",
          }}
        >
          <input
            aria-label="new env name"
            placeholder="EDITOR"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            style={{ ...inputStyle, width: 160 }}
          />
          <input
            aria-label="new env value"
            placeholder="nvim"
            value={draftValue}
            onChange={(e) => setDraftValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
            style={{ ...inputStyle, flex: 1 }}
          />
          <button onClick={add} style={iconButton("var(--accent)")}>
            <Plus size={12} />
            Add var
          </button>
        </div>
      </div>
    </div>
  );
}

// ── PATH tab ─────────────────────────────────────────────────────────────────

function PathTab({ path, onChange }: { path: PathEntry[]; onChange: (next: PathEntry[]) => void }) {
  const [draftValue, setDraftValue] = useState("");

  const add = () => {
    const value = draftValue.trim();
    if (value === "") return;
    onChange([...path, { kind: "path", value, position: "prepend", enabled: true }]);
    setDraftValue("");
  };
  const patch = (idx: number, next: Partial<PathEntry>) =>
    onChange(path.map((p, i) => (i === idx ? { ...p, ...next } : p)));
  const remove = (idx: number) => onChange(path.filter((_, i) => i !== idx));
  const move = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= path.length) return;
    const next = [...path];
    const [item] = next.splice(idx, 1);
    next.splice(target, 0, item!);
    onChange(next);
  };

  return (
    <div>
      <p style={{ color: "var(--muted)", fontSize: 12, margin: "0 0 10px" }}>
        Earlier <span className="mono">prepend</span> entries win. Order is preserved across Macs.
      </p>
      <div style={cardStyle}>
        {path.length === 0 ? (
          <div style={{ padding: "14px", color: "var(--muted)", fontSize: 12 }}>
            No PATH entries yet. Add one below.
          </div>
        ) : (
          path.map((p, idx) => (
            <div
              key={`${p.value}-${idx}`}
              role="row"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "7px 14px",
                borderBottom: "1px solid var(--border-soft)",
              }}
            >
              <span
                className="mono"
                style={{ width: 22, color: "var(--faint)", fontSize: 12, textAlign: "right" }}
              >
                {idx + 1}
              </span>
              <input
                aria-label={`path value ${p.value}`}
                value={p.value}
                onChange={(e) => patch(idx, { value: e.target.value })}
                style={{ ...inputStyle, flex: 1 }}
              />
              <select
                aria-label={`path position ${p.value}`}
                value={p.position}
                onChange={(e) => patch(idx, { position: e.target.value as PathEntry["position"] })}
                style={{
                  ...inputStyle,
                  fontFamily: "var(--font)",
                  width: 110,
                  cursor: "pointer",
                }}
              >
                <option value="prepend">prepend</option>
                <option value="append">append</option>
              </select>
              <Toggle
                on={p.enabled}
                onChange={(v) => patch(idx, { enabled: v })}
                label={`toggle path ${p.value}`}
              />
              <button
                aria-label={`move up ${p.value}`}
                disabled={idx === 0}
                onClick={() => move(idx, -1)}
                style={{ ...iconButton("var(--muted)"), opacity: idx === 0 ? 0.4 : 1 }}
              >
                <CaretUp size={12} />
              </button>
              <button
                aria-label={`move down ${p.value}`}
                disabled={idx === path.length - 1}
                onClick={() => move(idx, 1)}
                style={{
                  ...iconButton("var(--muted)"),
                  opacity: idx === path.length - 1 ? 0.4 : 1,
                }}
              >
                <CaretDown size={12} />
              </button>
              <button
                aria-label={`delete path ${p.value}`}
                onClick={() => remove(idx)}
                style={iconButton("var(--red)")}
              >
                <Trash size={12} />
              </button>
            </div>
          ))
        )}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "9px 14px",
            background: "var(--surface-2)",
          }}
        >
          <input
            aria-label="new path value"
            placeholder="$HOME/bin"
            value={draftValue}
            onChange={(e) => setDraftValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
            style={{ ...inputStyle, flex: 1 }}
          />
          <button onClick={add} style={iconButton("var(--accent)")}>
            <Plus size={12} />
            Add entry
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Functions tab ────────────────────────────────────────────────────────────

function FunctionsTab({
  functions,
  onChange,
}: {
  functions: FunctionItem[];
  onChange: (next: FunctionItem[]) => void;
}) {
  const [selected, setSelected] = useState(0);
  const [draftName, setDraftName] = useState("");

  const add = () => {
    const name = draftName.trim();
    if (name === "") return;
    const next = [...functions, { kind: "function" as const, name, body: "", enabled: true }];
    onChange(next);
    setSelected(next.length - 1);
    setDraftName("");
  };
  const patch = (idx: number, next: Partial<FunctionItem>) =>
    onChange(functions.map((f, i) => (i === idx ? { ...f, ...next } : f)));
  const remove = (idx: number) => {
    onChange(functions.filter((_, i) => i !== idx));
    setSelected((s) => Math.max(0, s >= idx ? s - 1 : s));
  };

  const current = functions[selected];

  return (
    <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
      {/* list */}
      <div style={{ width: 240, flexShrink: 0 }}>
        <div style={cardStyle}>
          {functions.length === 0 ? (
            <div style={{ padding: "14px", color: "var(--muted)", fontSize: 12 }}>
              No functions yet.
            </div>
          ) : (
            functions.map((f, idx) => (
              <div
                key={`${f.name}-${idx}`}
                role="row"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 12px",
                  borderBottom: "1px solid var(--border-soft)",
                  background: idx === selected ? "var(--raise)" : "transparent",
                  cursor: "pointer",
                }}
                onClick={() => setSelected(idx)}
              >
                <FunctionIcon size={13} style={{ color: "var(--muted)", flexShrink: 0 }} />
                <span
                  className="mono"
                  style={{
                    flex: 1,
                    fontSize: 12,
                    color: idx === selected ? "var(--text)" : "var(--muted)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {f.name}
                </span>
                <button
                  aria-label={`delete function ${f.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(idx);
                  }}
                  style={iconButton("var(--red)")}
                >
                  <Trash size={11} />
                </button>
              </div>
            ))
          )}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "9px 12px",
              background: "var(--surface-2)",
            }}
          >
            <input
              aria-label="new function name"
              placeholder="mkcd"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") add();
              }}
              style={{ ...inputStyle, flex: 1 }}
            />
            <button onClick={add} style={iconButton("var(--accent)")}>
              <Plus size={12} />
            </button>
          </div>
        </div>
      </div>

      {/* editor */}
      <div style={{ flex: 1 }}>
        {current ? (
          <div style={cardStyle}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 14px",
                borderBottom: "1px solid var(--border-soft)",
              }}
            >
              <span className="mono" style={{ fontSize: 12, color: "var(--accent)" }}>
                {current.name}()
              </span>
              <span style={{ marginLeft: "auto" }}>
                <Toggle
                  on={current.enabled}
                  onChange={(v) => patch(selected, { enabled: v })}
                  label={`toggle function ${current.name}`}
                />
              </span>
            </div>
            <textarea
              aria-label={`function body ${current.name}`}
              value={current.body}
              onChange={(e) => patch(selected, { body: e.target.value })}
              spellCheck={false}
              style={{
                width: "100%",
                minHeight: 260,
                resize: "vertical",
                border: 0,
                background: "var(--surface)",
                color: "var(--text)",
                fontFamily: "var(--mono)",
                fontSize: 12.5,
                lineHeight: 1.6,
                padding: "12px 14px",
                outline: "none",
              }}
            />
          </div>
        ) : (
          <EmptyState
            icon={<FunctionIcon size={24} />}
            title="No function selected"
            subtitle="Add a function on the left to start editing its body."
          />
        )}
      </div>
    </div>
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
      <div
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid var(--border-soft)",
        }}
      >
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
  const [tab, setTab] = useState<EnvTab>("aliases");
  const [data, setData] = useState<EnvData | null>(null);
  const [serverData, setServerData] = useState<EnvData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [importCandidates, setImportCandidates] = useState<Candidate[] | null>(null);

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
      showHud?.({
        text: e instanceof Error ? e.message : "Save failed",
        type: "error",
      });
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
      showHud?.({
        text: e instanceof Error ? e.message : "Could not scan shell",
        type: "error",
      });
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

  const patch = useCallback((next: Partial<EnvData>) => {
    setData((prev) => (prev ? { ...prev, ...next } : prev));
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

      {/* toolbar: tabs + actions */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 16,
        }}
      >
        <nav aria-label="Aliases & Env tabs" style={{ display: "flex", gap: 2 }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
              style={{
                appearance: "none",
                border: 0,
                background: tab === t.id ? "var(--raise)" : "transparent",
                color: tab === t.id ? "var(--text)" : "var(--muted)",
                fontFamily: "var(--font)",
                fontSize: 13,
                padding: "6px 11px",
                borderRadius: "var(--rr)",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                transition: "background .12s, color .12s",
              }}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </nav>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
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

      {tab === "aliases" && (
        <AliasesTab aliases={data.aliases} onChange={(aliases) => patch({ aliases })} />
      )}
      {tab === "env" && <EnvTabPanel env={data.env} onChange={(env) => patch({ env })} />}
      {tab === "path" && <PathTab path={data.path} onChange={(path) => patch({ path })} />}
      {tab === "functions" && (
        <FunctionsTab functions={data.functions} onChange={(functions) => patch({ functions })} />
      )}
    </div>
  );
}
