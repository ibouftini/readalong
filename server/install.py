"""Installs, updates and removes the readalong voice, the same way on Linux, macOS and Windows.

    install.py                install the voice, or repair an install
    install.py --update       bring an install up to this plugin's files (quick; the plugin runs
                              it when a session starts, with the install's own Python)
    install.py --uninstall    stop the voice and remove its folder

    --home DIR        where the voice lives (default: $READALONG_HOME, else the plugin's data folder
                      in Claude Code's own, which Claude Code removes when the plugin is uninstalled)
    --uv PATH         the uv to install Python packages with (default: found on this computer)
    --progress json   one JSON object per line, for the plugin; `text` (default) is for people
    --no-model        skip the voice model: for use with a speech server of your own only
    --no-sound        do not play the test sentence
    --plugin          also install (or, with --uninstall, remove) the plugin in Claude Code

A full install is started by bootstrap.sh or bootstrap.ps1, which find or fetch uv and run this
file under a Python that uv manages. What it does, in order: copies the service into the folder,
installs the exact Python packages in uv.lock, downloads the Kokoro-82M model once and checks its
SHA-256, starts the service and has it say a sentence. Standard library only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shlex
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
IS_WINDOWS = os.name == 'nt'

# The model: Kokoro-82M v1.0 (Apache-2.0, hexgrad), as exported to ONNX by kokoro-onnx.
MODEL_FILE = 'kokoro-v1.0.onnx'
MODEL_URL = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx'
MODEL_SHA256 = '7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5'
MODEL_MB = 325

# What the install holds of this plugin's, as (the plugin's file, the install's).
CODE = [('server/serve.py', 'server/serve.py'), ('server/voices.npz', 'voices.npz'), ('assets/chime.wav', 'chime.wav')]
# The files that decide which Python and packages are installed.
PACKAGES = [
    ('server/pyproject.toml', 'server/pyproject.toml'),
    ('server/uv.lock', 'server/uv.lock'),
    ('server/.python-version', 'server/.python-version'),
]
# The plugin's data folder, as Claude Code names it: the plugin's name, then its marketplace's.
PLUGIN_DATA = 'readalong-readalong'
TEST_SENTENCE = 'Readalong is ready. Press play under any reply to hear it.'
LOCK_STALE_S = 30 * 60


class Stop(Exception):
    """The install cannot go on; the message says why, and what to do."""


class Out:
    """
    What the installer says: lines for a person, or one JSON object per line for the plugin.

    For a person in a terminal it numbers the steps, turns a spinner with a clock through a step
    that reports nothing of its own, and draws a download as a bar with its speed and the time
    left. Standard library only: drawing it needs nothing installed.
    """

    def __init__(self, is_json: bool) -> None:
        self.is_json = is_json
        self.is_plain = IS_WINDOWS or not sys.stdout.isatty() or bool(os.environ.get('NO_COLOR'))
        self.percent = -1
        # Called as a download goes on, to show the lock's holder is still at work.
        self.heartbeat: Any = None
        self.steps = 0
        self.at = 0
        self.started = time.monotonic()
        self.fetch_started = 0.0
        self.fetch_from = 0
        self.last_drawn = 0.0
        self.warnings = 0

    def _write(self, text: str) -> None:
        sys.stdout.write(text)
        sys.stdout.flush()

    def paint(self, code: str, text: str) -> str:
        return text if self.is_plain else f'\033[{code}m{text}\033[0m'

    def emit(self, step: str, text: str = '', **more: Any) -> None:
        if self.is_json:
            self._write(json.dumps({'step': step, 'text': text, **more}) + '\n')

    def step(self, step: str, text: str) -> None:
        self.percent = -1
        if self.is_json:
            return self.emit(step, text)
        self.at += 1
        count = f'[{self.at}/{self.steps}]' if self.steps else '==>'
        self._write(f'\n{self.paint("1;36", count)} {self.paint("1", text)}\n')

    def ok(self, text: str) -> None:
        if not self.is_json:
            self._write(f'      {self.paint("32", "ok" if self.is_plain else "✓")} {text}\n')

    def warn(self, text: str) -> None:
        self.warnings += 1
        if self.is_json:
            self.emit('warning', text)
        else:
            self._write(f'      {self.paint("33", "warning:" if self.is_plain else "!")} {text}\n')

    def note(self, text: str) -> None:
        if not self.is_json:
            self._write(f'      {text}\n')

    def working(self, text: str) -> Working:
        """A step's part that says nothing while it runs: a spinner and a clock beside `text`."""
        return Working(self, text)

    def progress(self, step: str, text: str, done: int, total: int) -> None:
        now = time.monotonic()
        if self.fetch_started == 0.0:
            self.fetch_started, self.fetch_from = now, done
        percent = int(done * 100 / total) if total > 0 else 0
        is_new = percent != self.percent
        if self.heartbeat is not None and is_new:
            self.heartbeat()
        if self.is_json:
            if is_new:
                self.percent = percent
                self.emit(step, text, percent=percent, done_mb=done >> 20, total_mb=total >> 20)
            return
        # Redrawn at most ten times a second, and at the end.
        if now - self.last_drawn < 0.1 and done < total:
            return
        if self.is_plain and (not is_new or percent % 10 != 0):
            self.percent = percent
            return
        self.percent, self.last_drawn = percent, now
        elapsed = now - self.fetch_started
        rate = (done - self.fetch_from) / elapsed if elapsed > 0.5 else 0.0
        left = f'{clock((total - done) / rate)} left' if rate > 0 and done < total else ''
        speed = f'{rate / (1 << 20):.1f} MB/s' if rate > 0 else ''
        figures = f'{percent:3d}%  {done >> 20} of {total >> 20} MB  {speed:>9}  {left}'.rstrip()
        if self.is_plain:
            self._write(f'      {figures}\n')
        else:
            filled = percent * 24 // 100
            bar = self.paint('36', '█' * filled) + self.paint('2', '░' * (24 - filled))
            self._write(f'\r\033[K      {bar} {figures}')

    def end_progress(self) -> None:
        if not self.is_json and not self.is_plain and self.percent >= 0:
            self._write('\n')
        self.fetch_started = 0.0


