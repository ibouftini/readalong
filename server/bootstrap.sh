#!/bin/sh
# Starts server/install.py under a Python that uv manages, on Linux and macOS (bootstrap.ps1 does
# the same on Windows). When this computer has no uv, a copy is fetched into readalong's own
# folder, where it changes nothing else. Run by setup.sh, and by the plugin when "Install the
# voice" is pressed; the arguments are install.py's.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
# The plugin's data folder in Claude Code's own, which Claude Code removes with the plugin.
HOME_DIR=${READALONG_HOME:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/data/readalong-readalong}
export READALONG_HOME="$HOME_DIR"

json=""
uninstall=""
case " $* " in *" --progress json "*) json=1 ;; esac
case " $* " in *" --uninstall "*) uninstall=1 ;; esac

# The texts below hold no quote or backslash, so they are JSON strings as they stand.
say() { if [ -n "$json" ]; then printf '{"step":"uv","text":"%s"}\n' "$1"; else printf '\n==> %s\n' "$1"; fi; }
fail() {
  if [ -n "$json" ]; then printf '{"step":"failed","error":"%s"}\n' "$1"; else printf '\nSetup stopped: %s\n' "$1" >&2; fi
  exit 1
}

if [ -n "$uninstall" ]; then
  # Removing needs no uv: the install's own Python stops the voice, then the folder goes.
  PY="$HOME_DIR/server/.venv/bin/python"
  # A voice installed before it moved into the plugin's data folder has the Python where it was.
  [ -x "$PY" ] || PY="${XDG_DATA_HOME:-$HOME/.local/share}/readalong/server/.venv/bin/python"
  [ -x "$PY" ] || PY=$(command -v python3 2>/dev/null || true)
  if [ -n "$PY" ]; then "$PY" -I "$ROOT/server/install.py" "$@" || true; fi
  # Only a folder readalong made is removed, whatever READALONG_HOME points at.
  case "$(basename "$HOME_DIR")" in readalong | readalong-readalong) rm -rf "$HOME_DIR" ;; esac
  if [ -e "$HOME_DIR/server/serve.py" ]; then rm -rf "$HOME_DIR"; fi
  exit 0
fi

find_uv() {
  for candidate in "${READALONG_UV:-}" "$(command -v uv 2>/dev/null || true)" "$HOME/.local/bin/uv" "$HOME/.cargo/bin/uv" \
    "$HOME_DIR/bin/uv" /opt/homebrew/bin/uv /usr/local/bin/uv; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

if ! UV=$(find_uv); then
  say "Fetching uv, which installs Python and its packages"
  mkdir -p "$HOME_DIR/bin"
  # Unmanaged: the two programs in that folder and nothing else, no line in a shell profile, no receipt.
  if command -v curl >/dev/null 2>&1; then
    curl -LsSf https://astral.sh/uv/install.sh | env UV_UNMANAGED_INSTALL="$HOME_DIR/bin" sh >&2 || true
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- https://astral.sh/uv/install.sh | env UV_UNMANAGED_INSTALL="$HOME_DIR/bin" sh >&2 || true
  else
    fail "curl or wget is needed to fetch uv; install one of them, or uv itself (https://docs.astral.sh/uv/), then run this again"
  fi
  UV=$(find_uv) || fail "uv could not be fetched; install it yourself (https://docs.astral.sh/uv/), then run this again"
fi

# Whichever uv runs, the Python it downloads and its cache go in readalong's folder, so removing
# the folder removes all the install made.
export UV_PYTHON_INSTALL_DIR="$HOME_DIR/python"
export UV_CACHE_DIR="$HOME_DIR/cache"

exec "$UV" run --no-project --python 3.12 "$ROOT/server/install.py" --uv "$UV" "$@"
