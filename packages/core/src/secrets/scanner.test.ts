import { describe, it, expect } from "vitest";
import { scanForSecrets, hasSecret, assertNoPlaintextSecrets } from "./scanner.js";

// ── helpers ──────────────────────────────────────────────────────────────────

function rulesOf(content: string): string[] {
  return scanForSecrets(content).map((f) => f.rule);
}

function noRawSecret(finding: { redactedSample: string }, raw: string): boolean {
  return !finding.redactedSample.includes(raw);
}

// ── PEM private key ───────────────────────────────────────────────────────────

describe("PEM private key rule", () => {
  it("detects RSA private key header", () => {
    const content = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...";
    expect(hasSecret(content)).toBe(true);
    expect(rulesOf(content)).toContain("pem-private-key");
  });

  it("detects EC private key header", () => {
    const content = "-----BEGIN EC PRIVATE KEY-----\nMHQCAQEEI...";
    expect(hasSecret(content)).toBe(true);
    expect(rulesOf(content)).toContain("pem-private-key");
  });

  it("detects bare PRIVATE KEY header", () => {
    const content = "-----BEGIN PRIVATE KEY-----\nMIIEvQ...";
    expect(hasSecret(content)).toBe(true);
    expect(rulesOf(content)).toContain("pem-private-key");
  });

  it("redactedSample does not contain the raw header text verbatim", () => {
    const raw = "-----BEGIN RSA PRIVATE KEY-----";
    const content = `${raw}\nMIIEo...`;
    const findings = scanForSecrets(content);
    const pem = findings.find((f) => f.rule === "pem-private-key");
    expect(pem).toBeDefined();
    // redact() will mask it — sample must not be the literal secret
    // (It's fine if it contains "***"; what must NOT happen is the raw block appearing)
    expect(pem!.redactedSample).not.toBe(raw);
  });
});

// ── AWS access key ────────────────────────────────────────────────────────────

describe("AWS access key rule", () => {
  const awsKey = "AKIAIOSFODNN7EXAMPLE";

  it("detects AKIA... key", () => {
    expect(hasSecret(awsKey)).toBe(true);
    expect(rulesOf(awsKey)).toContain("aws-access-key");
  });

  it("redactedSample does not contain the raw key", () => {
    const findings = scanForSecrets(awsKey);
    const f = findings.find((f) => f.rule === "aws-access-key");
    expect(f).toBeDefined();
    expect(noRawSecret(f!, awsKey)).toBe(true);
  });

  it("does not fire for AKID (wrong prefix)", () => {
    expect(rulesOf("AKIDFOOBAR12345678")).not.toContain("aws-access-key");
  });
});

// ── GitHub / GitLab / Slack tokens ───────────────────────────────────────────

describe("token prefixes rule", () => {
  const tokens: [string, string][] = [
    ["ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345", "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345"],
    ["gho_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345", "gho_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345"],
    ["ghs_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345", "ghs_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345"],
    ["github_pat_11ABCDEFG0abcdefghijklmnop", "github_pat_11ABCDEFG0abcdefghijklmnop"],
    ["glpat-abcdefghijklmnopqrst", "glpat-abcdefghijklmnopqrst"],
    ["xoxb-123456789-abcdefghijklmno", "xoxb-123456789-abcdefghijklmno"],
    ["xoxp-123456789-abcdefghijklmno", "xoxp-123456789-abcdefghijklmno"],
  ];

  for (const [input, rawValue] of tokens) {
    it(`detects ${input.slice(0, 8)}...`, () => {
      expect(hasSecret(input)).toBe(true);
      expect(rulesOf(input)).toContain("token-prefix");
      const f = scanForSecrets(input).find((x) => x.rule === "token-prefix");
      expect(f).toBeDefined();
      expect(noRawSecret(f!, rawValue)).toBe(true);
    });
  }
});

// ── OpenAI / generic sk- key ──────────────────────────────────────────────────

describe("sk- key rule", () => {
  it("detects sk- with 20+ chars", () => {
    const key = "sk-abcdefghijklmnopqrstuvwxyz123456";
    expect(hasSecret(key)).toBe(true);
    expect(rulesOf(key)).toContain("token-prefix");
  });

  it("does not fire for sk- with fewer than 20 chars", () => {
    expect(rulesOf("sk-short")).not.toContain("token-prefix");
  });
});

// ── npm authToken ─────────────────────────────────────────────────────────────

describe("npm _authToken rule", () => {
  it("detects _authToken = value", () => {
    const content = "_authToken=npm_abcdefghijklmnopqrstuvwxyz0123456789";
    expect(hasSecret(content)).toBe(true);
    expect(rulesOf(content)).toContain("npm-auth-token");
    const f = scanForSecrets(content).find((x) => x.rule === "npm-auth-token");
    expect(f).toBeDefined();
    expect(noRawSecret(f!, "npm_abcdefghijklmnopqrstuvwxyz0123456789")).toBe(true);
  });

  it("detects _authToken with spaces around =", () => {
    const content = "_authToken =  some-secret-token-value-12345";
    expect(hasSecret(content)).toBe(true);
    expect(rulesOf(content)).toContain("npm-auth-token");
  });
});

// ── generic key/secret/token/password ────────────────────────────────────────