class Working:
    """A spinner and a clock while a quiet part of a step runs; a line saying how long it took after."""

    FRAMES = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'

    def __init__(self, out: Out, text: str) -> None:
        self.out, self.text = out, text
        self.done = threading.Event()
        self.thread: threading.Thread | None = None
        self.started = 0.0

    def __enter__(self) -> Working:
        self.started = time.monotonic()
        if self.out.is_json:
            return self
        if self.out.is_plain:
            self.out._write(f'      {self.text}...\n')
            return self
        self.thread = threading.Thread(target=self.spin, daemon=True)
        self.thread.start()
        return self

    def spin(self) -> None:
        frame = 0
        while not self.done.wait(0.1):
            spent = clock(time.monotonic() - self.started)
            self.out._write(f'\r\033[K      {self.out.paint("36", self.FRAMES[frame % len(self.FRAMES)])} {self.text}  {self.out.paint("2", spent)}')
            frame += 1
            if self.out.heartbeat is not None and frame % 50 == 0:
                self.out.heartbeat()

    def __exit__(self, *_: object) -> None:
        self.done.set()
        if self.thread is not None:
            self.thread.join()
            self.out._write('\r\033[K')


def clock(seconds: float) -> str:
    """Seconds as m:ss."""
    whole = max(0, int(seconds + 0.5))
    return f'{whole // 60}:{whole % 60:02d}'


# --------------------------------------------------------------------------------------------
# Where things are
# --------------------------------------------------------------------------------------------


def claude_folder() -> Path:
    """Claude Code's configuration folder."""
    return Path(os.environ.get('CLAUDE_CONFIG_DIR', '').strip() or Path.home() / '.claude')


def default_home() -> Path:
    """
    The folder the voice lives in; bootstrap.sh, bootstrap.ps1 and the plugin pick the same. It is
    the plugin's data folder, which Claude Code removes when the plugin is uninstalled: removing
    the plugin removes the voice with it.
    """
    given = os.environ.get('READALONG_HOME', '').strip()
    return Path(given) if given else claude_folder() / 'plugins' / 'data' / PLUGIN_DATA


def former_home() -> Path:
    """Where the voice lived before it moved into the plugin's data folder, which nothing removed."""
    if IS_WINDOWS:
        return Path(os.environ.get('LOCALAPPDATA') or Path.home() / 'AppData' / 'Local') / 'readalong'
    return Path(os.environ.get('XDG_DATA_HOME') or Path.home() / '.local' / 'share') / 'readalong'


