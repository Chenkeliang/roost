// Rule-based capture changelog (ADR-0022 §4). Pure; offline; no LLM.
import type { ChangeSet } from "@roost/shared";

export function summarizeCapture(changes: ChangeSet[]): { subject: string; body: string } {
  const active = changes.filter(
    (c) => c.written.length + c.encrypted.length + (c.blocked?.length ?? 0) > 0,
  );
  if (active.length === 0) return { subject: "roost: capture", body: "" };

  const parts = active
    .filter((c) => c.written.length + c.encrypted.length > 0)
    .map((c) => `${c.module}(${c.written.length + c.encrypted.length})`);
  let subject = parts.length > 0 ? `capture: ${parts.join(" ")}` : "capture: blocked only";
  if (subject.length > 72) {
    const items = active.reduce((n, c) => n + c.written.length + c.encrypted.length, 0);
    subject = `capture: ${parts.length} modules, ${items} items`;
  }

  const lines: string[] = [];
  for (const c of active) {
    const ids = [...c.written, ...c.encrypted.map((id) => `${id} (encrypted)`)];
    if (ids.length > 0) lines.push(`${c.module}: ${ids.join(", ")}`);
    for (const b of c.blockedDetail ?? []) lines.push(`blocked: ${b.id} (${b.reason})`);
  }
  return { subject, body: lines.join("\n") };
}
