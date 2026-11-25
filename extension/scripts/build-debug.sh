#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

cd "$REPO_DIR"

BROWSER_TARGET=${BROWSER_TARGET:-chrome}

case "$BROWSER_TARGET" in
  chrome|firefox) ;;
  *)
    printf 'Unsupported BROWSER_TARGET: %s\n' "$BROWSER_TARGET" >&2
    printf 'Please use chrome or firefox.\n' >&2
    exit 1
    ;;
esac

while :; do
  printf 'Enable user-input image export for the debug build? [y/n]: '
  IFS= read -r answer

  case "$answer" in
    y|Y|yes|YES)
      ENABLE_USER_INPUT_IMAGE_EXPORT=true
      IMAGE_EXPORT_LABEL=enabled
      break
      ;;
    n|N|no|NO)
      ENABLE_USER_INPUT_IMAGE_EXPORT=false
      IMAGE_EXPORT_LABEL=disabled
      break
      ;;
    *)
      printf 'Please answer y or n.\n'
      ;;
  esac
done

OUTPUT_DIR="dist/${BROWSER_TARGET}-debug"

printf '\nBuilding debug package...\n'
printf '  Browser target : %s\n' "$BROWSER_TARGET"
printf '  Image export   : %s\n' "$IMAGE_EXPORT_LABEL"
printf '  Output dir     : %s\n' "$OUTPUT_DIR"
printf '  Minification   : disabled\n'
printf '  Sourcemaps     : enabled\n\n'

BUILD_VARIANT=debug \
BROWSER_TARGET="$BROWSER_TARGET" \
ENABLE_USER_INPUT_IMAGE_EXPORT="$ENABLE_USER_INPUT_IMAGE_EXPORT" \
npm run build:bundle

printf '\nDebug build finished: %s\n' "$OUTPUT_DIR"