def former_install(home: Path) -> Path | None:
    """The voice installed where it used to live, when there is one and `home` is not it."""
    former = former_home()
    is_other = former.resolve() != home.resolve()
    return former if is_other and (former / 'server' / 'serve.py').exists() else None


def is_ours(home: Path) -> bool:
    """Whether `home` is a folder readalong made, so that it may be removed whole."""
    return home.name in ('readalong', PLUGIN_DATA) or (home / 'server' / 'serve.py').exists()


def venv_python(home: Path) -> Path:
    venv = home / 'server' / '.venv'
    return venv / 'Scripts' / 'python.exe' if IS_WINDOWS else venv / 'bin' / 'python'


def find_uv(home: Path, given: str | None) -> str | None:
    exe = 'uv.exe' if IS_WINDOWS else 'uv'
    candidates = [
        given,
        os.environ.get('READALONG_UV'),
        shutil.which('uv'),
        str(Path.home() / '.local' / 'bin' / exe),
        str(Path.home() / '.cargo' / 'bin' / exe),
        str(home / 'bin' / exe),
        '/opt/homebrew/bin/uv',
        '/usr/local/bin/uv',
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file() and os.access(candidate, os.X_OK):
            return candidate
    return None


def uv_env(home: Path, uv: str) -> dict[str, str]:
    """
    The environment uv runs in. Whichever uv it is, readalong's own or one already on this
    computer, the Python it downloads and its cache go in readalong's folder, so removing the
    folder removes everything the install made: nothing is left in uv's shared folders.
    """
    env = dict(os.environ)
    env['UV_PYTHON_INSTALL_DIR'] = str(home / 'python')
    env['UV_CACHE_DIR'] = str(home / 'cache')
    # The phonemizer ships no ARM build for Windows, so the x86-64 Python runs there, emulated. It
    # is pinned on every Windows: under emulation this process is told it runs on AMD64, so it
    # cannot tell an ARM computer from an x86-64 one, and on x86-64 it is the Python uv picks anyway.
    if IS_WINDOWS:
        env.setdefault('UV_PYTHON', 'cpython-3.12-windows-x86_64-none')
    return env


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, 'rb') as src:
        while chunk := src.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def packages_stamp(base: Path, names: list[str]) -> str:
    """One hash of the files that decide the packages; '' when one is missing."""
    digest = hashlib.sha256()
    for name in names:
        try:
            digest.update((base / name).read_bytes())
        except OSError:
            return ''
        digest.update(b'\0')
    return digest.hexdigest()


def differs(src: Path, dst: Path) -> bool:
    try:
        return src.stat().st_size != dst.stat().st_size or sha256(src) != sha256(dst)
    except OSError:
        return True


