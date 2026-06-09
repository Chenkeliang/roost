# Roost docs site

The Roost documentation site, built with [Astro](https://astro.build/) +
[Starlight](https://starlight.astro.build/). It is a fully static, offline build
with built-in Pagefind search, and is **standalone from the product workspace**
(its own `package.json` / `pnpm-lock.yaml` / `pnpm-workspace.yaml`).

## Develop

```sh
pnpm --dir website install
pnpm --dir website dev      # local dev server at the site root
pnpm --dir website build    # static build into website/dist/
pnpm --dir website preview  # preview the production build
```

Content lives in `src/content/docs/{en,zh-cn}/`; the homepage is
`src/content/docs/index.mdx`. Theme tokens are in `src/styles/custom.css` and the
config is `astro.config.mjs`.

## Deployment

Deployment is automated by [`.github/workflows/docs.yml`](../.github/workflows/docs.yml):

- On every push/PR touching `website/**`, the **build** job builds the docs and
  uploads the Pages artifact (this verifies the docs build, even on a private repo).
- The **deploy** job runs **only on pushes to `main`** and publishes to GitHub
  Pages. It does not run on feature branches or PRs.

The site is served from the `/roost` sub-path on GitHub Pages, so the workflow
sets `PAGES_BASE=/roost` for the build. Local dev/build leaves `PAGES_BASE` unset
and serves from the root.

**Two prerequisites before Pages goes live:**

1. The repo must be **public**, or on a GitHub plan that allows **Pages on
   private repos**.
2. **Enable Pages**: Settings → Pages → Source: **GitHub Actions**.

### Alternative: Cloudflare Pages (works while the repo stays private)

If you want to publish without making the repo public, connect the repo to
Cloudflare Pages instead:

- Build command: `pnpm --dir website install && pnpm --dir website build`
- Output directory: `website/dist`
- Provide a `CLOUDFLARE_API_TOKEN` (and account ID) for the deploy.

In that case the `/roost` base is not needed — drop `PAGES_BASE` (a Cloudflare
Pages project serves from its own root).
