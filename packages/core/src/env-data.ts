import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import type {
  EnvData,
  AliasItem,
  EnvVarItem,
  PathEntry,
  FunctionItem,
} from "@roost/shared";

export const ENV_SCHEMA_VERSION = 1;

export function emptyEnvData(): EnvData {
  return { schemaVersion: ENV_SCHEMA_VERSION, aliases: [], env: [], path: [], functions: [] };
}

function envPath(repoDir: string): string {
  return path.join(repoDir, "roost", "env.yaml");
}

function asRecord(item: unknown, ctx: string): Record<string, unknown> {
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    throw new Error(`env.yaml: ${ctx} must be an object`);
  }
  return item as Record<string, unknown>;
}

function reqString(obj: Record<string, unknown>, key: string, ctx: string): string {
  const v = obj[key];
  if (typeof v !== "string") {
    throw new Error(`env.yaml: ${ctx} field "${key}" must be a string`);
  }
  return v;
}

function reqBool(obj: Record<string, unknown>, key: string, ctx: string): boolean {
  const v = obj[key];
  if (typeof v !== "boolean") {
    throw new Error(`env.yaml: ${ctx} field "${key}" must be a boolean`);
  }
  return v;
}

function optComment(obj: Record<string, unknown>, ctx: string): string | undefined {
  const v = obj["comment"];
  if (v === undefined) return undefined;
  if (typeof v !== "string") {
    throw new Error(`env.yaml: ${ctx} field "comment" must be a string`);
  }
  return v;
}

function withComment<T extends object>(base: T, comment: string | undefined): T {
  return comment === undefined ? base : { ...base, comment };
}

function parseAlias(item: unknown): AliasItem {
  const obj = asRecord(item, "alias entry");
  return withComment<AliasItem>(
    {
      kind: "alias",
      name: reqString(obj, "name", "alias entry"),
      value: reqString(obj, "value", "alias entry"),
      enabled: reqBool(obj, "enabled", "alias entry"),
    },
    optComment(obj, "alias entry"),
  );
}

function parseEnv(item: unknown): EnvVarItem {
  const obj = asRecord(item, "env entry");
  return withComment<EnvVarItem>(
    {
      kind: "env",
      name: reqString(obj, "name", "env entry"),
      value: reqString(obj, "value", "env entry"),
      secret: reqBool(obj, "secret", "env entry"),
      enabled: reqBool(obj, "enabled", "env entry"),
    },
    optComment(obj, "env entry"),
  );
}

function parsePath(item: unknown): PathEntry {
  const obj = asRecord(item, "path entry");
  const position = obj["position"];
  if (position !== "prepend" && position !== "append") {
    throw new Error(`env.yaml: path entry "position" must be "prepend" or "append"`);
  }
  return withComment<PathEntry>(
    {
      kind: "path",
      value: reqString(obj, "value", "path entry"),
      position,
      enabled: reqBool(obj, "enabled", "path entry"),
    },
    optComment(obj, "path entry"),
  );
}

function parseFunction(item: unknown): FunctionItem {
  const obj = asRecord(item, "function entry");
  return withComment<FunctionItem>(
    {
      kind: "function",
      name: reqString(obj, "name", "function entry"),
      body: reqString(obj, "body", "function entry"),
      enabled: reqBool(obj, "enabled", "function entry"),
    },
    optComment(obj, "function entry"),
  );
}

function reqArray(obj: Record<string, unknown>, key: string): unknown[] {
  const v = obj[key];
  if (!Array.isArray(v)) {
    throw new Error(`env.yaml: "${key}" must be an array`);
  }
  return v;
}

export function validateEnvData(raw: unknown): EnvData {
  const obj = asRecord(raw, "root");
  if (typeof obj["schemaVersion"] !== "number") {
    throw new Error("env.yaml: schemaVersion must be a number");
  }
  return {
    schemaVersion: obj["schemaVersion"],
    aliases: reqArray(obj, "aliases").map(parseAlias),
    env: reqArray(obj, "env").map(parseEnv),
    path: reqArray(obj, "path").map(parsePath),
    functions: reqArray(obj, "functions").map(parseFunction),
  };
}

export function loadEnvData(repoDir: string): EnvData {
  const filePath = envPath(repoDir);
  if (!fs.existsSync(filePath)) return emptyEnvData();
  return validateEnvData(yaml.load(fs.readFileSync(filePath, "utf8")));
}

export function saveEnvData(repoDir: string, data: EnvData): void {
  const filePath = envPath(repoDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, yaml.dump(data), "utf8");
}
