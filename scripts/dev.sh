#!/bin/sh
# Dev-server wrapper: ensures the user-local Node install is on PATH.
export PATH="$HOME/.local/node/bin:$PATH"
cd "$(dirname "$0")/.."
# Instance config for the dev server (VITE_SYNC_ENDPOINT etc.) lives in the
# private repo; copy it into place if present.
[ -f private/.env.development.local ] && cp private/.env.development.local .env.development.local
exec npm run dev -- --port 5173 --strictPort
