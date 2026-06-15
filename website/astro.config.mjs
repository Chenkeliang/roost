// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// Roost docs site (Starlight). Fully static / offline build; built-in Pagefind
// search. Standalone from the product workspace.
//
// GitHub Pages serves this project site under a `/roost` sub-path. The deploy
// workflow sets PAGES_BASE=/roost so the build emits the correct base; local
// dev/build leaves it unset and serves from the root. Starlight rewrites
// internal links and the sidebar to honor `base` automatically.
const base = process.env.PAGES_BASE ?? undefined;

export default defineConfig({
  site: "https://chenkeliang.github.io",
  base,
  integrations: [
    starlight({
      title: "Roost",
      // Tagline from the README.
      tagline: "Settle into any Mac.",
      logo: { src: "./src/assets/logo.svg", alt: "Roost" },
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/Chenkeliang/roost",
        },
      ],
      customCss: [
        "@fontsource-variable/geist",
        "@fontsource-variable/geist-mono",
        "./src/styles/custom.css",
      ],
      defaultLocale: "en",
      locales: {
        en: { label: "English", lang: "en" },
        "zh-cn": { label: "简体中文", lang: "zh-CN" },
      },
      sidebar: [
        {
          label: "Getting Started",
          translations: { "zh-CN": "开始使用" },
          items: [
            { label: "Introduction", slug: "introduction" },
            { label: "Installation", slug: "installation" },
            { label: "Environment Check", slug: "environment-setup", translations: { "zh-CN": "环境检查" } },
            { label: "Quick Start", slug: "quick-start" },
          ],
        },
        {
          label: "Concepts",
          translations: { "zh-CN": "核心概念" },
          items: [
            { label: "Core Concepts", slug: "core-concepts" },
            { label: "Modules", slug: "modules" },
            { label: "AI Tools", slug: "ai-tools", translations: { "zh-CN": "AI 工具" } },
            { label: "Skills", slug: "skills", translations: { "zh-CN": "Skills 技能" } },
            { label: "Projects", slug: "projects" },
            { label: "Aliases & Env", slug: "aliases-and-env" },
            { label: "Secrets", slug: "secrets" },
          ],
        },
        {
          label: "Using Roost",
          translations: { "zh-CN": "使用 Roost" },
          items: [
            { label: "Dashboard", slug: "dashboard" },
            { label: "Sync Review", slug: "sync-review", translations: { "zh-CN": "同步复核" } },
            { label: "History & Restore", slug: "drift-and-snapshots", translations: { "zh-CN": "历史与恢复" } },
            { label: "Backup Automation", slug: "backup-automation", translations: { "zh-CN": "备份自动化" } },
            { label: "Safety & FAQ", slug: "safety-and-faq" },
          ],
        },
        {
          label: "Reference",
          translations: { "zh-CN": "参考" },
          items: [
            { label: "CLI Reference", slug: "cli-reference" },
            { label: "Profiles", slug: "profiles" },
            { label: "Troubleshooting", slug: "troubleshooting" },
          ],
        },
      ],
    }),
  ],
});
