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

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "manage", label: "Manage" },
  { id: "projects", label: "Projects" },
  { id: "packages", label: "Packages" },
  { id: "dotfiles", label: "Dotfiles" },
  { id: "appconfig", label: "App Config" },
  { id: "env", label: "Aliases & Env" },
  { id: "drift", label: "Drift" },
  { id: "timeline", label: "Timeline" },
  { id: "settings", label: "Settings" },
];

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

      {/* Top Bar */}
      <header
        style={{
          position: "sticky",
          top: 0,
          background: "var(--bg)",
          zIndex: 20,
          borderBottom: "1px solid var(--border-soft)",
          marginBottom: 20,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            maxWidth: 1080,
            margin: "0 auto",
            padding: "6px 24px 16px",
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
          }}
        >
          <RoostMark />
          Roost
        </div>

        {/* Nav tabs */}
        <nav
          aria-label="Main navigation"
          style={{ display: "flex", gap: 2, marginLeft: 6 }}
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              aria-current={activeTab === tab.id ? "page" : undefined}
              style={{
                appearance: "none",
                border: 0,
                background:
                  activeTab === tab.id ? "var(--raise)" : "transparent",
                color:
                  activeTab === tab.id ? "var(--text)" : "var(--muted)",
                fontFamily: "var(--font)",
                fontSize: 13,
                padding: "6px 11px",
                borderRadius: "var(--rr)",
                cursor: "pointer",
                transition: "background .12s, color .12s",
              }}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Right side */}
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 12,
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
        </div>
        </div>
      </header>

      {/* Main content */}
      <main style={{ paddingBottom: 60 }}>
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
