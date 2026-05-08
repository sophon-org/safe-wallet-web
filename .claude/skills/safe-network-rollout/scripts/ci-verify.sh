#!/usr/bin/env bash
# Mirror the CodeBuild build step locally, so we know the rollout commit will
# survive CI before pushing.
#
# Order matters:
#   1. yarn install --immutable    (CI mode — fails on broken patches / lockfile drift)
#   2. type-check
#   3. lint
#   4. build  (runs `yarn fetch-chains && next build`; uses the .env we wrote)
#
# Usage:
#   ci-verify.sh [--repo-dir <path>]
#
# Exit code is the count of failed steps. 0 means CI-equivalent green.
set -uo pipefail

REPO_DIR="$PWD"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-dir)   REPO_DIR="$2"; shift 2 ;;
    --repo-dir=*) REPO_DIR="${1#*=}"; shift ;;
    *)            echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

cd "$REPO_DIR"

run_step() {
  local name=$1; shift
  echo
  echo "================================================================"
  echo "==> START: $name"
  echo "================================================================"
  if "$@"; then
    echo "==> PASS: $name"
    return 0
  else
    local rc=$?
    echo "==> FAIL: $name (exit $rc)"
    return $rc
  fi
}

run_step "yarn install --immutable (CI mode)" yarn install --immutable
II=$?

run_step "type-check" yarn workspace @safe-global/web type-check
TC=$?

run_step "lint"       yarn workspace @safe-global/web lint
LN=$?

run_step "build"      yarn workspace @safe-global/web build
BD=$?

echo
echo "================================================================"
echo "SUMMARY (CI-equivalent flow):"
printf "  %-22s %s\n" "install --immutable" "$([ $II -eq 0 ] && echo OK || echo FAIL)"
printf "  %-22s %s\n" "type-check"          "$([ $TC -eq 0 ] && echo OK || echo FAIL)"
printf "  %-22s %s\n" "lint"                "$([ $LN -eq 0 ] && echo OK || echo FAIL)"
printf "  %-22s %s\n" "build"               "$([ $BD -eq 0 ] && echo OK || echo FAIL)"
echo "================================================================"

exit $((II + TC + LN + BD))
