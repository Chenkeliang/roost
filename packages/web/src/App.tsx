import { useState, useEffect, useCallback } from "react";
import { ShieldCheck } from "@phosphor-icons/react";
import { CommandPalette } from "./components/CommandPalette";
import { ActionBar } from "./components/ActionBar";
import { Hud, type HudMessage } from "./components/Hud";
import { Overview } from "./views/Overview";
import { Manage } from "./views/Manage";
import { AliasesEnv } from "./views/AliasesEnv";
import { Drift } from "./views/Drift";
import { Timeline } from "./views/Timeline";
import { Settings } from "./views/Settings";
import { Projects } from "./views/Projects";
import { Packages } from "./views/Packages";
import { Dotfiles } from "./views/Dotfiles";
import { AppConfig } from "./views/AppConfig";

type Tab = "overview" | "manage" | "projects" | "packages" | "dotfiles" | "appconfig" | "env" | "drift" | "timeline" | "settings";

type NavItem = { id: Tab; label: string };

// Top-level item shown above the Modules group.
const TOP_NAV: NavItem[] = [{ id: "overview", label: "Overview" }];

// "Modules" group — the SyncModule-backed rich pages.
const MODULE_NAV: NavItem[] = [
  { id: "dotfiles", label: "Dotfiles" },
  { id: "packages", label: "Packages" },
  { id: "projects", label: "Projects" },
  { id: "appconfig", label: "App Config" },
  { id: "env", label: "Aliases & Env" },
];

// Cross-module / system items below the divider.
const TAIL_NAV: NavItem[] = [
  { id: "drift", label: "Drift" },
  { id: "timeline", label: "Timeline" },
  { id: "settings", label: "Settings" },
];

const DOCS_URL = "https://github.com/Chenkeliang/roost/tree/main/website";

// Inline coral logo mark (two devices + transfer arc)
function RoostMark() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      style={{ color: "var(--accent)", flexShrink: 0 }}
      aria-hidden="true"
    >
      <rect x="2.5" y="6" width="9" height="6.5" rx="1.3" />
      <rect x="13" y="11.5" width="8.5" height="6" rx="1.3" />
      <path d="M11.5 9.2c4 0 .5 5 5.5 5" strokeDasharray="1 2" />
    </svg>
  );
}

function NavButton({
  item,
  active,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        width: "100%",
        appearance: "none",
        border: 0,
        borderLeft: `2px solid ${active ? "var(--accent)" : "transparent"}`,
        background: active ? "var(--raise)" : "transparent",
        color: active ? "var(--text)" : "var(--muted)",
        fontFamily: "var(--font)",
        fontSize: 13,
        textAlign: "left",
        padding: "7px 12px",
        borderRadius: "var(--rr)",
        cursor: "pointer",
        transition: "background .12s, color .12s",
      }}
    >
      {item.label}
    </button>
  );
}

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [hud, setHud] = useState<HudMessage | null>(null);

  const showHud = useCallback((msg: HudMessage) => {
    setHud(msg);
  }, []);

  const dismissHud = useCallback(() => {
    setHud(null);
  }, []);

  // Global ⌘K handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <>
      {/* CSS keyframe animations (injected once) */}
      <style>{`
        @keyframes roost-shimmer { to { background-position: -200% 0 } }
        @keyframes roost-pop { from { opacity: 0; transform: scale(.97) } to { opacity: 1; transform: none } }
        @keyframes roost-hud { from { opacity: 0; transform: translate(-50%, 8px) } to { opacity: 1; transform: translateX(-50%) } }
      `}</style>

      <div style={{ display: "flex" }}>
        {/* Left grouped sidebar */}
        <aside
          aria-label="Main navigation"
          style={{
            display: "flex",
            flexDirection: "column",
            width: 220,
            flexShrink: 0,
            minHeight: "100vh",
            position: "sticky",
            top: 0,
            background: "var(--surface)",
            borderRight: "1px solid var(--border-soft)",
            padding: "16px 12px",
            gap: 4,
          }}
        >
          {/* Brand */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              fontWeight: 600,
              letterSpacing: "-.01em",
              fontSize: 15,
              padding: "4px 10px 14px",
            }}
          >
            <RoostMark />
            Roost
          </div>

          {/* Top-level */}
          {TOP_NAV.map((item) => (
            <NavButton
              key={item.id}
              item={item}
              active={activeTab === item.id}
              onClick={() => setActiveTab(item.id)}
            />
          ))}

          {/* Modules group */}
          <div
            style={{
              textTransform: "uppercase",
              letterSpacing: ".06em",
              fontSize: 10.5,
              fontWeight: 600,
              color: "var(--muted)",
              padding: "14px 12px 6px",
            }}
          >
            Modules
          </div>
          {MODULE_NAV.map((item) => (
            <NavButton
              key={item.id}
              item={item}
              active={activeTab === item.id}
              onClick={() => setActiveTab(item.id)}
            />
          ))}

          {/* Divider */}
          <div
            style={{
              height: 1,
              background: "var(--border-soft)",
              margin: "12px 8px",
            }}
          />
          {TAIL_NAV.map((item) => (
            <NavButton
              key={item.id}
              item={item}
              active={activeTab === item.id}
              onClick={() => setActiveTab(item.id)}
            />
          ))}

          {/* Bottom */}
          <div
            style={{
              marginTop: "auto",
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 10px 2px",
              color: "var(--muted)",
              fontSize: 12,
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "3px 9px",
                border: "1px solid var(--border)",
                borderRadius: 999,
                fontSize: 12,
              }}
            >
              <ShieldCheck size={13} style={{ color: "var(--green)" }} weight="fill" />
              local
            </span>
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--muted)", textDecoration: "none" }}
            >
              Docs
            </a>
            <span
              style={{
                marginLeft: "auto",
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: "var(--muted)",
              }}
            >
              ⌘K
            </span>
          </div>
        </aside>

        {/* Main content */}
        <main style={{ flex: 1, minWidth: 0, paddingBottom: 60 }}>
          {activeTab === "overview" && <Overview showHud={showHud} />}
          {activeTab === "manage" && <Manage showHud={showHud} />}
          {activeTab === "projects" && <Projects showHud={showHud} />}
          {activeTab === "packages" && <Packages showHud={showHud} />}
          {activeTab === "dotfiles" && <Dotfiles showHud={showHud} />}
          {activeTab === "appconfig" && <AppConfig showHud={showHud} />}
          {activeTab === "env" && <AliasesEnv showHud={showHud} />}
          {activeTab === "drift" && <Drift />}
          {activeTab === "timeline" && <Timeline />}
          {activeTab === "settings" && <Settings />}
        </main>
      </div>

      {/* Command Palette */}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onCapture={() => {
          setActiveTab("overview");
        }}
        onLoad={() => {
          setActiveTab("overview");
        }}
        onOpenDrift={() => setActiveTab("drift")}
        onOpenTimeline={() => setActiveTab("timeline")}
        onOpenSettings={() => setActiveTab("settings")}
      />

      {/* HUD Toast */}
      <Hud message={hud} onDismiss={dismissHud} />

      {/* Action Bar */}
      <ActionBar
        onApply={() => setActiveTab("overview")}
        onOpenPalette={() => setPaletteOpen(true)}
      />
    </>
  );
}