describe("generic credential rule", () => {
  const samples: string[] = [
    "api_key=abcdefghijklmnopqrstuvwxyz0123456",
    "API_KEY=abcdefghijklmnopqrstuvwxyz0123456",
    "secret=abcdefghijklmnopqrstuvwxyz0123456",
    "token: 'abcdefghijklmnopqrstuvwxyz0123456'",
    "passwd: abcdefghijklmnopqrstuvwxyz0123456",
    "password=abcdefghijklmnopqrstuvwxyz0123456",
    "api-key=abcdefghijklmnopqrstuvwxyz0123456",
  ];

  for (const sample of samples) {
    it(`detects: ${sample.slice(0, 20)}...`, () => {
      expect(hasSecret(sample)).toBe(true);
      expect(rulesOf(sample)).toContain("generic-credential");
      const f = scanForSecrets(sample).find((x) => x.rule === "generic-credential");
      expect(f).toBeDefined();
      // raw value must not appear literally in redactedSample
      const value = sample.split(/[:=]\s*['"]?/)[1]?.replace(/['"]$/, "") ?? "";
      if (value.length >= 16) {
        expect(noRawSecret(f!, value)).toBe(true);
      }
    });
  }

  it("does not fire for values shorter than 16 chars", () => {
    expect(rulesOf("api_key=tooshort")).not.toContain("generic-credential");
  });
});

// ── clean content ─────────────────────────────────────────────────────────────

describe("clean content", () => {
  const cleanSamples: string[] = [
    'export PATH="$HOME/.local/bin:$PATH"',
    "alias ll='ls -la'",
    "alias gs='git status'",
    "# just a comment with no secrets",
    "HISTFILE=~/.zsh_history",
    "setopt APPEND_HISTORY",
    'PS1="%~ $ "',
    "source ~/.zplug/init.zsh",
    "zplug load",
  ];

  for (const sample of cleanSamples) {
    it(`no findings for: ${sample.slice(0, 40)}`, () => {
      expect(hasSecret(sample)).toBe(false);
      expect(scanForSecrets(sample)).toHaveLength(0);
    });
  }
});

// ── assertNoPlaintextSecrets ──────────────────────────────────────────────────

describe("assertNoPlaintextSecrets", () => {
  it("passes silently for clean files", () => {
    expect(() =>
      assertNoPlaintextSecrets([
        { path: "/home/user/.zshrc", content: 'export PATH="$HOME/.local/bin:$PATH"' },
        { path: "/home/user/.vimrc", content: "set number\nset tabstop=2" },
      ]),
    ).not.toThrow();
  });

  it("throws for a file containing an AWS key", () => {
    const awsKey = "AKIAIOSFODNN7EXAMPLE";
    expect(() =>
      assertNoPlaintextSecrets([
        { path: "/home/user/.env", content: `AWS_ACCESS_KEY_ID=${awsKey}` },
      ]),
    ).toThrow();
  });

  it("thrown message contains the file path", () => {
    const filePath = "/home/user/.env";
    let thrown: Error | undefined;
    try {
      assertNoPlaintextSecrets([{ path: filePath, content: "AKIAIOSFODNN7EXAMPLE" }]);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).toBeDefined();
    expect(thrown!.message).toContain(filePath);
  });

  it("thrown message contains the rule name", () => {
    let thrown: Error | undefined;
    try {
      assertNoPlaintextSecrets([{ path: "/tmp/f", content: "AKIAIOSFODNN7EXAMPLE" }]);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown!.message).toContain("aws-access-key");
  });

  it("thrown message does NOT contain the raw secret value", () => {
    const awsKey = "AKIAIOSFODNN7EXAMPLE";
    let thrown: Error | undefined;
    try {
      assertNoPlaintextSecrets([{ path: "/tmp/f", content: awsKey }]);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown!.message).not.toContain(awsKey);
  });

  it("thrown message lists multiple offending files", () => {
    const path1 = "/home/user/.env";
    const path2 = "/home/user/.npmrc";
    let thrown: Error | undefined;
    try {
      assertNoPlaintextSecrets([
        { path: path1, content: "AKIAIOSFODNN7EXAMPLE" },
        { path: path2, content: "_authToken=npm_abcdefghijklmnopqrstuvwxyz0123456789" },
      ]);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown!.message).toContain(path1);
    expect(thrown!.message).toContain(path2);
  });

  it("does not throw for a mix of clean and dirty when all clean", () => {
    expect(() =>
      assertNoPlaintextSecrets([
        { path: "/tmp/clean1", content: "export FOO=bar" },
        { path: "/tmp/clean2", content: "# nothing here" },
      ]),
    ).not.toThrow();
  });
});

// ── app-config credential formats (XML <password>, JDBC URL) ─────────────────
// JetBrains/DataGrip and similar store DB creds in XML and JDBC URLs, which the
// key=value rules miss. (ADR-0007 H2)

describe("xml password element rule", () => {
  it("detects <password>value</password>", () => {
    const content = '<data-source><password>longsecretvalue12345</password></data-source>';
    expect(hasSecret(content)).toBe(true);
    expect(rulesOf(content)).toContain("xml-password");
  });

  it("detects <Password>...</Password> case-insensitively with attrs", () => {
    expect(rulesOf('<entry key="Password">s3cretValue12345</entry>')).toContain("xml-password");
  });

  it("does not raw-leak the secret in the sample", () => {
    const content = "<password>longsecretvalue12345</password>";
    const f = scanForSecrets(content).find((x) => x.rule === "xml-password");
    expect(noRawSecret(f!, "longsecretvalue12345")).toBe(true);
  });
});

describe("jdbc url credential rule", () => {
  it("detects jdbc://user:pass@host", () => {
    const content = 'url="jdbc:mysql://dbuser:S3cretP4ss@db.prod:3306/app"';
    expect(hasSecret(content)).toBe(true);
    expect(rulesOf(content)).toContain("jdbc-url-credential");
  });

  it("does not fire for a jdbc url without credentials", () => {
    expect(rulesOf('jdbc:postgresql://localhost:5432/app')).not.toContain("jdbc-url-credential");
  });
});