def put(src: Path, dst: Path) -> None:
    """Copies a file into place whole: one that reads it meanwhile gets the old or the new, never half."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    part = dst.with_name(dst.name + '.part')
    shutil.copyfile(src, part)
    os.replace(part, dst)


def read_ready(home: Path) -> dict[str, Any]:
    try:
        said = json.loads((home / 'ready.json').read_text())
        return said if isinstance(said, dict) else {}
    except (OSError, ValueError):
        return {}


def service_version() -> str:
    for line in (ROOT / 'server' / 'serve.py').read_text(encoding='utf-8').splitlines():
        if line.startswith('VERSION = '):
            return line.split('=', 1)[1].strip().strip('\'"')
    return ''


# --------------------------------------------------------------------------------------------
# One install at a time
# --------------------------------------------------------------------------------------------


def is_alive(pid: int) -> bool:
    """Whether process `pid` is running. On Windows os.kill would end it, so it is asked another way."""
    if pid <= 0:
        return False
    if IS_WINDOWS:
        import ctypes

        kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
        handle = kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        try:
            code = ctypes.c_ulong()
            return bool(kernel32.GetExitCodeProcess(handle, ctypes.byref(code))) and code.value == 259  # STILL_ACTIVE
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


class Lock:
    """Held while an install or an update changes the folder; one whose run was killed is taken over."""

    def __init__(self, home: Path) -> None:
        self.path = home / '.installing'
        self.is_held = False

    def _is_stale(self) -> bool:
        # Its holder gone, or silent too long: a process id used again by another program keeps
        # it alive, so a holder at work touches the lock (a slow download can outlast the limit).
        try:
            if time.time() - self.path.stat().st_mtime >= LOCK_STALE_S:
                return True
            return not is_alive(int(self.path.read_text().strip() or '0'))
        except (OSError, ValueError):
            return True

    def touch(self) -> None:
        if self.is_held:
            try:
                os.utime(self.path)
            except OSError:
                pass

    def take(self) -> bool:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        for _ in range(2):
            try:
                fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_EXCL)
            except FileExistsError:
                if not self._is_stale():
                    return False
                try:
                    self.path.unlink()
                except OSError:
                    pass
                continue
            with os.fdopen(fd, 'w') as out:
                out.write(str(os.getpid()))
            self.is_held = True
            return True
        return False

    def release(self) -> None:
        if self.is_held:
            self.is_held = False
            try:
                # Taken over as stale meanwhile, it is the other run's to remove.
                if self.path.read_text().strip() == str(os.getpid()):
                    self.path.unlink()
            except OSError:
                pass


# --------------------------------------------------------------------------------------------
# The steps
# --------------------------------------------------------------------------------------------


def run_quiet(command: list[str], **options: Any) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, capture_output=True, text=True, errors='replace', check=False, **options)


def stop_unused(home: Path, port: int) -> None:
    """Stops the voice the test started, unless a Claude Code session uses it already."""
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/health', timeout=2) as response:
            if json.loads(response.read()).get('sessions', 0) > 0:
                return
    except (urllib.error.URLError, OSError, ValueError):
        return
    stop_service(home, port)


def stop_service(home: Path, port: int) -> None:
    """Stops the running voice, so its files can be replaced; it starts again on the next press."""
    python = venv_python(home)
    serve = ROOT / 'server' / 'serve.py'
    if python.exists():
        run_quiet([str(python), '-I', str(serve), 'stop', '--data', str(home), '--port', str(port)], timeout=30)
    stop_legacy(home)


def stop_legacy(home: Path) -> None:
    """
    Stops the server of the unreleased first readalong, which knows no request to stop. Its run script started it
    as `server/serve.py --data .` from the folder, so it is known by that and its folder.
    """
    proc = Path('/proc')
    if IS_WINDOWS or not (home / 'run').exists() or not proc.is_dir():
        return
    stopped = []
    for entry in proc.iterdir():
        if not entry.name.isdigit():
            continue
        try:
            args = (entry / 'cmdline').read_bytes().split(b'\0')
            if b'server/serve.py' in args and b'run' not in args and (entry / 'cwd').resolve() == home.resolve():
                os.kill(int(entry.name), 15)
                stopped.append(entry)
        except (OSError, ValueError):
            continue
    deadline = time.monotonic() + 5
    while stopped and time.monotonic() < deadline and any(entry.exists() for entry in stopped):
        time.sleep(0.1)


def copy_files(home: Path, pairs: list[tuple[str, str]]) -> None:
    for src, dst in pairs:
        if not (ROOT / src).is_file():
            raise Stop(f'{ROOT / src} is missing; the plugin folder is incomplete')
        if differs(ROOT / src, home / dst):
            put(ROOT / src, home / dst)
    # The start script of the unreleased first readalong: the plugin now starts the voice itself.
    try:
        (home / 'run').unlink()
    except OSError:
        pass


def sync_packages(home: Path, uv: str, out: Out | None = None) -> None:
    command = [uv, 'sync', '--frozen', '--no-dev']
    if out is None:
        done = run_quiet(command, cwd=str(home / 'server'), env=uv_env(home, uv))
    else:
        with out.working('Downloading and installing them'):
            done = run_quiet(command, cwd=str(home / 'server'), env=uv_env(home, uv))
    if done.returncode != 0:
        last = '\n'.join(done.stderr.strip().splitlines()[-8:])
        raise Stop(f'uv could not install the Python packages:\n{last}')
    if not venv_python(home).exists():
        raise Stop(f'uv made no Python at {venv_python(home)}')


def fetch(url: str, part: Path, out: Out) -> None:
    """Downloads `url` to `part`, going on from what an earlier run left there."""
    have = part.stat().st_size if part.exists() else 0
    request = urllib.request.Request(url, headers={'Range': f'bytes={have}-'} if have else {})
    try:
        response = urllib.request.urlopen(request, timeout=60)
    except urllib.error.HTTPError as err:
        if err.code != 416:
            raise
        # Nothing left to send: the file is whole already, or not this one; its checksum tells.
        return
    with response:
        is_resumed = have > 0 and getattr(response, 'status', 200) == 206
        if not is_resumed:
            have = 0
        total = have + int(response.headers.get('Content-Length') or 0)
        with open(part, 'ab' if is_resumed else 'wb') as dst:
            while chunk := response.read(1 << 18):
                dst.write(chunk)
                have += len(chunk)
                out.progress('model', 'Downloading the voice model', have, total)
    out.end_progress()


def fetch_with_curl(url: str, part: Path) -> bool:
    """The same download by curl, for a Python that cannot check the site's certificate."""
    curl = shutil.which('curl')
    if curl is None:
        return False
    return subprocess.run([curl, '-fL', '--retry', '3', '-C', '-', '-o', str(part), url], check=False).returncode == 0


