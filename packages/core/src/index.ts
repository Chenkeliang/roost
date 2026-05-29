// @roost/core - exports accumulate here
export { createExec } from "./exec.js";
export { createLogger, redact } from "./logger.js";
export { createT } from "./i18n/index.js";
export { ModuleRegistry } from "./registry.js";
export { exampleModule } from "./modules/example.js";
export { createChezmoi } from "./adapters/chezmoi.js";
export type { Chezmoi } from "./adapters/chezmoi.js";
export {
  emptySelection,
  loadSelection,
  saveSelection,
  addItem,
  removeItem,
  SELECTION_SCHEMA_VERSION,
} from "./selection.js";
export type { SelectionDoc } from "./selection.js";
export { createOpBackend, createRbwBackend } from "./secrets/backend.js";
export type { SecretBackend } from "./secrets/backend.js";
export { ensureAgeKey } from "./secrets/agekey.js";
export type { AgeKeyResult } from "./secrets/agekey.js";
export { scanForSecrets, hasSecret, assertNoPlaintextSecrets } from "./secrets/scanner.js";
export type { SecretFinding } from "./secrets/scanner.js";
export { scanDir, isNoise } from "./discovery/scan.js";
export type { ScanCandidate } from "./discovery/scan.js";
export { dotfilesModule, classifyDotfile, isSensitivePath } from "./modules/dotfiles.js";
export { packagesModule } from "./modules/packages.js";
export {
  STATE_SCHEMA_VERSION,
  stateDir,
  writeState,
  readState,
  listStateHosts,
  commitRepo,
} from "./state.js";
export type { MachineState } from "./state.js";
export { backupFiles } from "./apply.js";
