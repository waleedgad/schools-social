#!/usr/bin/env bash
# One command for the face test on the school's own photos.
#   desktop/bench/real-faces/face-test.sh "<test folder>"
# Sets up what it needs the first time (the app's code, AuraFace), then runs
# run.mjs. Everything stays on this computer; see docs/face-test-guide.md.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
desktop="$(cd "$here/../.." && pwd)"
folder="${1:-}"
if [ -z "$folder" ] || [ ! -d "$folder" ]; then
  echo "Usage: $0 \"<test folder>\"   (the folder with the class list and Students/)" >&2
  exit 2
fi
shift
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is needed (free): install the LTS version from https://nodejs.org, then run this again." >&2
  exit 2
fi
major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$major" -lt 20 ]; then
  echo "Node.js $major is too old: install the LTS version from https://nodejs.org (20 or newer)." >&2
  exit 2
fi
cd "$desktop"
export HUB_FACE_THREADS="${HUB_FACE_THREADS:-4}"
if [ ! -d node_modules/sharp ] || [ ! -d node_modules/onnxruntime-node ]; then
  echo "First run: getting the app's parts (a few minutes)..." >&2
  ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --no-audit --no-fund >&2
fi
if [ ! -f dist/core/faces.js ] || [ -n "$(find src/core -newer dist/core/faces.js -name '*.ts' -print -quit)" ]; then
  echo "Building the app's face code..." >&2
  npx tsc -p . >&2
fi
# AuraFace (Apache 2.0, free for commercial use): the installed app's copy
# if there is one, else downloaded once (about 250 MB) next to this script.
aura=""
for d in "$HOME/Library/Application Support/School Social Hub Library/models" "${APPDATA:-$HOME/AppData/Roaming}/School Social Hub Library/models" "$here/.models"; do
  if [ -s "$d/auraface_glintr100.onnx" ]; then aura="$d/auraface_glintr100.onnx"; break; fi
done
if [ -z "$aura" ]; then
  echo "Downloading AuraFace once (about 250 MB)..." >&2
  mkdir -p "$here/.models"
  curl -fL --progress-bar -o "$here/.models/auraface_glintr100.onnx.part" https://huggingface.co/fal/AuraFace-v1/resolve/main/glintr100.onnx
  mv "$here/.models/auraface_glintr100.onnx.part" "$here/.models/auraface_glintr100.onnx"
  aura="$here/.models/auraface_glintr100.onnx"
fi
exec node "$here/run.mjs" "$folder" --aura "$aura" "$@"
