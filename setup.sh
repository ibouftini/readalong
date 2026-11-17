#!/bin/sh
# readalong setup for Linux and macOS: installs the local voice and the Claude Code plugin, once.
# (Windows: setup.ps1.)
#
#   sh setup.sh               install, or repair an install
#   sh setup.sh --voice-only  install the voice only (the plugin came from /plugin install)
#   sh setup.sh --uninstall   remove the voice, the plugin and its marketplace
#
# What it does, in server/install.py:
#   1. finds uv, or fetches a copy into readalong's own folder
#   2. installs the speech service, with the exact Python and packages in server/uv.lock,
#      into the plugin's data folder, ~/.claude/plugins/data/readalong-readalong (or
#      $READALONG_HOME), which Claude Code removes when the plugin is uninstalled
#   3. downloads the Kokoro-82M model once and checks its SHA-256
#   4. says a test sentence, so you hear that it works, then stops the voice again
#   5. installs the readalong plugin into Claude Code
#
# It says all this before it starts. uv's Python and cache go in the same folder, so removing the
# folder removes everything. Nothing runs in the background afterwards: the plugin starts the
# voice when a Claude Code session starts (about two seconds), and the voice stops a minute after
# the last session closes.
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

plugin=--plugin
count=$#
for arg in "$@"; do
  if [ "$arg" = --voice-only ]; then plugin=""; else set -- "$@" "$arg"; fi
done
shift "$count"

exec sh "$HERE/server/bootstrap.sh" $plugin "$@"
