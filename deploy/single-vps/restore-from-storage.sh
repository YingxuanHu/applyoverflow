#!/usr/bin/env bash
# In-place restores are deliberately disabled: confirmations do not fence writers.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ $# != 1 || "$1" == latest || "$1" != *.dump ]]; then
  echo 'Usage: restore-from-storage.sh <exact-remote-object-key.dump>' >&2
  echo 'This now runs an isolated restore drill, never a live Compose database restore.' >&2
  exit 1
fi
exec bash "$SCRIPT_DIR/restore-drill.sh" "$1"
