#!/bin/sh
# Build and deploy to Cloudflare Pages using the instance config in
# private/wrangler.toml (a separate, private repo checked out at ./private).
#
# `wrangler pages deploy` has no --config flag and resolves paths relative to
# the config file, so the config is copied into place (./wrangler.toml is
# gitignored) rather than symlinked.
set -e
cd "$(dirname "$0")/.."

if [ -f private/wrangler.toml ]; then
  cp private/wrangler.toml wrangler.toml
elif [ ! -f wrangler.toml ]; then
  echo "No wrangler.toml: copy wrangler.example.toml to private/wrangler.toml and fill it in." >&2
  exit 1
fi

npm run build
# The pinned local wrangler, not `npx wrangler`: npx's shared cache broke once
# and silently skipped a scheduled job.
./node_modules/.bin/wrangler pages deploy
