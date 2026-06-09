/// <reference types="vite/client" />

// TS 6.0 enables noUncheckedSideEffectImports: declare CSS side-effect imports
// (e.g. `import "./index.css"`) so the bundler-handled import type-checks.
declare module "*.css";
