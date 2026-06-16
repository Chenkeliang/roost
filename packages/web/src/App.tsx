import { useState, useEffect, useCallback } from "react";
import { ShieldCheck } from "@phosphor-icons/react";
import { useT } from "./i18n";
import type { Locale } from "./i18n/strings";
import { CommandPalette } from "./components/CommandPalette";
import { ActionBar } from "./components/ActionBar";
import { Hud, type HudMessage } from "./components/Hud";
import { Overview } from "./views/Overview";
import { Manage } from "./views/Manage";
import { AliasesEnv } from "./views/AliasesEnv";
import { Timeline } from "./views/Timeline";
import { Settings } from "./views/Settings";
import { Projects } from "./views/Projects";
import { Packages } from "./views/Packages";
import { Dotfiles } from "./views/Dotfiles";
import { AppConfig } from "./views/AppConfig";
import { AiTools } from "./views/AiTools";
import { SyncState } from "./views/SyncState";
import { openExternal } from "./openExternal";

type Tab = "overview" | "manage" | "projects" | "packages" | "dotfiles" | "appconfig" | "aitools" | "env" | "sync" | "timeline" | "settings";

type NavItem = { id: Tab; labelKey: string };

// Three-segment nav: main / content / tail — no group headings.
const NAV_MAIN: NavItem[] = [
  { id: "overview", labelKey: "nav.overview" },
  { id: "sync", labelKey: "nav.sync" },
  { id: "timeline", labelKey: "nav.timeline" },
];

const NAV_CONTENT: NavItem[] = [
  { id: "aitools", labelKey: "nav.aitools" },
  { id: "dotfiles", labelKey: "nav.dotfiles" },
  { id: "env", labelKey: "nav.env" },
  { id: "packages", labelKey: "nav.packages" },
  { id: "appconfig", labelKey: "nav.appconfig" },
  { id: "projects", labelKey: "nav.projects" },
];

const NAV_TAIL: NavItem[] = [
  { id: "settings", labelKey: "nav.settings" },
];

const DOCS_URL = "https://github.com/Chenkeliang/roost/tree/main/website";

// Inline coral logo mark (minimal single-line tree — matches the app icon)
function RoostMark() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="6.5 6 11 11"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: "var(--accent)", flexShrink: 0 }}
      aria-hidden="true"
    >
      <path d="M12 16.6 L12 7.7" />
      <path d="M12 13 C 10.4 12.4 9.4 11.2 8.9 9.4" />
      <path d="M12 13 C 13.6 12.4 14.6 11.2 15.1 9.4" />
      <path d="M12 10.7 C 11 10.1 10.2 9.1 9.9 7.9" />
      <path d="M12 10.7 C 13 10.1 13.8 9.1 14.1 7.9" />
      <path d="M12 8.6 C 11.4 7.8 11.1 7.1 11 6.4" />
      <path d="M12 8.6 C 12.6 7.8 12.9 7.1 13 6.4" />
    </svg>
  );
}

function NavButton({
  active,
  onClick,
  label,
  indent = false,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  indent?: boolean;
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
        fontSize: 14,
        textAlign: "left",
        // Module-group items are indented so they read as members of MODULES.
        padding: indent ? "7px 12px 7px 24px" : "7px 12px",
        borderRadius: "var(--rr)",
        cursor: "pointer",
        transition: "background .12s, color .12s",
      }}
    >
      {label}
    </button>
  );
}

