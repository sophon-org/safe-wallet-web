#!/usr/bin/env bash
# Roll out a network's safe-network-config configuration into a public Safe
# wallet fork's <network>-staging branch. Mirrors scripts/script.sh from
# safe-network-config but with all the rollout-time patches baked in.
#
# Required arguments:
#   --network <id>          short network id, must match networks/<id>/ in safe-network-config
#   --gateway <url>          NEXT_PUBLIC_GATEWAY_URL_STAGING for this network
#   --repo-dir <path>        absolute path to a clean clone of the wallet fork
#
# Optional arguments:
#   --base-tag <tag>         default v1.83.3 — upstream Safe wallet tag to base the rollout on
#   --upstream-url <url>     default git@github.com:safe-global/safe-wallet-monorepo.git
#   --remote-staging-url <url>
#                            default git@github.com:protofire/private-safe-wallet-monorepo.git
#   --remote-staging-branch <branch>
#                            default staging
#   --snc-branch <branch>    if set, pin localhost:config-update to this safe-network-config branch
#                            (use until the network branch is merged to safe-network-config@main)
#   --testnet-chain-id <id>  default 1 (used for NEXT_PUBLIC_DEFAULT_TESTNET_CHAIN_ID)
#
# See references/rollout-patches.md for what each step does and why.
set -euo pipefail

NETWORK=""
GATEWAY=""
REPO_DIR=""
BASE_TAG="v1.83.3"
UPSTREAM_URL="git@github.com:safe-global/safe-wallet-monorepo.git"
REMOTE_STAGING_URL="git@github.com:protofire/private-safe-wallet-monorepo.git"
REMOTE_STAGING_BRANCH="staging"
SNC_BRANCH=""
TESTNET_CHAIN_ID="1"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --network)                      NETWORK="$2"; shift 2 ;;
    --network=*)                    NETWORK="${1#*=}"; shift ;;
    --gateway)                      GATEWAY="$2"; shift 2 ;;
    --gateway=*)                    GATEWAY="${1#*=}"; shift ;;
    --repo-dir)                     REPO_DIR="$2"; shift 2 ;;
    --repo-dir=*)                   REPO_DIR="${1#*=}"; shift ;;
    --base-tag)                     BASE_TAG="$2"; shift 2 ;;
    --base-tag=*)                   BASE_TAG="${1#*=}"; shift ;;
    --upstream-url)                 UPSTREAM_URL="$2"; shift 2 ;;
    --upstream-url=*)               UPSTREAM_URL="${1#*=}"; shift ;;
    --remote-staging-url)           REMOTE_STAGING_URL="$2"; shift 2 ;;
    --remote-staging-url=*)         REMOTE_STAGING_URL="${1#*=}"; shift ;;
    --remote-staging-branch)        REMOTE_STAGING_BRANCH="$2"; shift 2 ;;
    --remote-staging-branch=*)      REMOTE_STAGING_BRANCH="${1#*=}"; shift ;;
    --snc-branch)                   SNC_BRANCH="$2"; shift 2 ;;
    --snc-branch=*)                 SNC_BRANCH="${1#*=}"; shift ;;
    --testnet-chain-id)             TESTNET_CHAIN_ID="$2"; shift 2 ;;
    --testnet-chain-id=*)           TESTNET_CHAIN_ID="${1#*=}"; shift ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

for v in NETWORK GATEWAY REPO_DIR; do
  if [[ -z "${!v}" ]]; then echo "--${v,,} (required) not provided" >&2; exit 1; fi
done
[[ -d "$REPO_DIR/.git" ]] || { echo "$REPO_DIR is not a git clone" >&2; exit 1; }

LOCAL_BRANCH="${NETWORK}-staging"
TEMP_BRANCH="remote-staging"
APP_DIR="apps/web"
COMMIT_MSG="feat(network-config): add $NETWORK network configuration"

cd "$REPO_DIR"

# Sanity: clean working tree
if ! git diff-index --quiet HEAD --; then
  echo "Working tree is dirty in $REPO_DIR — commit or stash first." >&2
  exit 1
fi

echo "==> [0/8] Add 'upstream' = $UPSTREAM_URL, fetch tag $BASE_TAG"
if git remote get-url upstream >/dev/null 2>&1; then
  git remote set-url upstream "$UPSTREAM_URL"
else
  git remote add upstream "$UPSTREAM_URL"
fi
git fetch --quiet upstream "refs/tags/$BASE_TAG:refs/tags/$BASE_TAG"

echo "==> [1/8] Create $LOCAL_BRANCH from $BASE_TAG"
git checkout --quiet "$BASE_TAG"
git branch -D "$LOCAL_BRANCH" 2>/dev/null || true
git checkout -b "$LOCAL_BRANCH"

