import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";

export const PROJECTS_SCHEMA_VERSION = 1;

export interface ProjectEntry {
  path: string;
  repo: string | null;
  envTool: "mise" | "none";
}

export interface ProjectsDoc {
  schemaVersion: number;
  projects: ProjectEntry[];
}

export function emptyProjects(): ProjectsDoc {
  return { schemaVersion: PROJECTS_SCHEMA_VERSION, projects: [] };
}

function projectsPath(repoDir: string): string {
  return path.join(repoDir, "roost", "projects.yaml");
}

function validateShape(raw: unknown): ProjectsDoc {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("projects.yaml must be a YAML object");
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj["schemaVersion"] !== "number") {
    throw new Error("projects.yaml: schemaVersion must be a number");
  }

  if (!Array.isArray(obj["projects"])) {
    throw new Error("projects.yaml: projects must be an array");
  }

  const projects: ProjectEntry[] = [];
  for (const item of obj["projects"] as unknown[]) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error("projects.yaml: each project entry must be an object");
    }
    const entry = item as Record<string, unknown>;

    if (typeof entry["path"] !== "string") {
      throw new Error("projects.yaml: each entry must have a string path");
    }

    if (entry["repo"] !== null && typeof entry["repo"] !== "string") {
      throw new Error("projects.yaml: entry repo must be a string or null");
    }

    if (entry["envTool"] !== "mise" && entry["envTool"] !== "none") {
      throw new Error(
        `projects.yaml: entry envTool must be "mise" or "none", got: ${String(entry["envTool"])}`,
      );
    }

    projects.push({
      path: entry["path"] as string,
      repo: (entry["repo"] as string | null) ?? null,
      envTool: entry["envTool"] as "mise" | "none",
    });
  }

  return { schemaVersion: obj["schemaVersion"] as number, projects };
}

export function loadProjects(repoDir: string): ProjectsDoc {
  const filePath = projectsPath(repoDir);
  if (!fs.existsSync(filePath)) {
    return emptyProjects();
  }
  const raw = yaml.load(fs.readFileSync(filePath, "utf8"));
  return validateShape(raw);
}

export function saveProjects(repoDir: string, doc: ProjectsDoc): void {
  const filePath = projectsPath(repoDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, yaml.dump(doc), "utf8");
}