def get_model(home: Path, out: Out) -> None:
    model = home / MODEL_FILE
    if model.exists() and sha256(model) == MODEL_SHA256:
        return out.ok('already here, checksum matches')
    former = former_home() / MODEL_FILE
    if former.resolve() != model.resolve() and former.is_file() and sha256(former) == MODEL_SHA256:
        shutil.move(former, model)
        return out.ok('taken from the earlier install, checksum matches')
    url = os.environ.get('READALONG_MODEL_URL') or MODEL_URL
    part = home / f'{MODEL_FILE}.part'
    out.note(f'Downloading Kokoro-82M from github.com/thewh1teagle/kokoro-onnx (about {MODEL_MB} MB, once)')
    why = ''
    for attempt in range(4):
        try:
            fetch(url, part, out)
        except (urllib.error.URLError, OSError) as err:
            out.end_progress()
            why = str(getattr(err, 'reason', err))
            if 'CERTIFICATE' in why.upper() and fetch_with_curl(url, part):
                why = ''
            else:
                time.sleep(2 * (attempt + 1))
                continue
        if part.exists() and sha256(part) == MODEL_SHA256:
            os.replace(part, model)
            return out.ok('downloaded, checksum matches')
        # Not the file expected: what is there is dropped, so the next try starts clean.
        part.unlink(missing_ok=True)
        why = why or 'the checksum of what arrived does not match'
    raise Stop(f'the voice model could not be downloaded ({why}); run this again to try once more')


