import { redact } from "../logger.js";

export interface SecretFinding {
  rule: string;
  redactedSample: string;
}

interface Rule {
  name: string;
  pattern: RegExp;
}

const RULES: Rule[] = [
  {
    name: "pem-private-key",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  },
  {
    name: "aws-access-key",
    pattern: /AKIA[0-9A-Z]{16}/,
  },
  {
    name: "token-prefix",
    pattern: /(?:ghp_|gho_|ghs_|github_pat_|glpat-|xox[baprs]-)[A-Za-z0-9_\-]{8,}|sk-[A-Za-z0-9]{20,}/,
  },
  {
    name: "npm-auth-token",
    pattern: /_authToken\s*=\s*\S+/,
  },
  {
    name: "generic-credential",
    pattern:
      /(?:api[_-]?key|secret|token|passwd|password)\s*[:=]\s*['"]?[A-Za-z0-9/+_=\-]{16,}/i,
  },
  {
    // App config (e.g. JetBrains/DataGrip) stores creds in XML: <password>…</password>
    // or <... key="Password">…</...>. Require a non-trivial value to avoid noise.
    name: "xml-password",
    pattern: /(?:<password>|key="password">)\s*([^<\s]{8,})/i,
  },
  {
    // JDBC connection URLs embedding credentials: jdbc:<driver>://user:pass@host
    name: "jdbc-url-credential",
    pattern: /jdbc:[a-z0-9]+:\/\/([^\s:/@"']+:[^\s:/@"']+)@/i,
  },
];

export function scanForSecrets(content: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const rule of RULES) {
    const match = rule.pattern.exec(content);
    if (match !== null) {
      // If the rule captures the sensitive part in group 1, mask it before
      // building the sample so the secret value never appears in logs/output.
      const raw = match[1] ? match[0].replace(match[1], "***") : match[0];
      findings.push({
        rule: rule.name,
        redactedSample: redact(raw),
      });
    }
  }
  return findings;
}

export function hasSecret(content: string): boolean {
  return scanForSecrets(content).length > 0;
}

export function assertNoPlaintextSecrets(
  files: { path: string; content: string }[],
): void {
  const offenses: string[] = [];
  for (const file of files) {
    const findings = scanForSecrets(file.content);
    for (const finding of findings) {
      offenses.push(`${file.path} (${finding.rule})`);
    }
  }
  if (offenses.length > 0) {
    throw new Error(
      `Plaintext secrets detected — capture blocked:\n${offenses.join("\n")}`,
    );
  }
}
