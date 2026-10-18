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
# pnpm's global virtual store: <pnpm home>/global/v11/<install-hash>/node_modules/.pnpm
PNPM_HOME="$(pnpm store path | sed 's|/store/.*||')"
GLOBAL_V11="$PNPM_HOME/global/v11"

# Locate the three host type packages by glob, newest install first.
pick() { ls -d $GLOBAL_V11/*/node_modules/.pnpm/$1 2>/dev/null | sort -V | tail -1; }

PI_TYPES="$(pick '@earendil-works+pi-coding-agent@*/node_modules/@earendil-works/pi-coding-agent/dist/index.d.ts')"
TYPEBOX="$(pick 'typebox@*/node_modules/typebox/build/index.d.mts')"
NODE_TYPES="$(pick '@types+node@*/node_modules/@types/node/package.json')"
NODE_TYPES="${NODE_TYPES%/package.json}"

for v in PI_TYPES TYPEBOX NODE_TYPES; do
  if [ -z "${!v}" ]; then
    echo "typecheck: could not locate $v in the pnpm store under $STORE" >&2
    echo "  Run once with network: pnpm dlx --package=typescript tsc --version" >&2
    exit 1
  fi
done

CFG="$(mktemp -d)/tsconfig.json"
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
    "$REPO/extensions/session-scrub/index.ts",
    "$REPO/extensions/session-scrub/classify.ts",
    "$REPO/extensions/session-scrub/classify.test.ts",
    "$REPO/extensions/session-scrub/name.ts",
    "$REPO/extensions/session-scrub/name.test.ts"
  ]
}
EOF

cd "$REPO"
exec pnpm dlx --package=typescript@5.7.3 tsc -p "$CFG"
