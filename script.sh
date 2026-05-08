#!/usr/bin/env bash
set -euo pipefail

# Command example - to be run in public safe forks:
# ./script.sh --network shared --gateway https://gateway.stage.safe.protofire.io

# Config
REPO_DIR="${REPO_DIR:-$(pwd)}"
BASE_TAG="v1.83.3"
NETWORK="keyword"  # default, override with --network <name>
GATEWAY=""         # required, set with --gateway <url>

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --network)
      NETWORK="$2"
      shift 2
      ;;
    --network=*)
      NETWORK="${1#*=}"
      shift
      ;;
    --gateway)
      GATEWAY="$2"
      shift 2
      ;;
    --gateway=*)
      GATEWAY="${1#*=}"
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: $0 --network <name> --gateway <url>" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$NETWORK" ]]; then
  echo "Error: --network value cannot be empty" >&2
  exit 1
fi

if [[ -z "$GATEWAY" ]]; then
  echo "Error: --gateway <url> is required" >&2
  echo "Usage: $0 --network <name> --gateway <url>" >&2
  exit 1
fi

LOCAL_BRANCH="${NETWORK}-staging"
REMOTE_NAME="upstream-staging"
REMOTE_URL="https://github.com/protofire/private-safe-wallet-monorepo.git"
REMOTE_BRANCH="staging"
TEMP_BRANCH="remote-staging"
APP_DIR="apps/web"
ENV_PATH=".env"
GITIGNORE_ENTRY="script.sh"
COMMIT_MSG="feat(network-config): add $NETWORK network configuration"

# Cleanup config
DEPS_TO_REMOVE=("safe-network-config")
SCRIPTS_TO_REMOVE=("prebuild" "localhost:config-update")

echo "==> Network: $NETWORK"
echo "==> Gateway: $GATEWAY"
echo "==> Branch:  $LOCAL_BRANCH"

cd "$REPO_DIR"

# Sanity check: clean working tree
if ! git diff-index --quiet HEAD --; then
  echo "Working tree is dirty. Commit or stash changes first." >&2
  exit 1
fi

# 1. Checkout base tag and create <network>-staging
echo "==> Creating $LOCAL_BRANCH from $BASE_TAG"
git fetch --tags
git checkout "$BASE_TAG"
git branch -D "$LOCAL_BRANCH" 2>/dev/null || true
git checkout -b "$LOCAL_BRANCH"

# 2. Add remote, fetch staging, create remote-staging branch
echo "==> Fetching $REMOTE_BRANCH from $REMOTE_URL"
if git remote get-url "$REMOTE_NAME" >/dev/null 2>&1; then
  git remote set-url "$REMOTE_NAME" "$REMOTE_URL"
else
  git remote add "$REMOTE_NAME" "$REMOTE_URL"
fi
git fetch "$REMOTE_NAME" "$REMOTE_BRANCH"

git branch -D "$TEMP_BRANCH" 2>/dev/null || true
git checkout -b "$TEMP_BRANCH" "$REMOTE_NAME/$REMOTE_BRANCH"

# 3. cd into apps/web, install, run config-update, create .env, run prebuild scripts
echo "==> Entering $APP_DIR"
pushd "$APP_DIR" > /dev/null

echo "==> Running yarn install in $APP_DIR"
yarn install

echo "==> Running yarn localhost:config-update"
yarn localhost:config-update

echo "==> Creating $APP_DIR/$ENV_PATH"
cat > "$ENV_PATH" <<EOF
TEMPLATE_ID=$NETWORK
NEXT_PUBLIC_DEFAULT_TESTNET_CHAIN_ID=1
NEXT_PUBLIC_GATEWAY_URL_STAGING=$GATEWAY
EOF

echo "==> Running scripts/prebuild-config.js --network $NETWORK"
node scripts/prebuild-config.js --network "$NETWORK"

echo "==> Running scripts/prebuild-patch.js"
node scripts/prebuild-patch.js

# 3a. Delete all prebuild*.js scripts
echo "==> Deleting prebuild*.js scripts"
rm -f scripts/prebuild*.js

# 3b. Remove dependencies via yarn
echo "==> Removing dependencies: ${DEPS_TO_REMOVE[*]}"
for dep in "${DEPS_TO_REMOVE[@]}"; do
  if yarn remove "$dep"; then
    echo "    removed $dep"
  else
    echo "    $dep not installed, skipping"
  fi
done

# 3c. Remove scripts from apps/web/package.json
echo "==> Removing scripts from $APP_DIR/package.json: ${SCRIPTS_TO_REMOVE[*]}"
SCRIPTS_JSON=$(printf '%s\n' "${SCRIPTS_TO_REMOVE[@]}" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(JSON.stringify(d.trim().split("\n"))))')
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const toRemove = $SCRIPTS_JSON;
  if (pkg.scripts) {
    for (const key of toRemove) {
      if (key in pkg.scripts) { delete pkg.scripts[key]; console.log('    removed script:', key); }
      else { console.log('    script not found, skipping:', key); }
    }
  }
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

popd > /dev/null

# 4. Ensure script.sh is in .gitignore
echo "==> Ensuring $GITIGNORE_ENTRY is in .gitignore"
touch .gitignore
if ! grep -qxF "$GITIGNORE_ENTRY" .gitignore; then
  [ -s .gitignore ] && [ "$(tail -c1 .gitignore)" != "" ] && echo "" >> .gitignore
  echo "$GITIGNORE_ENTRY" >> .gitignore
fi

# 5. Stage everything onto remote-staging
git add -A
git commit -m "$COMMIT_MSG" --allow-empty

# 6. Merge remote-staging into <network>-staging
echo "==> Merging $TEMP_BRANCH into $LOCAL_BRANCH"
git checkout "$LOCAL_BRANCH"
git merge --no-ff "$TEMP_BRANCH" -m "chore: merge $TEMP_BRANCH into $LOCAL_BRANCH"

# 7. Squash everything on <network>-staging since $BASE_TAG into one commit
echo "==> Squashing into single commit"
git reset --soft "$BASE_TAG"
git commit -m "$COMMIT_MSG"

# Cleanup
git branch -D "$TEMP_BRANCH" 2>/dev/null || true

echo "==> Done. $LOCAL_BRANCH now has one commit ('$COMMIT_MSG') on top of $BASE_TAG."