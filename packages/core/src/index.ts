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
export { loadProfiles, resolveProfile, DEFAULT_PROFILE } from "./profiles.js";
export type { Profile, ResolvedProfile, ProfileVia } from "./profiles.js";
export { createOpBackend, createRbwBackend } from "./secrets/backend.js";
export type { SecretBackend } from "./secrets/backend.js";
export { ensureAgeKey } from "./secrets/agekey.js";
export type { AgeKeyResult } from "./secrets/agekey.js";
export { scanForSecrets, hasSecret, assertNoPlaintextSecrets } from "./secrets/scanner.js";
export type { SecretFinding } from "./secrets/scanner.js";
export { scanDir, isNoise } from "./discovery/scan.js";
export type { ScanCandidate } from "./discovery/scan.js";
export { dotfilesModule, classifyDotfile, isSensitivePath, isRoostManaged } from "./modules/dotfiles.js";
export { packagesModule, parseBrewfile, brewfileText } from "./modules/packages.js";
export type { BrewfileEntries } from "./modules/packages.js";
export { appconfigModule, classifyDomain, SENSITIVE_DOMAIN_HINTS } from "./modules/appconfig.js";
export { projectsModule, findGitRepos, repoInfo, testRemote } from "./modules/projects.js";
export {
  envModule,
  generateEnvSh,
  renderRcSourceLine,
  ensureRcSourced,
  removeRcMarker,
  rcHasMarker,
  extractImportCandidates,
  envShPath,
  roostConfigDir,
} from "./modules/env.js";
export {
  emptyEnvData,
  loadEnvData,
  saveEnvData,
  validateEnvData,
  ENV_SCHEMA_VERSION,
} from "./env-data.js";
export {
  DEFAULT_APP_CONFIG_CATALOG,
  loadAppConfigCatalog,
  expandCatalogPath,
} from "./app-config-catalog.js";
export type { CatalogApp } from "./app-config-catalog.js";
export { ensureChezmoiAgeConfig } from "./chezmoi-config.js";
export {
  defaultAgeKeyPath,
  envSecretsDir,
  envSecretPath,
  recipientFromKey,
  encryptEnvSecret,
  decryptEnvSecret,
} from "./env-crypto.js";
export {
  emptyProjects,
  loadProjects,
  saveProjects,
  PROJECTS_SCHEMA_VERSION,
} from "./projects.js";
export type { ProjectEntry, ProjectsDoc } from "./projects.js";
export { snapshotDomains, diffSnapshots, quitApp } from "./discovery/learn.js";
export type { DomainSnapshot } from "./discovery/learn.js";
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
export { PRESETS, getPreset, applyPreset } from "./presets.js";
export type { Preset } from "./presets.js";
export {
  defaultRegistry,
  discoverAll,
  captureAll,
  gateSecrets,
  statusAll,
  loadAll,
  indexAll,
} from "./orchestrate.js";
export {
  createDotfilesRepoImporter,
  createMackupImporter,
  detectImporters,
} from "./import/index.js";
export type { Importer, ImportResult } from "./import/index.js";
export { auditRepo } from "./secrets/audit.js";
export type { AuditReport, AuditFinding } from "./secrets/audit.js";
export { rotateAgeKey, rotateToNewKey } from "./secrets/rotate.js";
export type { RotateResult, RotateToNewKeyResult } from "./secrets/rotate.js";
export {
  ROOST_API_VERSION,
  validatePlugin,
  loadPlugins,
} from "./plugins/loader.js";
export type {
  PluginManifest,
  RoostPlugin,
  LoadResult,
  LoadPluginOpts,
} from "./plugins/loader.js";