def call(port: int, token: str, route: str, body: dict[str, Any], timeout: float = 60) -> dict[str, Any]:
    request = urllib.request.Request(
        f'http://127.0.0.1:{port}{route}',
        data=json.dumps(body).encode(),
        headers={'Content-Type': 'application/json', 'X-Readalong-Token': token},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as err:
        try:
            said = json.loads(err.read())
        except ValueError:
            said = {}
        raise Stop(f'the voice refused {route}: {said.get("error") or err.code}') from err
    except (urllib.error.URLError, OSError) as err:
        raise Stop(f'the voice did not answer {route} ({err})') from err


def test_voice(home: Path, port: int, with_model: bool, with_sound: bool, out: Out) -> None:
    python = venv_python(home)
    with out.working('Starting the voice (it loads the model)'):
        started = run_quiet([str(python), '-I', str(home / 'server' / 'serve.py'), 'start', '--data', str(home), '--port', str(port)], timeout=120)
    if started.returncode != 0:
        raise Stop(started.stderr.strip() or 'the voice did not start')
    out.ok(f'the voice answers on 127.0.0.1:{port}')
    token = (home / 'token').read_text().strip()
    sound: dict[str, Any] = {'sound': 'chime'}
    if with_model:
        with out.working('Making a test sentence'):
            made = call(port, token, '/v1/clips', {'input': TEST_SENTENCE, 'voice': 'af_heart', 'speed': 1})
        sound = {'clip': made['clip']}
        out.ok('speech made' + ('' if made.get('words') else ' (without word timings)'))
    if not with_sound:
        return
    owner = f'install-{os.getpid()}'
    # Only when nothing else is being read: an install must not talk over a session.
    if not call(port, token, '/v1/claim', {'owner': owner, 'yields': True}).get('granted'):
        return
    try:
        play = call(port, token, '/v1/play', {**sound, 'owner': owner})
        state, error = play.get('state'), play.get('error')
        deadline = time.monotonic() + 30
        while state == 'playing' and time.monotonic() < deadline:
            said = call(port, token, '/v1/wait', {'play': play['play'], 'owner': owner, 'seconds': 10})
            state, error = said.get('state'), said.get('error')
        if state == 'done':
            out.ok('played it: you should have heard "Readalong is ready."' if with_model else 'played the chime')
        else:
            out.warn(f'the sound could not be played: {error or state}')
    finally:
        call(port, token, '/v1/release', {'owner': owner})


# Where editors keep their extensions, under the home folder; the -server ones are WSL's and SSH's.
EDITORS = ('.vscode', '.vscode-server', '.vscode-insiders', '.vscode-server-insiders', '.cursor', '.cursor-server')


def find_claude() -> str | None:
    """The Claude Code command: the one this runs under, the one on the PATH, or the one an editor's extension ships."""
    exe = 'claude.exe' if IS_WINDOWS else 'claude'
    home = Path.home()
    running = Path(os.environ.get('CLAUDE_CODE_EXECPATH') or '.')
    if running.name.lower() == exe and running.is_file():
        return str(running)
    found = shutil.which('claude')
    if found:
        return found
    candidates = [home / '.claude' / 'local' / exe, home / '.local' / 'bin' / exe]
    shipped = sorted(
        (
            path
            for editor in EDITORS
            for path in (home / editor / 'extensions').glob(f'anthropic.claude-code-*/resources/native-binary/{exe}')
        ),
        key=lambda path: path.stat().st_mtime,
    )
    candidates += shipped[-1:]
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    return None


def plugin_source() -> str:
    """Where Claude Code installs the plugin from: GitHub when this is a clone of it, so updates come by /plugin update."""
    git = shutil.which('git')
    if git:
        origin = run_quiet([git, '-C', str(ROOT), 'remote', 'get-url', 'origin']).stdout.strip()
        for mark in ('github.com:', 'github.com/'):
            if mark in origin:
                return origin.split(mark, 1)[1].removesuffix('.git')
    return str(ROOT)


def install_plugin(out: Out) -> None:
    claude, source = find_claude(), plugin_source()
    if claude is None:
        # With arguments, /plugin works in the terminal only; the editors have a dialog for it.
        return out.warn(
            "Claude Code's command was not found, so install the plugin from Claude Code. "
            f'In a terminal: start claude and run  /plugin install readalong --marketplace {source}  '
            f'In VS Code: type /plugin, add {source} under Marketplaces, then install readalong under Plugins.'
        )
    command = [claude, 'plugin', 'install', 'readalong', '--marketplace', source, '--scope', 'user']
    done = run_quiet(command, stdin=subprocess.DEVNULL)
    if done.returncode == 0:
        return out.ok(f'installed from {source}')
    # Claude Code says why on stderr, the reason first and git's own words after it.
    said = [line.strip() for line in (done.stderr.strip() or done.stdout.strip()).splitlines() if line.strip()]
    why = said[0].lstrip('\u2718 ') if said else f'it ended with code {done.returncode}'
    again = subprocess.list2cmdline(command) if IS_WINDOWS else shlex.join(command)
    out.warn(f'the plugin was not installed: {why}')
    out.note(f'to try again, in a terminal:  {again}')


# --------------------------------------------------------------------------------------------
# The three things it does
# --------------------------------------------------------------------------------------------


def preface(args: argparse.Namespace, uv: str | None, out: Out) -> None:
    """What the install will do and where, said before it does any of it."""
    home: Path = args.home
    out.steps = 3 + (0 if args.no_model else 1) + (1 if args.plugin else 0)
    if out.is_json:
        return
    lines = [
        out.paint('1', 'readalong setup'),
        'A local voice that reads Claude Code replies aloud. English only for now.',
        '',
        'This will:',
        f'  1. check this computer, and use uv at {uv}' if uv else '  1. check this computer',
        '  2. install Python 3.12 and the speech packages pinned in server/uv.lock (about 80 MB)',
    ]
    if not args.no_model:
        lines.append(f'  3. download the Kokoro-82M voice model (about {MODEL_MB} MB) and check its SHA-256')
    lines.append(f'  {out.steps - (1 if args.plugin else 0)}. start the voice, ' + ('say a test sentence' if not args.no_sound else 'test it') + ', then stop it again')
    if args.plugin:
        lines.append(f'  {out.steps}. add the readalong plugin to Claude Code, for your user')
    lines += [
        '',
        f'Everything goes in one folder: {home}',
        'Nothing else on this computer is changed, and nothing runs once this is done: the voice',
        'starts with a Claude Code session and stops a minute after the last one closes.',
        'To remove it all: uninstall the plugin in Claude Code, or run this again with --uninstall.',
    ]
    out._write('\n'.join(lines) + '\n')


def install(args: argparse.Namespace, out: Out) -> None:
    home: Path = args.home
    uv = find_uv(home, args.uv)
    preface(args, uv, out)

    out.step('check', 'Checking this computer')
    if sys.platform not in ('linux', 'darwin', 'win32'):
        raise Stop(f'readalong runs on Linux, macOS and Windows; this is {sys.platform}')
    out.ok(f'{platform.system()} {platform.machine()}')
    if uv is None:
        raise Stop('uv was not found; start the install with setup.sh or setup.ps1, which fetch it')
    out.ok(f'uv at {uv}')

    lock = Lock(home)
    if not lock.take():
        raise Stop('another readalong install is running; wait for it to finish')
    out.heartbeat = lock.touch
    try:
        out.step('packages', 'Installing Python and the speech packages (about 80 MB)')
        stop_service(home, args.port)
        former = former_install(home)
        if former is not None:
            stop_service(former, args.port)  # it holds the port, and the model this install takes over
        copy_files(home, CODE + PACKAGES)
        sync_packages(home, uv, out)
        out.ok('Python and packages, as pinned in uv.lock')

        if args.no_model:
            has_model = (home / MODEL_FILE).exists()
        else:
            out.step('model', 'Getting the voice model')
            get_model(home, out)
            has_model = True

        stamp = packages_stamp(home, [dst for _, dst in PACKAGES])
        (home / 'ready.json').write_text(json.dumps({'version': service_version(), 'packages': stamp, 'model': has_model}))
        if former is not None:
            shutil.rmtree(former, ignore_errors=True)
    finally:
        lock.release()

    out.step('test', 'Starting the voice and testing it')
    test_voice(home, args.port, has_model, not args.no_sound, out)
    if not out.is_json:
        # From a terminal nothing is left running; the plugin, which reads at once, keeps it.
        stop_unused(home, args.port)
        out.ok('stopped it again: it starts with your next Claude Code session')

    if args.plugin:
        out.step('plugin', 'Installing the Claude Code plugin')
        install_plugin(out)

    if out.is_json:
        out.emit('done', 'The voice is installed')
    else:
        spent = clock(time.monotonic() - out.started)
        print(f'\n{out.paint("1;32", "Done")} in {spent}. Start a new Claude Code session: a play button appears under each reply.')
        print('In a terminal, /readalong opens the player and the settings, all by keyboard.')
        print('To remove everything: uninstall the plugin in Claude Code, or run this setup again with --uninstall.')


def update(args: argparse.Namespace) -> str:
    """
    Brings the install up to this plugin's files, so an update of the plugin reaches the voice by
    itself: 'current', 'updated', 'absent' (nothing installed), 'busy' (an install is running) or
    'stale' (its packages changed and no uv was found to install them; it runs on as it is).
    """
    home: Path = args.home
    if not venv_python(home).exists():
        return 'absent'
    ready = read_ready(home)
    wanted = packages_stamp(ROOT, [src for src, _ in PACKAGES])
    # An install from before the first release has no stamp: its own copies of the files tell what it holds.
    held = ready.get('packages') or packages_stamp(home, [dst for _, dst in PACKAGES])
    # No ready.json: an install from before the first release, or one cut short, perhaps while uv installed the packages;
    # uv makes them whole again, and quickly when they already are.
    is_resync = wanted != held or not ready
    is_recopy = any(differs(ROOT / src, home / dst) for src, dst in CODE)
    if not is_resync and not is_recopy and ready:
        return 'current'
    uv = find_uv(home, args.uv) if is_resync else None
    if is_resync and uv is None:
        return 'stale'
    lock = Lock(home)
    if not lock.take():
        return 'busy'
    try:
        if is_resync or is_recopy:
            stop_service(home, args.port)
        copy_files(home, CODE + (PACKAGES if is_resync else []))
        if uv is not None:
            sync_packages(home, uv)
        stamp = packages_stamp(home, [dst for _, dst in PACKAGES])
        has_model = (home / MODEL_FILE).exists()
        (home / 'ready.json').write_text(json.dumps({'version': service_version(), 'packages': stamp, 'model': has_model}))
    finally:
        lock.release()
    return 'updated'


def uninstall(args: argparse.Namespace, out: Out) -> None:
    """Removes all of readalong: the running voice, the plugin and its marketplace, and the voice's folder."""
    home: Path = args.home
    if not out.is_json:
        print(out.paint('1', 'readalong uninstall'))
        print(f'Stops the voice, removes {home}' + (', the plugin and its marketplace from Claude Code.' if args.plugin else '.'))
    out.step('remove', 'Removing readalong')
    stop_service(home, args.port)
    former = former_install(home)
    if former is not None:
        stop_service(former, args.port)
    if args.plugin:
        claude = find_claude()
        quiet = {'stdin': subprocess.DEVNULL}
        if claude is not None and run_quiet([claude, 'plugin', 'uninstall', 'readalong@readalong'], **quiet).returncode == 0:
            out.ok('removed the plugin')
            # Where it was installed from: a line in Claude Code's settings and its copy of the repository.
            if run_quiet([claude, 'plugin', 'marketplace', 'remove', 'readalong'], **quiet).returncode == 0:
                out.ok('removed its marketplace')
        else:
            out.warn(
                'the plugin was not removed; remove it in Claude Code: in a terminal, /plugin uninstall readalong@readalong; '
                'in VS Code, type / and pick Manage plugins'
            )
    # Only a folder readalong made is removed, whatever READALONG_HOME points at. What this very
    # Python runs from cannot always be removed (Windows); the script that started it finishes.
    if is_ours(home):
        shutil.rmtree(home, ignore_errors=True)
        out.ok(f'removed {home}')
    else:
        out.warn(f'{home} does not look like a folder readalong made, so it was left; remove it yourself')
    if former is not None:
        shutil.rmtree(former, ignore_errors=True)
        out.ok(f'removed {former}')
    out.emit('done', 'The voice is removed')
    if not out.is_json and out.warnings == 0:
        print(f'\n{out.paint("1;32", "Done.")} Nothing of readalong is left but the folder you cloned it into, if you did.')
    elif not out.is_json:
        print(f'\n{out.paint("1;33", "Done, but not all of it:")} the warnings above say what is left, and how to remove it.')


def main() -> int:
    parser = argparse.ArgumentParser(description='Installs, updates and removes the readalong voice.')
    parser.add_argument('--home', type=Path, default=default_home())
    parser.add_argument('--uv')
    parser.add_argument('--port', type=int, default=int(os.environ.get('READALONG_PORT') or 8881))
    parser.add_argument('--progress', choices=['text', 'json'], default='text')
    parser.add_argument('--update', action='store_true')
    parser.add_argument('--uninstall', action='store_true')
    parser.add_argument('--no-model', action='store_true')
    parser.add_argument('--no-sound', action='store_true')
    parser.add_argument('--plugin', action='store_true')
    args = parser.parse_args()
    args.home = args.home.expanduser().absolute()
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'):
            stream.reconfigure(encoding='utf-8', errors='replace')
    out = Out(args.progress == 'json')
    try:
        if args.update:
            state = update(args)
            print(json.dumps({'state': state}), flush=True)
        elif args.uninstall:
            uninstall(args, out)
        else:
            install(args, out)
    except Stop as err:
        if args.update:
            print(json.dumps({'state': 'failed', 'error': str(err)}), flush=True)
        elif out.is_json:
            out.emit('failed', error=str(err))
        else:
            print(f'\nSetup stopped: {err}', file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130
    return 0


if __name__ == '__main__':
    sys.exit(main())
