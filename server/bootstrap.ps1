# Starts server\install.py under a Python that uv manages, on Windows (bootstrap.sh does the same
# on Linux and macOS). When this computer has no uv, a copy is fetched into readalong's own
# folder, where it changes nothing else. Run by setup.ps1, and by the plugin when "Install the
# voice" is pressed; the arguments are install.py's. Written for Windows PowerShell 5.1 and later.

$Root = Split-Path -Parent $PSScriptRoot
# The plugin's data folder in Claude Code's own, which Claude Code removes with the plugin.
$ClaudeDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $env:USERPROFILE '.claude' }
$HomeDir = if ($env:READALONG_HOME) { $env:READALONG_HOME } else { Join-Path $ClaudeDir 'plugins\data\readalong-readalong' }
$env:READALONG_HOME = $HomeDir
$Installer = Join-Path $Root 'server\install.py'
$Json = (' ' + ($args -join ' ') + ' ').Contains(' --progress json ')
$Uninstall = $args -contains '--uninstall'

# The texts below hold no quote or backslash, so they are JSON strings as they stand.
function Say($Text) {
  if ($Json) { [Console]::Out.WriteLine('{"step":"uv","text":"' + $Text + '"}') } else { [Console]::Out.WriteLine("`n==> $Text") }
}
function Fail($Text) {
  if ($Json) { [Console]::Out.WriteLine('{"step":"failed","error":"' + $Text + '"}') } else { [Console]::Error.WriteLine("`nSetup stopped: $Text") }
  exit 1
}

if ($Uninstall) {
  # Removing needs no uv: the install's own Python stops the voice, then the folder goes.
  $Py = Join-Path $HomeDir 'server\.venv\Scripts\python.exe'
  # A voice installed before it moved into the plugin's data folder has the Python where it was.
  $Former = Join-Path $env:LOCALAPPDATA 'readalong'
  if (-not (Test-Path $Py -PathType Leaf)) { $Py = Join-Path $Former 'server\.venv\Scripts\python.exe' }
  if (Test-Path $Py -PathType Leaf) { & $Py -I $Installer @args }
  elseif (-not ($args -contains '--voice-only')) {
    # No voice to run the installer with (an install that stopped early): the plugin is removed here.
    $Claude = Get-Command claude -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($Claude) { & $Claude.Source plugin uninstall readalong@readalong }
    else { [Console]::Out.WriteLine('The plugin was not removed; in Claude Code, run:  /plugin uninstall readalong') }
  }
  # Only a folder readalong made is removed, whatever READALONG_HOME points at.
  $IsOurs = @('readalong', 'readalong-readalong') -contains (Split-Path $HomeDir -Leaf) -or (Test-Path (Join-Path $HomeDir 'server\serve.py'))
  if ($IsOurs -and (Test-Path $HomeDir)) { Remove-Item -Recurse -Force $HomeDir -ErrorAction SilentlyContinue }
  if (Test-Path (Join-Path $Former 'server\serve.py')) { Remove-Item -Recurse -Force $Former -ErrorAction SilentlyContinue }
  exit 0
}

function Find-Uv {
  $candidates = @($env:READALONG_UV)
  $onPath = Get-Command uv -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($onPath) { $candidates += $onPath.Source }
  $candidates += (Join-Path $env:USERPROFILE '.local\bin\uv.exe')
  $candidates += (Join-Path $env:USERPROFILE '.cargo\bin\uv.exe')
  $candidates += (Join-Path $HomeDir 'bin\uv.exe')
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate -PathType Leaf)) { return $candidate }
  }
  return $null
}

$Uv = Find-Uv
if (-not $Uv) {
  Say 'Fetching uv, which installs Python and its packages'
  # Unmanaged: the two programs in that folder and nothing else, no change to the PATH, no receipt.
  $env:UV_UNMANAGED_INSTALL = Join-Path $HomeDir 'bin'
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $fetched = Invoke-RestMethod -UseBasicParsing 'https://astral.sh/uv/install.ps1'
    Invoke-Expression $fetched | Out-Null
  } catch {
    # Whether it worked is told by whether uv is there now.
  }
  $Uv = Find-Uv
  if (-not $Uv) { Fail 'uv could not be fetched; install it yourself (https://docs.astral.sh/uv/), then run this again' }
}

# Whichever uv runs, the Python it downloads and its cache go in readalong's folder, so removing
# the folder removes all the install made.
$env:UV_PYTHON_INSTALL_DIR = Join-Path $HomeDir 'python'
$env:UV_CACHE_DIR = Join-Path $HomeDir 'cache'

# The phonemizer ships no ARM build for Windows; the x86-64 Python runs there, emulated.
$Arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
$Python = if ($Arch -eq 'ARM64') { 'cpython-3.12-windows-x86_64-none' } else { '3.12' }

& $Uv run --no-project --python $Python $Installer --uv $Uv @args
exit $LASTEXITCODE