echo "==> [2/8] Add 'upstream-staging' = $REMOTE_STAGING_URL, create $TEMP_BRANCH"
if git remote get-url upstream-staging >/dev/null 2>&1; then
  git remote set-url upstream-staging "$REMOTE_STAGING_URL"
else
  git remote add upstream-staging "$REMOTE_STAGING_URL"
fi
git fetch --quiet upstream-staging "$REMOTE_STAGING_BRANCH"
git branch -D "$TEMP_BRANCH" 2>/dev/null || true
git checkout -b "$TEMP_BRANCH" "upstream-staging/$REMOTE_STAGING_BRANCH"

# --- patch A: pin safe-network-config branch (only if --snc-branch given) ---
if [[ -n "$SNC_BRANCH" ]]; then
  echo "==> [3/8] Pin localhost:config-update to safe-network-config#$SNC_BRANCH"
  node -e "
    const fs=require('fs');
    const p='$APP_DIR/package.json';
    const pkg=JSON.parse(fs.readFileSync(p,'utf8'));
    const before=pkg.scripts['localhost:config-update'];
    pkg.scripts['localhost:config-update']=before.replace(
      'safe-network-config.git',
      'safe-network-config.git#$SNC_BRANCH'
    );
    fs.writeFileSync(p, JSON.stringify(pkg,null,2)+'\n');
  "
fi

# --- patch B: dash-compatible husky hooks ---
echo "==> [3/8] Patch .husky/{pre-commit,commit-msg,pre-push}: dash-compat"
for h in .husky/pre-commit .husky/commit-msg .husky/pre-push; do
  if [[ -f "$h" ]] && grep -q 'set -euo pipefail' "$h"; then
    sed -i '' 's/set -euo pipefail/set -eu/' "$h"
    echo "    patched: $h"
  fi
done

pushd "$APP_DIR" > /dev/null

echo "==> [4/8] yarn install"
yarn install 2>&1 | tail -3

echo "==> [4/8] yarn localhost:config-update"
yarn localhost:config-update 2>&1 | tail -5

echo "==> [4/8] verify networks/$NETWORK is present (yarn 4 hoists to root)"
test -d "$REPO_DIR/node_modules/safe-network-config/networks/$NETWORK" \
  && echo "    OK" \
  || { echo "    FAIL: networks/$NETWORK not in installed safe-network-config" >&2; exit 1; }

echo "==> [4/8] write apps/web/.env"
cat > .env <<EOF
TEMPLATE_ID=$NETWORK
NEXT_PUBLIC_DEFAULT_TESTNET_CHAIN_ID=$TESTNET_CHAIN_ID
NEXT_PUBLIC_GATEWAY_URL_STAGING=$GATEWAY
EOF

echo "==> [5/8] run prebuild-config.js + prebuild-patch.js"
node scripts/prebuild-config.js --network "$NETWORK" 2>&1 | tail -10
node scripts/prebuild-patch.js 2>&1 | tail -10

echo "==> [5/8] delete prebuild*.js"
rm -f scripts/prebuild*.js

echo "==> [5/8] yarn remove safe-network-config (best-effort)"
yarn remove safe-network-config 2>&1 | tail -3 || echo "    (yarn remove failed — fix-empty-patch.sh after the rollout)"

echo "==> [5/8] strip prebuild + localhost:config-update from apps/web/package.json"
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  for (const k of ['prebuild', 'localhost:config-update']) delete (pkg.scripts||{})[k];
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"
popd > /dev/null

echo "==> [6/8] commit on $TEMP_BRANCH"
git add -A
git -c commit.gpgsign=false commit -m "$COMMIT_MSG" --allow-empty 2>&1 | tail -3

echo "==> [7/8] merge $TEMP_BRANCH into $LOCAL_BRANCH"
git checkout "$LOCAL_BRANCH"
git -c commit.gpgsign=false merge --no-ff "$TEMP_BRANCH" -m "chore: merge $TEMP_BRANCH into $LOCAL_BRANCH" 2>&1 | tail -3

echo "==> [8/8] squash to single commit on top of $BASE_TAG"
git reset --soft "$BASE_TAG"
git -c commit.gpgsign=false commit -m "$COMMIT_MSG" 2>&1 | tail -3
git branch -D "$TEMP_BRANCH" 2>/dev/null || true

echo
echo "==> DONE. $LOCAL_BRANCH at:"
git --no-pager log --oneline -1 "$LOCAL_BRANCH"
echo
echo "==> NEXT STEPS"
echo "    1. Run scripts/cleanup-empty-patch.sh in this clone to fix any 0-byte yarn patches"
echo "    2. Run scripts/ci-verify.sh to mirror CodeBuild's checks (yarn install --immutable + build)"
echo "    3. Push: git push origin $LOCAL_BRANCH"
