# roost-module-fonts

A reference implementation of the `roost-module-*` plugin contract for [Roost](../../README.md).

## The roost-module-* contract

A plugin package must export an object (or use a default export) with two fields:

```js
export const manifest = {
  name: "roost-module-<topic>",  // must match the npm package name
  version: "0.1.0",              // semver string
  roostApi: 1,                   // must equal ROOST_API_VERSION from @roost/core
};

export function createModule() {
  return {
    name: "<topic>",             // registered under this name in ModuleRegistry
    // All SyncModule methods: discover, status, capture, apply, diff, unmanage, doctor
  };
}
```

`loadPlugins()` in `@roost/core` will:

1. `import(spec)` the package by name.
2. Call `validatePlugin()` to check the shape and `manifest.roostApi` version.
3. Call `createModule()` and register the result in the `ModuleRegistry`.

Plugins receive a `ModuleContext` at runtime (same as every built-in module) and
have no special access to core internals.

## Usage

```js
import { loadPlugins, defaultRegistry } from "@roost/core";

const reg = defaultRegistry();
await loadPlugins(reg, ["roost-module-fonts"]);
```
