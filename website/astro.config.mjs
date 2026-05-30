// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// Roost docs site (Starlight). Fully static / offline build; built-in Pagefind
// search. Standalone from the product workspace.
export default defineConfig({
  // Update to the real deploy URL when publishing.
  site: "https://chenkeliang.github.io/roost",
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
          items: [
            { label: "Introduction", slug: "introduction" },
            { label: "Installation", slug: "installation" },
            { label: "Quick Start", slug: "quick-start" },
          ],
        },
        {
          label: "Concepts",
          items: [
            { label: "Core Concepts", slug: "core-concepts" },
            { label: "Modules", slug: "modules" },
            { label: "Aliases & Env", slug: "aliases-and-env" },
            { label: "Secrets", slug: "secrets" },
          ],
        },
        {
          label: "Using Roost",
          items: [
            { label: "Dashboard", slug: "dashboard" },
            { label: "Safety & FAQ", slug: "safety-and-faq" },
          ],
        },
      ],
    }),
  ],
});
