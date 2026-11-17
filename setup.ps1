# readalong setup for Windows: installs the local voice and the Claude Code plugin, once.
# (Linux and macOS: setup.sh.)
#
#   powershell -ExecutionPolicy Bypass -File setup.ps1               install, or repair an install
#   powershell -ExecutionPolicy Bypass -File setup.ps1 --voice-only  install the voice only
#   powershell -ExecutionPolicy Bypass -File setup.ps1 --uninstall   remove the voice, the plugin and its marketplace
#
# What it does is in server\install.py. Nothing runs in the background afterwards: the plugin
# starts the voice when a Claude Code session starts, and the voice stops itself after 30 idle
# minutes.

$rest = @($args | Where-Object { $_ -ne '--voice-only' })
if ($args -notcontains '--voice-only') { $rest = @('--plugin') + $rest }
& (Join-Path $PSScriptRoot 'server\bootstrap.ps1') @rest
exit $LASTEXITCODE
