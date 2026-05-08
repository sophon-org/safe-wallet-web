#!/usr/bin/env bash
# Remove the 0-byte yarn patches and broken resolution graph that
# prebuild-patch.js produces when a chain is already pre-registered in
# @safe-global/safe-deployments (or similar). These break CI's
# `yarn install --immutable` ("Unable to parse patch file: No changes found").
#
# Run this inside the wallet fork's clone, on the branch you intend to push.
#
# Usage:
#   cleanup-empty-patch.sh [--repo-dir <path>] [--commit]
#
# Without --commit, the script makes the working-tree edits and runs
# `yarn install` to refresh yarn.lock; you commit/squash yourself.
# With --commit, it adds + creates a fix commit on the current branch.
#
# See references/rollout-patches.md §3 for the full root cause.
set -euo pipefail

REPO_DIR="$PWD"
DO_COMMIT=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-dir)   REPO_DIR="$2"; shift 2 ;;
    --repo-dir=*) REPO_DIR="${1#*=}"; shift ;;
    --commit)     DO_COMMIT=1; shift ;;
    *)            echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

cd "$REPO_DIR"
[[ -d .yarn/patches ]] || { echo "$REPO_DIR has no .yarn/patches" >&2; exit 1; }

echo "==> find 0-byte patches in .yarn/patches/"
EMPTY_PATCHES=()
while IFS= read -r -d '' f; do
  EMPTY_PATCHES+=("$f")
done < <(find .yarn/patches -maxdepth 1 -type f -name '*.patch' -size 0 -print0)

if [[ ${#EMPTY_PATCHES[@]} -eq 0 ]]; then
  echo "    none — nothing to clean"
  exit 0
fi

for p in "${EMPTY_PATCHES[@]}"; do
  echo "    empty: $p"
  base=$(basename "$p")
  # Heuristic: the patch filename is `<scope>-<pkg>-npm-<version>-<hash>.patch`
  # extract package name = first chunk up to '-npm-'
  pkgkey="${base%%-npm-*}"
  # convert '@scope-name-pkg' → '@scope-name/pkg': replace LAST hyphen before pkg with /
  # e.g. @safe-global-safe-deployments → @safe-global/safe-deployments
  if [[ "$pkgkey" == @* ]]; then
    pkgname=$(echo "$pkgkey" | sed 's/\(.*\)-/\1\//')
  else
    pkgname="$pkgkey"
  fi
  # extract version
  rest="${base#*-npm-}"
  ver="${rest%-*.patch}"

  echo "      pkg=$pkgname  ver=$ver"

  echo "      revert dep refs in any package.json that points at this patch"
  while IFS= read -r json; do
    node -e "
      const fs=require('fs');
      const p='$json';
      const pkg=JSON.parse(fs.readFileSync(p,'utf8'));
      let changed=false;
      for (const sec of ['dependencies','devDependencies']) {
        if (pkg[sec] && typeof pkg[sec]['$pkgname']==='string' && pkg[sec]['$pkgname'].startsWith('patch:') && pkg[sec]['$pkgname'].includes('$base')) {
          pkg[sec]['$pkgname']='^$ver';
          console.log('        reverted', p, sec);
          changed=true;
        }
      }
      if (pkg.resolutions) {
        for (const k of Object.keys(pkg.resolutions)) {
          const v=pkg.resolutions[k];
          if (typeof v==='string' && v.includes('$base')) {
            delete pkg.resolutions[k];
            console.log('        dropped resolution', p, k);
            changed=true;
          }
        }
      }
      if (changed) fs.writeFileSync(p, JSON.stringify(pkg,null,2)+'\n');
    "
  done < <(grep -rln "$base" --include='package.json' . 2>/dev/null | grep -v node_modules)

  rm -f "$p"
  echo "      deleted: $p"
done

echo "==> yarn install (regenerate yarn.lock without the empty patches)"
yarn install 2>&1 | tail -3

echo "==> verify with yarn install --immutable"
yarn install --immutable 2>&1 | tail -3

if [[ "$DO_COMMIT" -eq 1 ]]; then
  echo "==> commit the cleanup"
  git add -A
  git -c commit.gpgsign=false commit -m "fix: remove broken empty yarn patches" 2>&1 | tail -3
else
  echo
  echo "Working tree updated. Stage + commit yourself, or re-run with --commit."
fi
