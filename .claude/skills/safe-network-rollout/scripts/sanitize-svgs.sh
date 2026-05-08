#!/usr/bin/env bash
# Sanitize freshly-imported brand SVGs for inline embedding in Safe Wallet.
# - Namespaces all generic linear-gradient* IDs to <network>-linear-gradient*
#   to avoid ID collisions with other inlined SVGs.
# - Optionally replaces gradient fills with a solid brand color (the gradient's
#   dark stop is invisible on the wallet's dark sidebar).
#
# Usage:
#   sanitize-svgs.sh --network <id> --dir <path-to-images-dir> [--brand-color <#hex>]
#
# Examples:
#   # only namespace gradient IDs
#   sanitize-svgs.sh --network mynet --dir networks/mynet/public/images
#
#   # also flatten gradients to solid color
#   sanitize-svgs.sh --network mynet --dir networks/mynet/public/images --brand-color "#38ff9c"
#
# See references/svg-pitfalls.md for the rationale.
set -euo pipefail

NETWORK=""
DIR=""
BRAND_COLOR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --network)        NETWORK="$2"; shift 2 ;;
    --network=*)      NETWORK="${1#*=}"; shift ;;
    --dir)            DIR="$2"; shift 2 ;;
    --dir=*)          DIR="${1#*=}"; shift ;;
    --brand-color)    BRAND_COLOR="$2"; shift 2 ;;
    --brand-color=*)  BRAND_COLOR="${1#*=}"; shift ;;
    *)                echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

[[ -z "$NETWORK" ]] && { echo "--network required" >&2; exit 1; }
[[ -z "$DIR" ]]     && { echo "--dir required"     >&2; exit 1; }
[[ -d "$DIR" ]]     || { echo "no such dir: $DIR"  >&2; exit 1; }

echo "==> sanitize SVGs in $DIR (network=$NETWORK)"
shopt -s nullglob
for f in "$DIR"/logo*.svg; do
  echo "    $f"
  # 1) namespace gradient IDs (substring-safe — 'linear-gradient' doesn't appear in path data)
  sed -i "s/linear-gradient/${NETWORK}-linear-gradient/g" "$f"

  # 2) optional: flatten gradient fills to solid brand color
  if [[ -n "$BRAND_COLOR" ]]; then
    sed -i -E "s|fill: url\\(#[^)]*\\)|fill: ${BRAND_COLOR}|g" "$f"
  fi
done

echo "==> verify"
if grep -nE 'fill: url\(#linear-gradient' "$DIR"/logo*.svg 2>/dev/null; then
  echo "  WARNING: leftover generic gradient refs above" >&2
  exit 2
fi

if [[ -n "$BRAND_COLOR" ]] && grep -lE 'fill: url\(' "$DIR"/logo*.svg 2>/dev/null | grep -E 'logo-text\.svg|^logo\.svg$|/logo\.svg'; then
  echo "  note: gradient fills remain in non-text logos (logo-no-text.svg/logo-round.svg) — that's usually fine"
fi

echo "==> done"
