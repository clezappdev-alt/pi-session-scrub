#!/usr/bin/env bash
# Strict typecheck gate (REQ-12). Zero repo dependencies: TypeScript and @types/node
# are pulled ephemerally by pnpm dlx; host types are resolved out of the pnpm store.
#
# Why this exists: the repo declares peerDependencies "*" and has no node_modules, so
# `tsc` over extensions/session-scrub/index.ts reports TS2307 for every host import.
# Those are environmental, not real type errors — but they make a raw tsc run useless
# as a gate. This resolves the host types by path instead, so the gate is meaningful.
#
# Requires: pnpm with its global store populated (it is, if Pi is installed).

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$REPO/extensions/session-scrub"

die() { printf 'typecheck: %s\n' "$1" >&2; exit "${2:-1}"; }

command -v pnpm >/dev/null 2>&1 || die "pnpm not found on PATH" 127

# pnpm's global virtual store: <pnpm home>/global/v11/<install-hash>/node_modules/.pnpm
PNPM_HOME="$(pnpm store path | sed 's|/store/.*||')"
GLOBAL_V11="$PNPM_HOME/global/v11"

[ -d "$GLOBAL_V11" ] || die "pnpm global store not found at $GLOBAL_V11
  It is created by installing a global package. If Pi is installed, it should be there."

# Locate the three host type packages by glob, newest install hash first.
pick() { ls -d "$GLOBAL_V11"/*/node_modules/.pnpm/$1 2>/dev/null | sort -V | tail -1; }

PI_TYPES="$(pick '@earendil-works+pi-coding-agent@*/node_modules/@earendil-works/pi-coding-agent/dist/index.d.ts')"
TYPEBOX="$(pick 'typebox@*/node_modules/typebox/build/index.d.mts')"
NODE_TYPES="$(pick '@types+node@*/node_modules/@types/node/package.json')"
NODE_TYPES="${NODE_TYPES%/package.json}"

# Name the package a variable stands for, so a failure says what was missing.
package_of() {
  case "$1" in
    PI_TYPES)    printf '@earendil-works/pi-coding-agent' ;;
    TYPEBOX)     printf 'typebox' ;;
    NODE_TYPES)  printf '@types/node' ;;
  esac
}

for v in PI_TYPES TYPEBOX NODE_TYPES; do
  if [ -z "${!v}" ]; then
    die "could not locate $(package_of "$v") types under $GLOBAL_V11
  Expected a path matching: $1
  Run once with network to populate the store: pnpm dlx --package=typescript tsc --version" 1
  fi
done

# Cover every module in the source directory rather than an explicit list. An explicit
# list silently stops checking new files, which is the failure mode this gate cannot
# afford: it would report success while skipping code.
mapfile -t TS_FILES < <(find "$SRC_DIR" -maxdepth 1 -type f -name '*.ts' | sort)
[ "${#TS_FILES[@]}" -gt 0 ] || die "no .ts files found in $SRC_DIR"

FILES_JSON=""
for f in "${TS_FILES[@]}"; do
  FILES_JSON+="    \"$f\""$'\n'
done
# Join with commas: a bare newline-separated list is not valid JSON and tsc reports
# TS1005 rather than naming the real cause.
FILES_JSON="${FILES_JSON%$'\n'}"
FILES_JSON="${FILES_JSON//$'\n'/,$'\n'}"

TMPDIR_CFG="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_CFG"' EXIT
CFG="$TMPDIR_CFG/tsconfig.json"

cat >"$CFG" <<EOF
{
  "compilerOptions": {
    "strict": true, "noEmit": true, "skipLibCheck": true, "noImplicitAny": true,
    "module": "nodenext", "moduleResolution": "nodenext", "target": "es2022",
    "allowImportingTsExtensions": true,
    "baseUrl": "$REPO",
    "paths": {
      "@earendil-works/pi-coding-agent": ["$PI_TYPES"],
      "typebox": ["$TYPEBOX"],
      "typebox/*": ["${TYPEBOX%.index.d.mts}*"]
    },
    "typeRoots": ["$NODE_TYPES/.."]
  },
  "files": [
$FILES_JSON
  ]
}
EOF

cd "$REPO"
exec pnpm dlx --package=typescript@5.7.3 tsc -p "$CFG"