// Segmented EN | 中 control for the sidebar bottom area.
function LanguageSwitcher({
  locale,
  setLocale,
}: {
  locale: Locale;
  setLocale: (l: Locale) => void;
}) {
  const opts: { id: Locale; label: string }[] = [
    { id: "en", label: "EN" },
    { id: "zh", label: "中" },
  ];
  return (
    <div
      aria-label="Language"
      style={{
        display: "inline-flex",
        border: "1px solid var(--border)",
        borderRadius: 999,
        overflow: "hidden",
      }}
    >
      {opts.map((o) => {
        const active = locale === o.id;
        return (
          <button
            key={o.id}
            onClick={() => setLocale(o.id)}
            aria-pressed={active}
            style={{
              appearance: "none",
              border: 0,
              background: active ? "var(--raise)" : "transparent",
              color: active ? "var(--text)" : "var(--muted)",
              fontFamily: "var(--font)",
              fontSize: 12.5,
              padding: "3px 9px",
              cursor: "pointer",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function App() {
  const { t, locale, setLocale } = useT();
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

      <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
        {/* Left grouped sidebar — fixed full-height column; scrolls internally if long */}
        <aside
          aria-label="Main navigation"
          style={{
            display: "flex",
            flexDirection: "column",
            width: 220,
            flexShrink: 0,
            height: "100vh",
            overflowY: "auto",
            background: "var(--surface)",
            borderRight: "1px solid var(--border-soft)",
            // Bottom padding clears the fixed 44px ActionBar footer so the
            // sidebar's bottom row (language switcher, Docs) is never buried.
            padding: "16px 12px 56px",
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

          {/* Main segment */}
          {NAV_MAIN.map((item) => (
            <NavButton
              key={item.id}
              label={t(item.labelKey)}
              active={activeTab === item.id}
              onClick={() => setActiveTab(item.id)}
            />
          ))}

          {/* Divider */}
          <div style={{ height: 1, background: "var(--border-soft)", margin: "8px 8px" }} />

          {/* Content segment */}
          {NAV_CONTENT.map((item) => (
            <NavButton
              key={item.id}
              label={t(item.labelKey)}
              active={activeTab === item.id}
              onClick={() => setActiveTab(item.id)}
            />
          ))}

          {/* Divider */}
          <div style={{ height: 1, background: "var(--border-soft)", margin: "8px 8px" }} />

          {/* Tail segment */}
          {NAV_TAIL.map((item) => (
            <NavButton
              key={item.id}
              label={t(item.labelKey)}
              active={activeTab === item.id}
              onClick={() => setActiveTab(item.id)}
            />
          ))}
        </aside>

        {/* Main content */}
        <main style={{ flex: 1, minWidth: 0, height: "100vh", overflowY: "auto", paddingTop: 28, paddingBottom: 60 }}>
          {activeTab === "overview" && (
            <Overview
              showHud={showHud}
              onOpenSync={() => setActiveTab("sync")}
              onOpenSetup={() => setActiveTab("settings")}
            />
          )}
          {activeTab === "manage" && <Manage showHud={showHud} />}
          {activeTab === "projects" && <Projects showHud={showHud} />}
          {activeTab === "packages" && <Packages showHud={showHud} />}
          {activeTab === "dotfiles" && <Dotfiles showHud={showHud} />}
          {activeTab === "appconfig" && <AppConfig showHud={showHud} />}
          {activeTab === "aitools" && <AiTools showHud={showHud} />}
          {activeTab === "env" && <AliasesEnv showHud={showHud} onOpenSettings={() => setActiveTab("settings")} />}
          {activeTab === "sync" && <SyncState onOpenSettings={() => setActiveTab("settings")} />}
          {activeTab === "timeline" && <Timeline showHud={showHud} onOpenSync={() => setActiveTab("sync")} />}
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
        onOpenSync={() => setActiveTab("sync")}
        onOpenTimeline={() => setActiveTab("timeline")}
        onOpenSettings={() => setActiveTab("settings")}
      />

      {/* HUD Toast */}
      <Hud message={hud} onDismiss={dismissHud} />

      {/* Action Bar */}
      <ActionBar
        onApply={() => setActiveTab("overview")}
        onOpenPalette={() => setPaletteOpen(true)}
        left={
          <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "3px 8px",
                border: "1px solid var(--border)",
                borderRadius: 999,
                fontSize: 12.5,
              }}
            >
              <ShieldCheck size={13} style={{ color: "var(--green)" }} weight="fill" />
              local
            </span>
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => {
                e.preventDefault();
                void openExternal(DOCS_URL);
              }}
              style={{ color: "var(--muted)", textDecoration: "none", whiteSpace: "nowrap" }}
            >
              {t("app.docs")}
            </a>
            <LanguageSwitcher locale={locale} setLocale={setLocale} />
          </span>
        }
      />
    </>
  );
}
