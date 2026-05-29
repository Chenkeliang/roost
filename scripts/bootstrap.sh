#!/usr/bin/env bash
# bootstrap.sh — idempotent fresh-machine setup for Roost.
# Run once on a brand-new follower Mac before Node/npm exist.
set -euo pipefail

# ---------------------------------------------------------------------------
# 1. Homebrew
# ---------------------------------------------------------------------------
if ! command -v brew >/dev/null 2>&1; then
  echo "[bootstrap] Installing Homebrew…"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
else
  echo "[bootstrap] Homebrew already installed: $(brew --version | head -1)"
fi

# ---------------------------------------------------------------------------
# 2. Core tools (idempotent — brew install is a no-op when already present)
# ---------------------------------------------------------------------------
echo "[bootstrap] Installing/verifying: chezmoi age node mise git"
brew install chezmoi age node mise git

# ---------------------------------------------------------------------------
# 3. Age key
# ---------------------------------------------------------------------------
AGE_KEY_DIR="${HOME}/.config/sops/age"
AGE_KEY_FILE="${AGE_KEY_DIR}/keys.txt"

mkdir -p "${AGE_KEY_DIR}"

if [[ ! -f "${AGE_KEY_FILE}" ]]; then
  if command -v op >/dev/null 2>&1 && [[ -n "${ROOST_AGE_OP_REF:-}" ]]; then
    echo "[bootstrap] Pulling age key from 1Password…"
    op read "${ROOST_AGE_OP_REF}" >"${AGE_KEY_FILE}"
  elif command -v rbw >/dev/null 2>&1 && [[ -n "${ROOST_AGE_RBW_REF:-}" ]]; then
    echo "[bootstrap] Pulling age key from rbw…"
    rbw get "${ROOST_AGE_RBW_REF}" >"${AGE_KEY_FILE}"
  else
    echo "[bootstrap] Generating new age key (no 1Password/rbw ref set)…"
    age-keygen -o "${AGE_KEY_FILE}"
  fi
  chmod 600 "${AGE_KEY_FILE}"
  echo "[bootstrap] Age key ready at ${AGE_KEY_FILE}"
else
  echo "[bootstrap] Age key already present at ${AGE_KEY_FILE}"
  chmod 600 "${AGE_KEY_FILE}"
fi

# ---------------------------------------------------------------------------
# 4. Config repo
# ---------------------------------------------------------------------------
REPO="${ROOST_REPO:-${HOME}/.local/share/chezmoi}"

if [[ ! -d "${REPO}/.git" ]]; then
  if [[ -n "${ROOST_REPO_URL:-}" ]]; then
    echo "[bootstrap] Cloning config repo from ${ROOST_REPO_URL}…"
    git clone "${ROOST_REPO_URL}" "${REPO}"
  else
    echo "[bootstrap] ROOST_REPO_URL not set; skipping repo clone."
  fi
else
  echo "[bootstrap] Config repo already present at ${REPO}"
fi

# ---------------------------------------------------------------------------
# 5. Load dotfiles via Roost
# ---------------------------------------------------------------------------
if command -v npx >/dev/null 2>&1; then
  echo "[bootstrap] Running: npx --yes roost load --apply"
  npx --yes roost load --apply || echo "[bootstrap] Warning: 'roost load --apply' exited non-zero; run manually to investigate."
else
  echo "[bootstrap] npx not yet available. Run the following command once Node is on PATH:"
  echo "    npx --yes roost load --apply"
fi

echo "[bootstrap] Done."
