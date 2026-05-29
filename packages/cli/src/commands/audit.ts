import type { AuditReport } from "@roost/core";
import { auditRepo } from "@roost/core";

export interface AuditDeps {
  repoDir: string;
}

export async function runAudit(deps: AuditDeps): Promise<AuditReport> {
  const report = auditRepo(deps.repoDir);
  return report;
}
