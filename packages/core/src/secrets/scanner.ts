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
];

export function scanForSecrets(content: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const rule of RULES) {
    const match = rule.pattern.exec(content);
    if (match !== null) {
      findings.push({
        rule: rule.name,
        redactedSample: redact(match[0]),
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
