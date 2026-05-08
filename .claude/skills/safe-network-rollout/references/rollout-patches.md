# Rollout-time patches and known issues

`scripts/script.sh` (in `safe-network-config`) drives the wallet-fork rollout. It works as-is for the *happy path*, but four classes of problems consistently bite. `scripts/rollout-wallet-fork.sh` in this skill bakes the fixes in; this reference explains *why* each is needed so you can debug variations.

## 1. Husky hooks reject `set -euo pipefail` under dash

Symptom — a commit step inside the rollout fails with:

```
.husky/pre-commit: 2: set: Illegal option -o pipefail
husky - pre-commit script failed (code 2)
```

Cause — Husky 9's `_/h` dispatcher invokes hooks via `sh -e "$hook"`, **ignoring the hook's `#!/bin/bash` shebang**. On systems where `/bin/sh` is dash (Debian/Ubuntu and most CI containers), `set -o pipefail` is rejected.

Fix — replace `set -euo pipefail` with `set -eu` in every affected hook. Behavior is identical for these hooks (they don't actually rely on pipefail).

```bash
for h in .husky/pre-commit .husky/commit-msg .husky/pre-push; do
  [ -f "$h" ] && sed -i 's/set -euo pipefail/set -eu/' "$h"
done
```

The fix lands in the squashed rollout commit alongside the network changes — that's fine; if a future husky upgrade ships a proper fix, just merge over it.

**Do not pass `--no-verify`.** Bypassing hooks looks easier but defeats the conventional-commit + lint-staged checks the wallet team relies on. Patch the hooks instead.

## 2. `safe-network-config` not yet on `main`

Symptom — `yarn localhost:config-update` installs from `https://github.com/protofire/safe-network-config.git` (default branch = main), then `prebuild-config.js --network <id>` fails because `node_modules/safe-network-config/networks/<id>/` doesn't exist.

Cause — your network branch hasn't been merged to `main` yet.

Fix — patch `apps/web/package.json` *before* running `yarn localhost:config-update` to pin the install to your feature branch:

```js
// node script
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('apps/web/package.json', 'utf8'));
pkg.scripts['localhost:config-update'] = pkg.scripts['localhost:config-update'].replace(
  'safe-network-config.git',
  'safe-network-config.git#feat/<network>-network'
);
fs.writeFileSync('apps/web/package.json', JSON.stringify(pkg, null, 2) + '\n');
```

The `&& git checkout ../../yarn.lock package.json` tail of the original script reverts package.json after the install, so this patch is consumed-and-forgotten — `yarn add` already populates `node_modules` from the branch by the time the revert runs.

After the network branch is merged to `main`, this patch is unnecessary for subsequent rollouts of the same network.

## 3. `prebuild-patch.js` produces a 0-byte patch when there's nothing to patch

Symptom — CI runs `yarn install --immutable` and fails:

```
Error: @safe-global/safe-deployments@patch:...: Unable to parse patch file: No changes found.
```

Cause — `prebuild-patch.js` calls `yarn patch <pkg>` to extract the package, modifies its JSON files to add the network's chain entries, then runs `yarn patch-commit`. **When the package already contains the chain entries** (you'll see `[PREBUILD-PATCH] <chainId> chain already exists, skipping writing` in the log), the temp dir has no diff and `yarn patch-commit` produces a 0-byte patch file — *plus* injects a `resolutions` entry pointing at it.

Local mutable `yarn install` tolerates this. CI's `yarn install --immutable` does not.

Fix after the rollout commit is made:

1. Delete `.yarn/patches/<pkg>-*.patch` files that are 0 bytes
2. Revert the corresponding `apps/web/package.json` and `apps/tx-builder/package.json` deps from `patch:...` to the plain version (`^X.Y.Z`)
3. Drop the matching `resolutions` entry from root `package.json`
4. Run `yarn install` to regenerate `yarn.lock` cleanly
5. Verify with `yarn install --immutable`

`scripts/cleanup-empty-patch.sh` handles all of this automatically.

The other patch (`@safe-global/safe-modules-deployments`) is usually non-empty — leave it alone.

## 4. Removing the `safe-network-config` dependency entirely

After `prebuild-config.js` and `prebuild-patch.js` have run, `safe-network-config` has done its job — icons are copied to `apps/web/public/`, the template config is generated to `apps/web/src/config/templateConfig.ts`, the deployment patches are applied. The dep no longer serves any purpose at build time.

**Per Safe team's deployment practice**, public forks should not retain `safe-network-config` in `package.json` after rollout — otherwise CI tries to fetch it and fails on missing SSH keys (`Permission denied (publickey)` for `protofire/safe-network-config.git`). The original `script.sh` runs `yarn remove safe-network-config` for this reason — but if pitfall #3 broke the resolution graph, the `yarn remove` silently failed and the dep stayed.

Always grep after the rollout to confirm:

```bash
grep -rn 'safe-network-config' --include='*.json' apps/ packages/ ./*.json yarn.lock | grep -v node_modules
# ideally: no output. Otherwise: edit those files and re-run yarn install.
```

## 5. Choosing the right base repo for the rollout

`scripts/script.sh` does `git checkout v1.83.3` after `git fetch --tags`. The base tag must exist in the clone:

| Repo | Has v1.83.3? |
| --- | --- |
| `safe-global/safe-wallet-monorepo` (canonical upstream) | Yes |
| `<network>com/safe-wallet-web` (public fork) | **No** — fork doesn't carry upstream tags by default |
| `protofire/private-safe-wallet-monorepo` | No |

The script must run in a *fork's* clone (so the resulting `<network>-staging` branch is on the fork), but the fork won't have `v1.83.3` until you add safe-global as a remote and fetch the tag:

```bash
git remote add upstream git@github.com:safe-global/safe-wallet-monorepo.git
git fetch upstream refs/tags/v1.83.3:refs/tags/v1.83.3
```

`scripts/rollout-wallet-fork.sh` does this in step 0.

## 6. Yarn 4 hoists deps to the workspace root

After `yarn install` in `apps/web`, `safe-network-config` is at `<repo>/node_modules/safe-network-config/`, **not** `<repo>/apps/web/node_modules/safe-network-config/`. Don't trust the original script's verify check — use the root path:

```bash
test -d node_modules/safe-network-config/networks/<id>
```

Node's module resolution still finds it from `apps/web/scripts/prebuild-config.js` because Node walks up the directory tree.
