"""The readalong service: makes the speech and plays it, for every Claude Code session on this computer.

One process per computer, on 127.0.0.1 only. The plugin asks it over HTTP to make a sentence's
audio (Kokoro-82M through ONNX Runtime, or a speech server of the user's own), to play it, and to
stop it; since every session's sound goes through this one process, it is also what keeps two
sessions from talking over each other. It runs the same on Linux, macOS and Windows: Python does
here what the plugin cannot do portably (processes, sound, files).

    serve.py run   --data DIR [--port N]     the service, in the foreground
    serve.py start --data DIR [--port N]     start it in the background; return once it answers
    serve.py stop  --data DIR [--port N]     ask a running one to stop; return once it has
    serve.py spawn COMMAND                   run a shell command in the background, detached
    serve.py wait URL [--seconds S]          return once URL/health answers

Routes (JSON in and out; all but the first two need the X-Readalong-Token header, whose value is
in DIR/token, readable by the user alone):

    GET  /health            {"status": "healthy", "service": "readalong", ...} once it is ready
    POST /v1/audio/speech   OpenAI-style (input, voice, speed, lang?, english?) -> 24 kHz mono
                            WAV, with an X-Word-Starts header: when each word starts in it, in
                            milliseconds
    POST /v1/clips          {input, voice, speed, lang?, english?, upstream?} -> {clip, words, ms}:
                            a sentence's audio, made once and kept; with `upstream`, made by that
                            server. `lang` is the language it is said in: en (the default), fr,
                            es, it, pt, hi, de or nl. `english` names the words of `input` said
                            in English whatever `lang` is, as [from, to) pairs of word numbers
    POST /v1/play           {clip | sound, owner, player?, overlay?} -> {play}, once it sounds
    POST /v1/wait           {play, seconds} -> {state}: playing, done, stopped, taken, mic or failed
    POST /v1/stop           {owner}: stops what `owner` is playing
    POST /v1/claim          {owner, yields} -> {granted, reason?}: makes `owner` the reading that is heard
    POST /v1/release        {owner}: `owner` is no longer heard (paused, or over)
    POST /v1/session        {session, open}: a Claude Code session is open (said every 30 s), or closed
    POST /v1/shutdown       stops the service

While a reading is heard, a program starting to record from a microphone (dictation in Claude
Code, a call) stops it: its sound ends as `mic`, and it is refused from then on (code `mic`), so
it does not talk into what is being recorded. One started while the microphone already records
is read; an answer read automatically (`yields`) is not, with reason `mic`.

It says one short warm-up sentence to itself so the first real request is quick. It lives no
longer than the Claude Code sessions that use it: each one says it is open every 30 seconds
(POST /v1/session), and once the last has closed, or gone silent, for a minute, it exits. It also
exits after --idle-minutes without reading anything, with sessions open (the plugin starts it
again on the next press), and when it is uninstalled under it: when its folder goes, or the
plugin whose data folder it lives in is removed from Claude Code. Standard library only besides kokoro-onnx and numpy, which are
loaded by `run` alone.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import secrets
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
import wave
from collections import OrderedDict
from difflib import SequenceMatcher
from functools import lru_cache
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable, Sequence

if TYPE_CHECKING:
    import numpy as np
    from kokoro_onnx import Kokoro

VERSION = '0.1.0'
# What the plugin and the service must agree on; raised when a route changes its meaning.
PROTOCOL = 6
DEFAULT_PORT = 8881
MAX_INPUT = 4000
MAX_BODY = 1 << 20
MAX_CLIPS = 300
# How long a reading that makes no request still counts as heard: a session that ended without
# saying so stops holding the voice after this.
STALE_S = 15.0
# How long one /v1/wait may hold its answer, so a request never outlives a client's timeout.
MAX_WAIT_S = 20.0
# How long a player that failed is left out before it is tried again.
BROKEN_S = 60.0
# How often the microphone is looked at while a reading is heard, in seconds.
MIC_EVERY_S = 0.3
# A session that has not said it is open for this long has gone (closed without saying so, or killed).
SESSION_TTL_S = 90.0
# How long the voice waits after the last session went before it exits: a session opened again
# meanwhile finds it ready.
SESSION_GRACE_S = float(os.environ.get('READALONG_SESSION_GRACE_S') or 60)
# How many readings a microphone stopped are kept, so none of them sounds again.
MIC_KEPT = 50
EXIT_PORT_TAKEN = 3
PLAYER_SETTINGS = ('pw-play', 'paplay', 'aplay', 'afplay', 'ffplay')

# Where the v1.0 export keeps how long each phoneme is held, in frames: the durations Kokoro
# predicts, rounded, before its decoder makes the audio. Kokoro's own PyTorch release reads its
# word timestamps from the same value; this export computes it but does not hand it out.
DURATIONS = '/encoder/Clip_output_0'

IS_WINDOWS = os.name == 'nt'
# A child started by a process that has no console window would open one of its own.
QUIET: dict[str, Any] = {'creationflags': subprocess.CREATE_NO_WINDOW} if IS_WINDOWS else {}

# Plays the WAV file named by its argument to the end; ending the process ends the sound.
WINSOUND = 'import sys, winsound; winsound.PlaySound(sys.argv[1], winsound.SND_FILENAME | winsound.SND_NODEFAULT)'
SILENCE = 'import sys, time; time.sleep(float(sys.argv[1]))'


class Refused(Exception):
    """A request that cannot be answered as asked; `status` is the HTTP status, `code` names the case."""

    def __init__(self, status: int, message: str, code: str = '') -> None:
        super().__init__(message)
        self.status = status
        self.code = code


# --------------------------------------------------------------------------------------------
# Playing
# --------------------------------------------------------------------------------------------


def is_wsl() -> bool:
    try:
        return 'microsoft' in Path('/proc/version').read_text().lower()
    except OSError:
        return False


def player_names() -> list[str]:
    """The players this system may have, best first."""
    if os.environ.get('READALONG_PLAYER') == 'null':
        return ['null']  # for tests: takes the sound's time, in silence
    if IS_WINDOWS:
        return ['winsound']
    if sys.platform == 'darwin':
        return ['afplay', 'ffplay']
    # Under WSL with no Linux player, Windows itself plays the file.
    return ['pw-play', 'paplay', 'aplay', 'ffplay'] + (['powershell'] if is_wsl() else [])


def player_command(name: str, path: Path, seconds: float) -> list[str] | None:
    """The command that plays `path` to its end with the player `name`; None when it is not installed."""
    # The interpreter itself rather than the environment's launcher, so stopping it stops the sound.
    python = getattr(sys, '_base_executable', None) or sys.executable
    if name == 'null':
        return [python, '-I', '-S', '-c', SILENCE, str(seconds)]
    if name == 'winsound':
        return [python, '-I', '-S', '-c', WINSOUND, str(path)] if IS_WINDOWS else None
    if name == 'powershell':
        exe = shutil.which('powershell.exe')
        if exe is None or shutil.which('wslpath') is None:
            return None
        windows = subprocess.run(['wslpath', '-w', str(path)], capture_output=True, text=True, check=False).stdout.strip()
        if windows == '':
            return None
        quoted = windows.replace("'", "''")
        return [exe, '-NoProfile', '-NonInteractive', '-Command', f"(New-Object System.Media.SoundPlayer '{quoted}').PlaySync()"]
    exe = shutil.which(name)
    if exe is None:
        return None
    if name == 'ffplay':
        return [exe, '-nodisp', '-autoexit', '-loglevel', 'error', str(path)]
    if name == 'aplay':
        return [exe, '-q', str(path)]
    if name in ('pw-play', 'paplay', 'afplay'):
        return [exe, str(path)]
    return None


def no_player_hint() -> str:
    if IS_WINDOWS:
        return 'Windows could not play the sound'
    if sys.platform == 'darwin':
        return 'afplay, which macOS ships, was not found'
    return 'install PipeWire (pw-play), PulseAudio (paplay), ALSA (aplay) or FFmpeg (ffplay)'


class Play:
    """One sound being played: a sentence, or a chime."""

    def __init__(self, owner: str, overlay: bool) -> None:
        self.id = uuid.uuid4().hex
        self.owner = owner
        self.overlay = overlay
        self.state = 'playing'
        self.error = ''
        self.proc: subprocess.Popen[bytes] | None = None
        # Why it was stopped, once it has been asked to: 'stopped', 'taken' or 'mic'.
        self.stop_as: str | None = None
        self.started = threading.Event()
        self.done = threading.Event()


class Voice:
    """
    The one voice of this computer: what is playing, and which reading is heard.

    A reading (an `owner`, one per reading of a reply) is heard from its claim until it lets go.
    One that stops asking for anything, as when its session ended without saying so, no longer
    counts after STALE_S.

    `mic` tells whether a program records from a microphone (mic_check); one starting to while a
    reading is heard stops that reading for good.
    """

    def __init__(self, mic: MicCheck = lambda: None) -> None:
        self.mic = mic
        # The readings a microphone stopped, which may not sound again.
        self.hushed: OrderedDict[str, None] = OrderedDict()
        self.lock = threading.Lock()
        self.current: Play | None = None
        self.plays: OrderedDict[str, Play] = OrderedDict()
        self.owner: str | None = None
        self.seen = 0.0
        self.asking: dict[str, int] = {}
        self.broken: dict[str, float] = {}

    # Who is heard --------------------------------------------------------------------------

    def _is_other_heard(self, owner: str) -> bool:
        other = self.owner
        if other is None or other == owner:
            return False
        if self.current is not None and self.current.owner == other:
            return True
        return self.asking.get(other, 0) > 0 or time.monotonic() - self.seen < STALE_S

    def claim(self, owner: str, yields: bool) -> tuple[bool, str]:
        """
        Makes `owner` the reading heard; with `yields`, only when no other reading is (reason
        `heard`) and no microphone records (reason `mic`).
        """
        if yields and self.mic() is True:
            return False, 'mic'
        with self.lock:
            if owner in self.hushed:
                raise Refused(409, 'a microphone started recording, which stopped this reading', 'mic')
            if yields and self._is_other_heard(owner):
                return False, 'heard'
            if self.current is not None and self.current.owner != owner:
                self._end(self.current, 'taken')
            self.owner = owner
            self.seen = time.monotonic()
            return True, ''

    def release(self, owner: str) -> None:
        with self.lock:
            if self.current is not None and self.current.owner == owner:
                self._end(self.current, 'stopped')
            if self.owner == owner:
                self.owner = None

    def asks(self, owner: str, by: int) -> None:
        """Counts a request of `owner` in flight (by 1) or answered (by -1): it is heard meanwhile."""
        if owner == '':
            return
        with self.lock:
            count = self.asking.get(owner, 0) + by
            if count > 0:
                self.asking[owner] = count
            else:
                self.asking.pop(owner, None)
            if owner == self.owner:
                self.seen = time.monotonic()

    def is_busy(self) -> bool:
        with self.lock:
            return any(play.state == 'playing' for play in self.plays.values())

    def _is_reading(self) -> bool:
        """Whether a reading is heard: playing, or between its sentences. The lock is held."""
        if self.current is not None:
            return True
        return self.owner is not None and (self.asking.get(self.owner, 0) > 0 or time.monotonic() - self.seen < STALE_S)

    # The microphone ----------------------------------------------------------------------

    def watch_mic(self, stopped: threading.Event) -> None:
        """
        Looks at the microphone while a reading is heard, and stops the reading when a program
        starts to record. What it found when the reading began is where it starts from, so a
        reading started during a call goes on.
        """
        was: bool | None = None
        while not stopped.wait(MIC_EVERY_S):
            with self.lock:
                is_reading = self._is_reading()
            if not is_reading:
                was = None
                continue
            try:
                now = self.mic()
            except Exception:  # a check that broke tells nothing
                now = None
            if now is None:
                continue
            if now and was is False:
                self.hush()
                now = None  # what follows is another reading's, which starts afresh
            was = now

    def hush(self) -> None:
        """A microphone started recording: the reading heard stops, and may not sound again."""
        with self.lock:
            owners = {self.owner, self.current.owner if self.current is not None else None} - {None}
            if self.current is not None:
                self._end(self.current, 'mic')
            for owner in owners:
                self.hushed[owner] = None
            while len(self.hushed) > MIC_KEPT:
                self.hushed.popitem(last=False)
            self.owner = None
        if owners:
            log('a microphone started recording; the reading stopped')

    # Playing -------------------------------------------------------------------------------

    def play(self, path: Path, seconds: float, owner: str, wanted: str, overlay: bool) -> Play:
        """
        Starts playing `path`, and returns once it sounds or has failed.

        A sound of the reading that is heard replaces what was playing. An `overlay` sounds over
        it instead, and is nobody's turn: the chime of an answer that gave way.
        """
        play = Play(owner, overlay)
        with self.lock:
            if owner in self.hushed:
                raise Refused(409, 'a microphone started recording, which stopped this reading', 'mic')
            if not overlay:
                if self.owner != owner:
                    raise Refused(409, 'another reading is being heard', 'not-heard')
                if self.current is not None:
                    self._end(self.current, 'stopped')
                self.current = play
                self.seen = time.monotonic()
            self.plays[play.id] = play
            for old in [k for k, p in self.plays.items() if p.state != 'playing'][:-50]:
                del self.plays[old]
        threading.Thread(target=self._run, args=(play, path, seconds, wanted), daemon=True).start()
        play.started.wait(5)
        return play

    def stop(self, owner: str) -> None:
        with self.lock:
            if self.current is not None and self.current.owner == owner:
                self._end(self.current, 'stopped')

    def stop_all(self) -> None:
        with self.lock:
            for play in self.plays.values():
                self._end(play, 'stopped')

    def wait(self, play_id: str, seconds: float) -> Play | None:
        with self.lock:
            play = self.plays.get(play_id)
        if play is not None:
            play.done.wait(max(0.0, min(seconds, MAX_WAIT_S)))
        return play

    def _end(self, play: Play, state: str) -> None:
        """Asks a sound to stop, as `state`; its thread settles it. The lock is held."""
        if play.stop_as is None and play.state == 'playing':
            play.stop_as = state
            if play.proc is not None:
                terminate(play.proc)

    def _candidates(self, wanted: str) -> list[str]:
        if wanted != 'auto':
            return [wanted]
        now = time.monotonic()
        with self.lock:
            return [name for name in player_names() if now - self.broken.get(name, -BROKEN_S) >= BROKEN_S]

    def _run(self, play: Play, path: Path, seconds: float, wanted: str) -> None:
        why = f'no audio player was found; {no_player_hint()}'
        try:
            for name in self._candidates(wanted):
                command = player_command(name, path, seconds)
                if command is None:
                    if wanted != 'auto':
                        why = f'{name} was not found'
                    continue
                with self.lock:
                    stopped = play.stop_as
                if stopped is not None:
                    return self._settle(play, stopped)
                try:
                    proc = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, **QUIET)
                except OSError as err:
                    why = f'{name} could not start ({err})'
                    continue
                with self.lock:
                    play.proc = proc
                    if play.stop_as is not None:
                        terminate(proc)
                play.started.set()
                _, errors = proc.communicate()
                with self.lock:
                    stopped = play.stop_as
                if stopped is not None:
                    return self._settle(play, stopped)
                if proc.returncode == 0:
                    return self._settle(play, 'done')
                why = errors.decode(errors='replace').strip() or f'{name} exited with {proc.returncode}'
                if wanted == 'auto':
                    # A player that cannot reach the sound server (pw-play without PipeWire) gives
                    # way to the next, and is tried again later.
                    with self.lock:
                        self.broken[name] = time.monotonic()
                    log(f'{name} could not play: {why}')
            self._settle(play, 'failed', why)
        except Exception as err:  # never leave a waiter hanging
            self._settle(play, 'failed', str(err))

    def _settle(self, play: Play, state: str, error: str = '') -> None:
        with self.lock:
            play.state = state
            play.error = error
            if self.current is play:
                self.current = None
                self.seen = time.monotonic()
        play.started.set()
        play.done.set()


def terminate(proc: subprocess.Popen[bytes]) -> None:
    try:
        proc.terminate()
    except OSError:
        pass


# --------------------------------------------------------------------------------------------
# The microphone
# --------------------------------------------------------------------------------------------

# Where Windows notes, for each program, when it last started and stopped recording from a
# microphone: what lights the microphone in the taskbar. A program recording now has a start and
# no stop yet. Packaged apps have a key each; the others are under NonPackaged, by their path.
WINDOWS_MIC = r'Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone'

MicCheck = Callable[[], 'bool | None']


def mic_check() -> MicCheck:
    """
    What tells whether a program is recording from a microphone now, on this system: dictation
    in Claude Code, a call, a voice recorder. It answers True, False, or None when it cannot tell.
    The readalong voice only plays, which no check counts.
    """
    wanted = os.environ.get('READALONG_MIC', '')
    if wanted == 'off':
        return lambda: None
    if wanted.startswith('file:'):  # for tests: recording while the file exists
        marker = Path(wanted[len('file:'):])
        return marker.exists
    try:
        if IS_WINDOWS:
            return windows_mic
        if sys.platform == 'darwin':
            return MacMic().is_live
        if is_wsl() and shutil.which('reg.exe') is not None:
            # Claude Code's window, and its microphone, are Windows'.
            return wsl_mic
        return linux_mic
    except Exception as err:  # a system that has none of what is looked for
        log(f'the microphone cannot be watched here ({err})')
        return lambda: None


def linux_mic() -> bool | None:
    # PipeWire: a capture stream, and the microphone it takes, run only while recording.
    if shutil.which('pw-dump') is not None:
        try:
            out = subprocess.run(['pw-dump'], capture_output=True, text=True, timeout=2, check=False).stdout
            nodes = json.loads(out) if out.strip() else None
        except (OSError, subprocess.SubprocessError, ValueError):
            nodes = None
        if isinstance(nodes, list):
            return any(is_recording(node) for node in nodes)
    # PulseAudio: a source is RUNNING while recorded from; a monitor records what plays.
    if shutil.which('pactl') is not None:
        try:
            out = subprocess.run(['pactl', 'list', 'sources', 'short'], capture_output=True, text=True, timeout=2, check=False)
        except (OSError, subprocess.SubprocessError):
            out = None
        if out is not None and out.returncode == 0:
            rows = [line.split('\t') for line in out.stdout.splitlines()]
            return any(len(row) >= 2 and not row[1].endswith('.monitor') and row[-1].strip() == 'RUNNING' for row in rows)
    # ALSA alone: a capture device open and running.
    found = None
    for status in Path('/proc/asound').glob('card*/pcm*c/sub*/status'):
        try:
            found = found or 'RUNNING' in status.read_text()
        except OSError:
            continue
    return found


def is_recording(node: Any) -> bool:
    """
    Whether a PipeWire node records: a program's capture stream running, whatever it is linked
    to (the default input may be a headset's output, heard back), or a microphone running.

    A stream that records what the speakers play (a screen recorder taking the desktop's sound,
    which PipeWire marks `stream.capture.sink`, or one aimed at a `.monitor`) is not a person
    speaking: counted, it silenced every automatic reading while anything recorded the screen.
    """
    if not isinstance(node, dict) or node.get('type') != 'PipeWire:Interface:Node':
        return False
    info = node.get('info') or {}
    props = info.get('props') or {}
    kind = str(props.get('media.class') or '')
    if info.get('state') != 'running':
        return False
    if kind == 'Stream/Input/Audio':
        hears_speakers = str(props.get('stream.capture.sink')).lower() == 'true' or str(
            props.get('target.object') or ''
        ).endswith('.monitor')
        return not hears_speakers
    return kind.startswith('Audio/Source')


def windows_mic() -> bool | None:
    import winreg

    def recording(key: Any, depth: int) -> bool:
        try:
            start = winreg.QueryValueEx(key, 'LastUsedTimeStart')[0]
            stop = winreg.QueryValueEx(key, 'LastUsedTimeStop')[0]
            if start and not stop:
                return True
        except OSError:
            pass
        if depth == 0:
            return False
        index = 0
        while True:
            try:
                name = winreg.EnumKey(key, index)
            except OSError:
                return False
            index += 1
            try:
                with winreg.OpenKey(key, name) as sub:
                    if recording(sub, depth - 1):
                        return True
            except OSError:
                continue

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, WINDOWS_MIC) as root:
            return recording(root, 2)
    except OSError:
        return None


def wsl_mic() -> bool | None:
    try:
        out = subprocess.run(['reg.exe', 'query', f'HKCU\\{WINDOWS_MIC}', '/s'], capture_output=True, text=True, timeout=5, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode != 0:
        return None
    # Each key's line, then its values: `    LastUsedTimeStop    REG_QWORD    0x0`.
    times: dict[str, int] = {}
    for line in out.stdout.splitlines() + ['HKEY_END']:
        if line.startswith('HKEY_'):
            if times.get('LastUsedTimeStart', 0) and not times.get('LastUsedTimeStop', 1):
                return True
            times = {}
            continue
        parts = line.split()
        if len(parts) == 3 and parts[1] == 'REG_QWORD':
            try:
                times[parts[0]] = int(parts[2], 16)
            except ValueError:
                pass
    return False


class MacMic:
    """macOS's own account, through CoreAudio, of who records: what lights its orange dot."""

    SYSTEM = 1  # kAudioObjectSystemObject

    def __init__(self) -> None:
        import ctypes

        self.ctypes = ctypes
        self.audio = ctypes.CDLL('/System/Library/Frameworks/CoreAudio.framework/CoreAudio')

        class Address(ctypes.Structure):
            _fields_ = [('selector', ctypes.c_uint32), ('scope', ctypes.c_uint32), ('element', ctypes.c_uint32)]

        self.Address = Address
        size_of = self.audio.AudioObjectGetPropertyDataSize
        size_of.restype = ctypes.c_int32
        size_of.argtypes = [ctypes.c_uint32, ctypes.POINTER(Address), ctypes.c_uint32, ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint32)]
        get = self.audio.AudioObjectGetPropertyData
        get.restype = ctypes.c_int32
        get.argtypes = [ctypes.c_uint32, ctypes.POINTER(Address), ctypes.c_uint32, ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint32), ctypes.c_void_p]

    def _get(self, target: int, selector: str, scope: str = 'glob') -> list[int] | None:
        """A property of `target` read as 32-bit numbers; None when it has none."""
        c = self.ctypes
        address = self.Address(fourcc(selector), fourcc(scope), 0)
        size = c.c_uint32(0)
        if self.audio.AudioObjectGetPropertyDataSize(target, c.byref(address), 0, None, c.byref(size)) != 0:
            return None
        if size.value == 0:
            return []
        data = (c.c_uint32 * (size.value // 4))()
        if self.audio.AudioObjectGetPropertyData(target, c.byref(address), 0, None, c.byref(size), data) != 0:
            return None
        return list(data)[: size.value // 4]

    def is_live(self) -> bool | None:
        # macOS 14.2 and later: each program's audio, and whether it is taking input now.
        programs = self._get(self.SYSTEM, 'prs#')
        if programs is not None:
            return any(self._get(program, 'piri') == [1] for program in programs)
        # Before: whether the microphone itself runs, unless it also plays (a headset that is one
        # device), as the readalong voice would then run it.
        device = self._get(self.SYSTEM, 'dIn ')
        if not device or device[0] == 0:
            return None
        if self._get(device[0], 'stm#', 'outp') != []:
            return None
        running = self._get(device[0], 'gone')
        return None if not running else running[0] != 0


def fourcc(code: str) -> int:
    return int.from_bytes(code.encode('ascii'), 'big')


# --------------------------------------------------------------------------------------------
# Sentences made into audio
# --------------------------------------------------------------------------------------------

ClipKey = tuple[str, str, float, str]


class Clip:
    def __init__(self, path: Path, words: list[int], ms: int) -> None:
        self.id = path.stem
        self.path = path
        self.words = words
        self.ms = ms


class Clips:
    """The audio made so far, each sentence once per voice and speed, in a folder of the service's own."""

    def __init__(self, folder: Path) -> None:
        self.folder = folder
        self.lock = threading.Lock()
        self.by_key: OrderedDict[ClipKey, Clip] = OrderedDict()
        self.by_id: dict[str, Clip] = {}

    def find(self, key: ClipKey) -> Clip | None:
        with self.lock:
            clip = self.by_key.get(key)
            if clip is not None:
                self.by_key.move_to_end(key)
            return clip

    def get(self, clip_id: str) -> Clip | None:
        with self.lock:
            return self.by_id.get(clip_id)

    def add(self, key: ClipKey, audio: bytes, words: list[int]) -> Clip:
        path = self.folder / f'{uuid.uuid4().hex}.wav'
        path.write_bytes(audio)
        clip = Clip(path, words, wav_ms(audio))
        with self.lock:
            self.by_key[key] = clip
            self.by_id[clip.id] = clip
            while len(self.by_key) > MAX_CLIPS:
                _, old = self.by_key.popitem(last=False)
                self.by_id.pop(old.id, None)
                # One still playing is open by its player: it plays on, or (Windows) stays until the folder goes.
                try:
                    old.path.unlink()
                except OSError:
                    pass
        return clip


def wav_ms(audio: bytes) -> int:
    try:
        with wave.open(io.BytesIO(audio), 'rb') as w:
            return round(w.getnframes() * 1000 / w.getframerate())
    except (wave.Error, EOFError, ZeroDivisionError):
        return 0


def from_upstream(upstream: str, text: str, voice: str, speed: float) -> tuple[bytes, list[int]]:
    """A sentence's audio from a speech server of the user's own, by the OpenAI route."""
    if not upstream.startswith(('http://', 'https://')):
        raise Refused(400, f'"{upstream}" is not an http address')
    body = json.dumps({'model': 'kokoro', 'input': text, 'voice': voice, 'speed': speed, 'response_format': 'wav', 'stream': False})
    request = urllib.request.Request(
        f'{upstream.rstrip("/")}/v1/audio/speech', data=body.encode(), headers={'Content-Type': 'application/json'}
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            audio = response.read()
            starts = response.headers.get('X-Word-Starts', '')
    except urllib.error.HTTPError as err:
        said = err.read(300).decode(errors='replace').strip()
        detail = f' ({said})' if said else ''
        raise Refused(502, f'{upstream} answered {err.code}{detail}; check that it has the voice "{voice}"', 'upstream-refused') from err
    except (urllib.error.URLError, OSError) as err:
        raise Refused(502, f'nothing answers at {upstream}', 'upstream-down') from err
    if audio[:4] != b'RIFF' or audio[8:12] != b'WAVE':
        raise Refused(502, f'{upstream} did not answer with WAV audio', 'upstream-refused')
    try:
        words = [int(float(ms)) for ms in starts.split(',')] if starts.strip() else []
    except ValueError:
        words = []
    return audio, [] if any(ms < 0 for ms in words) else words


# --------------------------------------------------------------------------------------------
# The model
# --------------------------------------------------------------------------------------------


def load(model: Path, voices: Path) -> Kokoro:
    """The model, with its phoneme durations handed out when it has them; without, as it is."""
    from kokoro_onnx import Kokoro

    timed = model.with_suffix('.timed.onnx')
    try:
        patch = with_durations()
        if not timed.exists() or timed.stat().st_size != model.stat().st_size + len(patch):
            # Made once, next to the model, and loaded from its path: loaded from memory instead,
            # onnxruntime would keep a second copy of the model's 325 MB for as long as it runs.
            part = timed.with_suffix('.part')
            with open(model, 'rb') as src, open(part, 'wb') as out:
                while chunk := src.read(1 << 24):
                    out.write(chunk)
                out.write(patch)
            part.replace(timed)
        kokoro = Kokoro(str(timed), str(voices))
        if kokoro.has_timings:
            return kokoro
        log('the timed model reports no durations; words will not be timed')
    except Exception as err:  # another export, without that value, or no room on the disk
        log(f'words will not be timed ({err})')
    return Kokoro(str(model), str(voices))


def with_durations() -> bytes:
    """
    Bytes that, appended to the model file, hand out DURATIONS as an output named `duration`, the
    output kokoro-onnx reads phoneme timings from.

    Appended protobuf fields merge into the message before them, a repeated field growing by the
    new items: these add an Identity node from DURATIONS to `duration`, and `duration`, a float
    tensor, to the graph's outputs. The model itself is left as it is.
    """

    def varint(n: int) -> bytes:
        out = bytearray()
        while True:
            out.append(n & 0x7F | (0x80 if n > 0x7F else 0))
            n >>= 7
            if n == 0:
                return bytes(out)

    def field(number: int, payload: bytes | str) -> bytes:
        data = payload.encode() if isinstance(payload, str) else payload
        return varint(number << 3 | 2) + varint(len(data)) + data

    # NodeProto: input 1, output 2, name 3, op_type 4.
    node = field(1, DURATIONS) + field(2, 'duration') + field(3, 'readalong_duration') + field(4, 'Identity')
    # ValueInfoProto: name 1, type 2; TypeProto.tensor_type 1; its elem_type 1, FLOAT being 1.
    output = field(1, 'duration') + field(2, field(1, varint(1 << 3) + varint(1)))
    # ModelProto.graph 7; GraphProto: node 1, output 12.
    return field(7, field(1, node) + field(12, output))


# The languages a sentence may be read in, by the code the plugin sends, and how espeak-ng names
# each: the rules that turn its words into sounds. English is told by its voice, below. French,
# Spanish, Italian, Portuguese and Hindi are the languages Kokoro has voices for; German and
# Dutch it has none for, and are read by an English voice, with German or Dutch sounds.
LANGUAGES = {'en': '', 'fr': 'fr-fr', 'es': 'es', 'it': 'it', 'pt': 'pt-br', 'hi': 'hi', 'de': 'de', 'nl': 'nl'}


def accent(voice: str, language: str = 'en') -> str:
    """
    The rules a sentence is pronounced by: its language's. In English, the voice's accent: Kokoro
    names its British English voices bf_ and bm_.
    """
    if LANGUAGES.get(language):
        return LANGUAGES[language]
    return 'en-gb' if voice.startswith('b') else 'en-us'


# How a sentence's sounds are made, outside English, step by step. The steps are those Kokoro's
# voices were trained with (misaki's EspeakG2P), so a voice is given what it learnt from, then
# three of readalong's own, each for something heard to go wrong:
#
#   1. spelling   a French word's "th" is written "t" (`spelled_for`), and « » as “ ”
#   2. espeak-ng  reads the text by the language's rules, tying the sounds said as one ("t^ʃ")
#   3. borrowed   a word espeak-ng read by English rules is said in the language's own sounds,
#                 where the language has a voice of its own that says it so (`BORROWED`)
#   4. joined     each tied pair becomes the one symbol the model knows it by (`JOINED`)
#   5. nearest    a sound the model has no symbol for becomes its nearest one (`NEAREST`)
#   6. known      what is left that the model does not know is dropped, as kokoro-onnx does
#
# English words inside the sentence that the plugin names (an equation, a code name) skip all
# of it: they are read by English rules, in the same voice (`speak`).

# espeak-ng marks where it reads a word by another language's rules, "(en)hˈʊk(fr)": made of
# letters and brackets the model knows, a mark left in is said, as "e n" and "f r".
SWITCH = re.compile(r'\([a-z]{2,3}(?:-[a-z]{2,4})?\)')
# The same mark as it comes with tied sounds, a tie between its letters: "(^e^n)".
TIED_SWITCH = re.compile(r'\((?:\^?[a-z-])+\)')

# Two sounds said as one, and the symbol Kokoro knows the pair by.
JOINED = sorted(
    {
        'a^ɪ': 'I', 'a^ʊ': 'W', 'd^z': 'ʣ', 'd^ʒ': 'ʤ', 'e^ɪ': 'A', 'o^ʊ': 'O', 'ə^ʊ': 'Q',
        's^s': 'S', 't^s': 'ʦ', 't^ʃ': 'ʧ', 'ɔ^ɪ': 'Y',
    }.items()
)

# A sound of German or Dutch the model has no symbol for, and the nearest it has: the short ü
# of "fünf" as the long one's, the short u of Dutch "dus" as the ö of "deur".
NEAREST = {'ʏ': 'y', 'ɵ': 'ø'}

# A French word with "th" in it: espeak-ng's French rules take a "th" they do not know for
# English, and read "rythmes" as "rhythms", "authentique" as "authentic". In French "th" is said
# "t", so a word that looks French is given its "t" before espeak-ng reads it; one that does not
# (the, with, thread, path) is left to be read as an English word, in French sounds. Looks
# French: "thm" (rythme, algorithme; English writes "rhythm"), a letter English does not write,
# or a French ending.
FRENCH_TH = re.compile(
    r"\b(?=[\w'’-]*th)(?=[\w'’-]*(?:thm|[àâçèéêëîïôùûœ]|(?:iques?|ismes?|asmes?|ies?|tions?|iums?|ines?|maths?)\b))[\w'’-]+",
    re.IGNORECASE,
)


def spelled_for(text: str, lang: str) -> str:
    """`text` as espeak-ng is given it in `lang`: in French, each French word's "th" as "t"."""
    if lang != 'fr-fr':
        return text
    return FRENCH_TH.sub(lambda m: m.group(0).replace('th', 't').replace('Th', 'T').replace('TH', 'T').replace('tH', 't'), text)


def sounds_for(r: str, er: str, uh: str, ae: str, ei: str, ai: str, oi: str, au: str, schwa: str) -> list[tuple[str, str]]:
    """
    Each English sound and the nearest one of a language that says r as `r`, the "er" of "server"
    as `er`, the vowels of "bug", "back" and "about" as `uh`, `ae` and `schwa`, and the glides of
    "mail", "file", "boy" and "now" as `ei`, `ai`, `oi` and `au`. Longest first, so a vowel and
    its length, or an American vowel and its r, go as one.
    """
    return [
        ('ɑːɹ', 'a' + r), ('ɔːɹ', 'ɔ' + r), ('ɛɹ', 'ɛ' + r), ('ɪɹ', 'i' + r), ('ʊɹ', 'u' + r), ('əɹ', er),
        ('ɜː', er), ('ɝ', er), ('ɚ', er),
        ('eɪ', ei), ('aɪ', ai), ('ɔɪ', oi), ('aʊ', au), ('oʊ', 'o'), ('əʊ', 'o'),
        ('eə', 'ɛ' + r), ('ɪə', 'i' + r), ('ʊə', 'u' + r),
        ('iː', 'i'), ('uː', 'u'), ('ɑː', 'a'), ('ɔː', 'ɔ'),
        ('ɪ', 'i'), ('ᵻ', 'i'), ('ʊ', 'u'), ('ʌ', uh), ('æ', ae), ('ɒ', 'ɔ'), ('ɐ', 'a'), ('ə', schwa),
        ('ɾ', 't'), ('ɹ', r), ('θ', 't'), ('ð', 'd'), ('h', ''), ('ʔ', ''), ('ː', ''),
    ]


# An English word in a sentence of another language. espeak-ng's French, Italian, German, Dutch
# and Hindi rules read a list of English words (stress, design, parking, week-end, streaming) by
# English rules, with English sounds: an English r, English vowels, an h. A French or an Italian
# speaker keeps the English word but says it in their own sounds, so there each English sound is
# given the nearest one of the language: "stress" is "stʁɛs" in French, "streaming" "striming" in
# Italian. Not in German or Dutch, read by an English voice, nor in Hindi, whose speakers say
# English words as English; Spanish and Portuguese rules read every word as their own.
BORROWED = {
    'fr-fr': sounds_for(r='ʁ', er='œʁ', uh='œ', ae='a', ei='ɛ', ai='aj', oi='ɔj', au='aw', schwa='ə'),
    'it': sounds_for(r='r', er='er', uh='a', ae='ɛ', ei='ei', ai='ai', oi='ɔi', au='au', schwa='e'),
}


def borrowed(english: str, lang: str) -> str:
    """The sounds of an English word as a speaker of `lang` says it."""
    for sound, own in BORROWED[lang]:
        english = english.replace(sound, own)
    return english


def untied(sounds: str) -> str:
    """English sounds without their ties, the two said as one consonant kept as one symbol."""
    return sounds.replace('t^ʃ', 'ʧ').replace('d^ʒ', 'ʤ').replace('^', '')


@lru_cache(maxsize=4096)
def espeak(text: str, lang: str) -> str:
    """
    espeak-ng's sounds of `text` by `lang`'s rules, tied, its marks of another language whole;
    kept, as a word recurs from sentence to sentence. Called while the service makes one
    sentence at a time: espeak-ng cannot read two at once.
    """
    import phonemizer

    said = phonemizer.phonemize(text, lang, preserve_punctuation=True, with_stress=True, tie='^')
    return TIED_SWITCH.sub(lambda mark: mark.group(0).replace('^', ''), str(said).strip())


def phonemes_of(kokoro: Kokoro, text: str, lang: str) -> str:
    """
    The sounds of `text` read by `lang`'s rules, as the model knows them: the steps above.
    English is read as kokoro-onnx reads it, the way the English voices are known to sound.

    espeak-ng says an English word as a British speaker does, its r silent before a consonant
    ("parking" is "pɑːkɪŋ"), where a French speaker sounds the r. So a word read wholly as English
    is said by espeak-ng's American rules, which keep the r, before its sounds are made French.
    """
    if lang.startswith('en'):
        return SWITCH.sub('', kokoro.tokenizer.phonemize(text, lang))
    said = espeak(spelled_for(text, lang).replace('«', '“').replace('»', '”'), lang)
    american: dict[str, str] = {}
    if lang in BORROWED and '(en' in said:
        for word in set(re.findall(r"[\w'’-]+", text)):
            alone = SWITCH.split(espeak(word, lang))
            # '', the English sounds, '': the word is English from end to end.
            if len(alone) == 3 and alone[0] == '' and alone[2] == '':
                american[untied(alone[1])] = untied(espeak(word, 'en-us'))
    sounds, now = '', lang
    # The text between two marks, then the language the second mark turns to, and so on.
    for i, part in enumerate(re.split(r'\(([a-z]{2,3}(?:-[a-z]{2,4})?)\)', said)):
        if i % 2 == 1:
            now = part
        elif now.startswith('en') and lang in BORROWED:
            sounds += borrowed(american.get(untied(part), untied(part)), lang)
        else:
            for pair, one in JOINED:
                part = part.replace(pair, one)
            sounds += part
    vocab = kokoro.tokenizer.vocab
    return ''.join(sound for sound in (NEAREST.get(sound, sound) for sound in sounds) if sound in vocab).strip()


def word_languages(count: int, lang: str, english: Sequence[tuple[int, int]]) -> list[str]:
    """The rules each of a sentence's `count` words is read by: `lang`'s, or English's for the words `english` names."""
    langs = [lang] * count
    if not lang.startswith('en'):
        for start, end in english:
            for i in range(max(0, start), min(count, end)):
                langs[i] = 'en-us'
    return langs


def speak(
    kokoro: Kokoro, text: str, voice: str, speed: float, language: str = 'en', english: Sequence[tuple[int, int]] = ()
) -> tuple[np.ndarray, int, list[int]]:
    """
    The audio of `text` in `voice`, said in `language`, and when each of its words starts in it,
    in milliseconds. The words `english` names, as [from, to) among the words of `text`, are
    said in English in the same voice: an equation, a code name.
    """
    lang = accent(voice, language)
    words = text.split()
    langs = word_languages(len(words), lang, english)
    # Each run of words in one language is read whole, so its words run together as they should.
    runs: list[tuple[str, list[str]]] = []
    for word, word_lang in zip(words, langs):
        if runs and runs[-1][0] == word_lang:
            runs[-1][1].append(word)
        else:
            runs.append((word_lang, [word]))
    phonemes = ' '.join(filter(None, (phonemes_of(kokoro, ' '.join(run), run_lang) for run_lang, run in runs)))
    # No pauses added after the marks: the audio stays what the model makes, as without timings.
    samples, rate, spoken_sounds = kokoro.create_timed(
        phonemes, voice=voice, speed=speed, is_phonemes=True, sentence_pause=0.0, clause_pause=0.0
    )
    return samples, rate, word_starts(kokoro, text, phonemes, [t.start for t in spoken_sounds if t.phoneme != ' '], lang, langs)


def word_starts(
    kokoro: Kokoro, text: str, phonemes: str, sounds: list[float], lang: str = 'en-us', langs: Sequence[str] | None = None
) -> list[int]:
    """
    When each word of `text` starts, in milliseconds, from when each phoneme but the spaces does.

    The sentence's phonemes do not split into its words one for one: "42" is said as two words,
    and "of the" can run together as one. So each word is phonemized alone too, and the two
    strings of phonemes are lined up; a word starts where its first phoneme is heard. Each word
    is read by `lang`'s rules, or its own of `langs` where a sentence has words of two.
    """
    words = text.split()
    heard = phonemes.replace(' ', '')[: len(sounds)]
    if not words or not heard:
        return []
    alone = [phonemes_of(kokoro, word, langs[i] if langs else lang).replace(' ', '') for i, word in enumerate(words)]
    said = ''.join(alone)
    # Where each phoneme said alone is heard in the sentence. One not found ("a" alone is the
    # letter, in a sentence the article) is heard just after the one found before it, and no
    # later than the one found after it.
    found: list[int | None] = [None] * len(said)
    for a, b, size in SequenceMatcher(None, said, heard, autojunk=False).get_matching_blocks():
        for i in range(size):
            found[a + i] = b + i
    later = [len(heard) - 1] * (len(said) + 1)
    for i in reversed(range(len(said))):
        place = found[i]
        later[i] = place if place is not None else later[i + 1]
    at: list[int] = []
    for i, place in enumerate(found):
        at.append(place if place is not None else min(at[-1] + 1 if at else 0, later[i]))
    at.append(len(heard) - 1)
    starts, first = [], 0
    for phonemes_alone in alone:
        starts.append(round(sounds[at[first]] * 1000))
        first += len(phonemes_alone)
    return starts


def to_wav(samples: np.ndarray, rate: int) -> bytes:
    import numpy as np

    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype('<i2').tobytes()
    out = io.BytesIO()
    with wave.open(out, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return out.getvalue()


# --------------------------------------------------------------------------------------------
# The service
# --------------------------------------------------------------------------------------------


class Service:
    def __init__(self, data: Path, folder: Path, token: str) -> None:
        self.data = data
        self.token = token
        self.clips = Clips(folder)
        self.voice = Voice(mic_check())
        self.kokoro: Kokoro | None = None
        self.voices: set[str] = set()
        self.default_voice = 'af_heart'
        self.is_ready = False
        self.making = threading.Lock()  # one synthesis at a time: ONNX Runtime already uses every core
        self.last_request = time.monotonic()
        # Requests being answered now: a sentence still being made keeps the voice up, as a sound playing does.
        self.answering = 0
        self.answering_lock = threading.Lock()
        self.started_at = time.time()
        # The Claude Code sessions that said they are open, by id: when each last said so.
        self.sessions: dict[str, float] = {}
        self.sessions_lock = threading.Lock()
        self.had_session = False
        self.last_left = time.monotonic()

    def session(self, body: dict[str, Any]) -> None:
        """A session says it is open, or that it closed."""
        name = str(body.get('session') or '')[:100]
        if name == '':
            raise Refused(400, 'session is missing')
        now = time.monotonic()
        with self.sessions_lock:
            if body.get('open') is False:
                if self.sessions.pop(name, None) is not None:
                    self.last_left = now
            else:
                self.sessions[name] = now
                self.had_session = True

    def open_sessions(self) -> int:
        """How many sessions are open, forgetting those that went silent."""
        now = time.monotonic()
        with self.sessions_lock:
            for name, seen in list(self.sessions.items()):
                if now - seen > SESSION_TTL_S:
                    del self.sessions[name]
                    self.last_left = max(self.last_left, seen + SESSION_TTL_S)
            return len(self.sessions)

    def working(self, by: int) -> None:
        """Counts a request begun (by 1) or answered (by -1); either is the voice in use, now."""
        with self.answering_lock:
            self.answering += by
            self.last_request = time.monotonic()

    def is_working(self) -> bool:
        with self.answering_lock:
            return self.answering > 0

    def alone_for(self) -> float | None:
        """Seconds since the last session went; None while one is open, or none ever was (started by the installer)."""
        if self.open_sessions() > 0 or not self.had_session:
            return None
        with self.sessions_lock:
            return time.monotonic() - self.last_left

    def load(self, model: Path, voices: Path) -> None:
        started = time.monotonic()
        if model.exists() and voices.exists():
            self.kokoro = load(model, voices)
            self.voices = set(self.kokoro.voices.files)
            self.default_voice = 'af_heart' if 'af_heart' in self.voices else sorted(self.voices)[0]
            self.kokoro.create('Ready.', voice=self.default_voice, speed=1.0, lang='en-us')
            log(f'model loaded and warmed in {time.monotonic() - started:.1f}s; voices: {", ".join(sorted(self.voices))}')
        else:
            log(f'no voice model in {self.data}: playing only, for a speech server of the user\'s own')
        self.is_ready = True

    def health(self) -> dict[str, Any]:
        return {
            'status': 'healthy' if self.is_ready else 'loading',
            'service': 'readalong',
            'version': VERSION,
            'protocol': PROTOCOL,
            'model': self.kokoro is not None,
            'timed': bool(getattr(self.kokoro, 'has_timings', False)),
            'voices': sorted(self.voices),
            'since': int(self.started_at),
            'sessions': self.open_sessions(),
            'pid': os.getpid(),
        }

    def synthesize(
        self, text: str, voice: str, speed: float, language: str = 'en', english: Sequence[tuple[int, int]] = ()
    ) -> tuple[bytes, list[int]]:
        if self.kokoro is None:
            raise Refused(503, 'the voice model is not installed', 'no-model')
        if voice not in self.voices:
            raise Refused(400, f'unknown voice "{voice}"; this voice has {", ".join(sorted(self.voices))}', 'unknown-voice')
        try:
            with self.making:
                samples, rate, starts = speak(self.kokoro, text, voice, speed, language, english)
        except Exception as err:  # a phonemizer or runtime failure on odd input
            raise Refused(500, f'synthesis failed: {err}') from err
        return to_wav(samples, rate), starts

    def clip(self, body: dict[str, Any]) -> dict[str, Any]:
        text, voice, speed = spoken(body, self.default_voice)
        language, english = language_of(body), english_of(body)
        upstream = str(body.get('upstream') or '').strip()
        key = (text, voice, speed, language, english, upstream)
        clip = self.clips.find(key)
        if clip is None or not clip.path.exists():
            audio, words = from_upstream(upstream, text, voice, speed) if upstream else self.synthesize(text, voice, speed, language, english)
            clip = self.clips.add(key, audio, words)
        return {'clip': clip.id, 'words': clip.words, 'ms': clip.ms}

    def play(self, body: dict[str, Any]) -> dict[str, Any]:
        owner = str(body.get('owner') or '')
        wanted = str(body.get('player') or 'auto')
        if owner == '':
            raise Refused(400, 'owner is missing')
        if wanted != 'auto' and wanted not in PLAYER_SETTINGS:
            raise Refused(400, f'unknown player "{wanted}"')
        if 'sound' in body:
            path, seconds = self.data / 'chime.wav', 0.6
            if body['sound'] != 'chime' or not path.exists():
                raise Refused(404, 'no such sound', 'unknown-sound')
        else:
            clip = self.clips.get(str(body.get('clip') or ''))
            if clip is None or not clip.path.exists():
                raise Refused(404, 'no such clip', 'unknown-clip')
            path, seconds = clip.path, clip.ms / 1000
        play = self.voice.play(path, seconds, owner, wanted, body.get('overlay') is True)
        return {'play': play.id, 'state': play.state, 'error': play.error}

    def wait(self, body: dict[str, Any]) -> dict[str, Any]:
        try:
            seconds = float(body.get('seconds', MAX_WAIT_S))
        except (TypeError, ValueError):
            seconds = MAX_WAIT_S
        play = self.voice.wait(str(body.get('play') or ''), seconds)
        if play is None:
            raise Refused(404, 'no such play', 'unknown-play')
        return {'state': play.state, 'error': play.error}


def language_of(body: dict[str, Any]) -> str:
    """The language a request asks its text to be said in: English when it names none."""
    language = str(body.get('lang') or 'en')
    if language not in LANGUAGES:
        raise Refused(400, f'unknown language "{language}"; this voice reads {", ".join(LANGUAGES)}', 'unknown-language')
    return language


def english_of(body: dict[str, Any]) -> tuple[tuple[int, int], ...]:
    """The words a request asks to be said in English, in a sentence of another language: [from, to) pairs."""
    named = body.get('english') or []
    try:
        return tuple((int(start), int(end)) for start, end in named)
    except (TypeError, ValueError):
        raise Refused(400, 'english is not a list of [from, to] pairs of word numbers') from None


def spoken(body: dict[str, Any], default_voice: str) -> tuple[str, str, float]:
    """What a request asks to be said: its text, voice and speed."""
    text = str(body.get('input', '')).strip()[:MAX_INPUT]
    voice = str(body.get('voice') or default_voice)
    try:
        speed = min(2.0, max(0.5, float(body.get('speed', 1.0))))  # the range kokoro-onnx accepts
    except (TypeError, ValueError):
        raise Refused(400, 'speed is not a number') from None
    if text == '':
        raise Refused(400, 'input is empty')
    return text, voice, speed


def handler_for(service: Service, stop: Callable[[], None]) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'

        def do_GET(self) -> None:
            if not self.is_local():
                return self.fail(403, 'not from this computer')
            if self.path.rstrip('/') == '/health':
                self.answer(200 if service.is_ready else 503, service.health())
            else:
                self.fail(404, 'not found')

        def do_POST(self) -> None:
            # A session saying it is open asks for nothing: it does not keep an idle voice up.
            is_reading = self.path.rstrip('/') != '/v1/session'
            if is_reading:
                service.working(1)
            try:
                self.post()
            finally:
                if is_reading:
                    service.working(-1)

        def post(self) -> None:
            route = self.path.rstrip('/')
            try:
                length = int(self.headers.get('Content-Length', '0'))
            except ValueError:
                length = -1
            if not self.is_local() or length < 0 or length > MAX_BODY:
                self.close_connection = True  # its body is left unread
                if length < 0:
                    return self.fail(400, 'Content-Length is not a number')
                return self.fail(413, 'the body is too large') if length > MAX_BODY else self.fail(403, 'not from this computer')
            try:
                body = json.loads(self.rfile.read(length) or b'{}')
            except ValueError:
                return self.fail(400, 'the body is not JSON')
            if not isinstance(body, dict):
                return self.fail(400, 'the body is not a JSON object')
            is_open = route == '/v1/audio/speech'
            if not is_open and not secrets.compare_digest(self.headers.get('X-Readalong-Token', ''), service.token):
                return self.fail(401, 'the X-Readalong-Token header is missing or wrong', 'token')
            if route == '/v1/shutdown':
                self.answer(200, {})
                threading.Thread(target=stop, daemon=True).start()
                return
            if route == '/v1/session':
                try:
                    service.session(body)
                except Refused as err:
                    return self.fail(err.status, str(err), err.code)
                return self.answer(200, {'sessions': service.open_sessions()})
            if not service.is_ready:
                return self.fail(503, 'the voice is still loading', 'loading')
            owner = '' if is_open else str(body.get('owner') or '')
            service.voice.asks(owner, 1)
            try:
                if is_open:
                    self.speech(body)
                elif route == '/v1/clips':
                    self.answer(200, service.clip(body))
                elif route == '/v1/play':
                    self.answer(200, service.play(body))
                elif route == '/v1/wait':
                    self.answer(200, service.wait(body))
                elif route == '/v1/stop':
                    service.voice.stop(owner)
                    self.answer(200, {})
                elif route == '/v1/claim':
                    if owner == '':
                        raise Refused(400, 'owner is missing')
                    granted, reason = service.voice.claim(owner, body.get('yields') is True)
                    self.answer(200, {'granted': granted, **({'reason': reason} if reason else {})})
                elif route == '/v1/release':
                    service.voice.release(owner)
                    self.answer(200, {})
                else:
                    self.fail(404, 'not found')
            except Refused as err:
                self.fail(err.status, str(err), err.code)
            except Exception as err:
                self.fail(500, f'{type(err).__name__}: {err}')
            finally:
                service.voice.asks(owner, -1)
                service.last_request = time.monotonic()

        def speech(self, body: dict[str, Any]) -> None:
            text, voice, speed = spoken(body, service.default_voice)
            if str(body.get('response_format') or 'wav') != 'wav':
                raise Refused(400, 'only response_format "wav" is supported')
            audio, starts = service.synthesize(text, voice, speed, language_of(body), english_of(body))
            self.reply(200, 'audio/wav', audio, {'X-Word-Starts': ','.join(map(str, starts))} if starts else {})

        def is_local(self) -> bool:
            """
            Whether the request was written on this computer for this service: a web page that
            reaches 127.0.0.1 names its own site as the origin, or another name as the host.
            """
            host = self.headers.get('Host', '')
            name = host if host.endswith(']') else host.rsplit(':', 1)[0]
            if name.strip('[]').lower() not in ('127.0.0.1', 'localhost', '::1'):
                return False
            origin = self.headers.get('Origin', '').lower()
            if origin.startswith(('http://', 'https://')):
                site = origin.split('://', 1)[1]
                site = site if site.endswith(']') else site.rsplit(':', 1)[0]
                return site.strip('[]') in ('127.0.0.1', 'localhost', '::1')
            return True

        def answer(self, status: int, data: dict[str, Any]) -> None:
            self.reply(status, 'application/json', json.dumps(data).encode())

        def fail(self, status: int, message: str, code: str = '') -> None:
            self.answer(status, {'error': message, 'code': code})

        def reply(self, status: int, kind: str, data: bytes, headers: dict[str, str] | None = None) -> None:
            try:
                self.send_response(status)
                self.send_header('Content-Type', kind)
                self.send_header('Content-Length', str(len(data)))
                for name, value in (headers or {}).items():
                    self.send_header(name, value)
                self.end_headers()
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionError):
                self.close_connection = True  # the client went away

        def log_message(self, format: str, *args: object) -> None:
            pass  # quiet: the plugin reports errors itself

    return Handler


def token_of(data: Path) -> str:
    """The token requests must carry: $READALONG_TOKEN, else the one kept in the data folder, made once."""
    given = os.environ.get('READALONG_TOKEN', '').strip()
    if given:
        return given
    path = data / 'token'
    try:
        kept = path.read_text().strip()
        if kept:
            return kept
    except OSError:
        pass
    made = secrets.token_urlsafe(32)
    # Created for the user alone, not narrowed afterwards.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as out:
        out.write(made)
    return made


def sweep(pattern: str, hours: float) -> None:
    """Removes the audio folders that services which ended without tidying up left behind."""
    for folder in Path(tempfile.gettempdir()).glob(pattern):
        try:
            if folder.is_dir() and time.time() - folder.stat().st_mtime > hours * 3600:
                shutil.rmtree(folder, ignore_errors=True)
        except OSError:
            pass


# How often a running service looks whether it was uninstalled, in seconds.
WATCH_S = 5
# The plugin whose data folder the voice lives in, as Claude Code lists it: `readalong@<marketplace>`.
PLUGIN = 'readalong'


def is_listed(data: Path) -> bool | None:
    """
    Whether Claude Code lists the plugin as installed; None when that cannot be told: `data` is
    not a plugin's data folder (<Claude Code's folder>/plugins/data/<plugin>), or the list cannot
    be read right now.
    """
    plugins = data.parent.parent
    if data.parent.name != 'data' or plugins.name != 'plugins':
        return None
    try:
        listed = json.loads((plugins / 'installed_plugins.json').read_text(encoding='utf-8')).get('plugins', {})
    except (OSError, ValueError, AttributeError):
        return None
    return any(name.split('@')[0] == PLUGIN and installs for name, installs in listed.items())


def finish_removal(data: Path) -> None:
    """
    Removes what an uninstall of the plugin left of its data folder. Claude Code removes that
    folder itself, but a file in use stays (Windows): the running voice's own. A folder left
    whole was kept on purpose (`claude plugin uninstall --keep-data`) and stays.
    """
    is_whole = (data / 'ready.json').exists() and (data / 'chime.wav').exists()
    if is_whole or data.parent.name != 'data' or not data.name.startswith(PLUGIN) or not data.is_dir():
        return
    if not IS_WINDOWS:
        return shutil.rmtree(data, ignore_errors=True)
    # This process holds its Python, its log and the folder itself until it has ended, so another
    # removes the folder after it: cmd, which every Windows has, trying each second until it is gone.
    folder = f'"{data}"'
    attempt = f'ping -n 2 127.0.0.1 >nul & rmdir /s /q {folder} 2>nul & if not exist {folder} exit'
    popen_detached(f'cmd.exe /d /s /c "for /l %i in (1,1,30) do ({attempt})"', cwd=tempfile.gettempdir())


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request: Any, client_address: Any) -> None:
        # A client that closed its connection, as a session that ended or a wait given up does: nothing
        # went wrong here, and a traceback in the log for each would hide what did.
        if isinstance(sys.exc_info()[1], (ConnectionError, TimeoutError)):
            return
        super().handle_error(request, client_address)


def run(args: argparse.Namespace) -> int:
    data: Path = args.data.resolve()
    data.mkdir(parents=True, exist_ok=True)
    if not IS_WINDOWS:
        # ONNX Runtime keeps a device id in the user's cache folder; here it goes with the voice.
        os.environ['XDG_CACHE_HOME'] = str(data / '.cache')
    try:
        server = Server(('127.0.0.1', args.port), BaseHTTPRequestHandler)
    except OSError as err:
        log(f'port {args.port} cannot be used ({err})')
        return EXIT_PORT_TAKEN
    try:
        os.nice(10)  # reading aloud should not slow the work it reads about
    except (AttributeError, OSError):
        pass
    sweep('readalong-clips-*', 12)
    sweep('readalong.*', 12)  # as the unreleased first readalong named them
    folder = Path(tempfile.mkdtemp(prefix='readalong-clips-'))
    service = Service(data, folder, token_of(data))
    stopped = threading.Event()

    def stop() -> None:
        service.voice.stop_all()
        server.shutdown()
        stopped.set()

    server.RequestHandlerClass = handler_for(service, stop)
    signal.signal(signal.SIGTERM, lambda *_: threading.Thread(target=stop, daemon=True).start())

    def stop_when_idle() -> None:
        while not stopped.wait(5):
            # A sound playing, or a request being answered (a long sentence being made), is use.
            if service.voice.is_busy() or service.is_working():
                service.last_request = time.monotonic()
                continue
            alone = service.alone_for()
            if alone is not None and alone >= SESSION_GRACE_S:
                log('no Claude Code session is open any more; stopping')
                return stop()
            if args.idle_minutes > 0 and time.monotonic() - service.last_request > args.idle_minutes * 60:
                log(f'nothing read for {args.idle_minutes:g} minutes; stopping (the next press starts it again)')
                return stop()

    is_uninstalled = False

    def stop_when_uninstalled() -> None:
        nonlocal is_uninstalled
        # Only a plugin seen installed can be seen removed: setup installs the voice before the plugin.
        was_listed = False
        while True:
            listed = is_listed(data)
            if not data.is_dir() or not Path(__file__).is_file() or (was_listed and listed is False):
                is_uninstalled = True
                log('readalong was uninstalled; stopping')
                return stop()
            was_listed = was_listed or listed is True
            if stopped.wait(WATCH_S):
                return

    # Answering from the start, so one that asks while the model loads is told so, not refused.
    threading.Thread(target=server.serve_forever, daemon=True).start()
    log(f'readalong {VERSION} listening on http://127.0.0.1:{args.port}')
    try:
        threading.Thread(target=stop_when_uninstalled, daemon=True).start()
        service.load(data / args.model, data / args.voices)
        threading.Thread(target=stop_when_idle, daemon=True).start()
        threading.Thread(target=service.voice.watch_mic, args=(stopped,), daemon=True).start()
        while not stopped.wait(0.5):
            pass
    except KeyboardInterrupt:
        pass
    finally:
        service.voice.stop_all()
        server.server_close()
        shutil.rmtree(folder, ignore_errors=True)
        if is_uninstalled:
            finish_removal(data)
    return 0


# --------------------------------------------------------------------------------------------
# Starting and stopping it, for the plugin and the installer
# --------------------------------------------------------------------------------------------


def probe(url: str, timeout: float = 1.0) -> tuple[int, dict[str, Any]] | None:
    """What URL/health answers: its status and what it says; None when nothing answers."""
    try:
        with urllib.request.urlopen(f'{url.rstrip("/")}/health', timeout=timeout) as response:
            status, text = response.status, response.read(1 << 16)
    except urllib.error.HTTPError as err:
        status, text = err.code, err.read(1 << 16)
    except (urllib.error.URLError, OSError, ValueError):
        return None
    try:
        said = json.loads(text)
    except ValueError:
        said = {}
    return status, said if isinstance(said, dict) else {}


def is_ours(answer: tuple[int, dict[str, Any]] | None) -> bool:
    return answer is not None and answer[1].get('service') == 'readalong'


def is_ready(answer: tuple[int, dict[str, Any]] | None) -> bool:
    return is_ours(answer) and answer is not None and answer[0] == 200


def popen_detached(command: list[str] | str, **options: Any) -> subprocess.Popen[bytes]:
    """Starts a process that outlives this one and the session that asked for it."""
    options = {'stdin': subprocess.DEVNULL, 'stdout': subprocess.DEVNULL, 'stderr': subprocess.DEVNULL, 'close_fds': True, **options}
    if not IS_WINDOWS:
        return subprocess.Popen(command, start_new_session=True, **options)
    flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.BELOW_NORMAL_PRIORITY_CLASS
    try:
        # Out of the job of whoever started this, where that is allowed: a job may end its members with it.
        return subprocess.Popen(command, creationflags=flags | subprocess.CREATE_BREAKAWAY_FROM_JOB, **options)
    except OSError:
        return subprocess.Popen(command, creationflags=flags, **options)


def tail(path: Path, lines: int = 12) -> str:
    try:
        return '\n'.join(path.read_text(errors='replace').splitlines()[-lines:])
    except OSError:
        return ''


# install.py's lock, held while an install or an update changes the folder, and how long its
# holder may go without touching it before it counts as gone. Read here as install.py reads it:
# the installed folder holds serve.py alone.
INSTALL_LOCK = '.installing'
INSTALL_LOCK_STALE_S = 30 * 60


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


def is_installing(data: Path) -> bool:
    """Whether an install or an update is changing the folder now: its lock is there, fresh, and its holder alive."""
    lock = data / INSTALL_LOCK
    try:
        if time.time() - lock.stat().st_mtime >= INSTALL_LOCK_STALE_S:
            return False
        return is_alive(int(lock.read_text().strip() or '0'))
    except (OSError, ValueError):
        return False


def start(args: argparse.Namespace) -> int:
    """
    Starts the service in the background, unless one answers already, and waits until it is ready.
    While an install or an update changes the folder (another session's, at its start), it waits
    for that first: a voice started from files half replaced would fail, or be stopped by it.
    """
    data: Path = args.data.resolve()
    url = f'http://127.0.0.1:{args.port}'
    deadline = time.monotonic() + args.seconds
    while is_installing(data):
        if time.monotonic() >= deadline:
            print('the voice is being installed or updated; it is ready in a minute or two', file=sys.stderr)
            return 1
        time.sleep(0.2)
    answer = probe(url)
    if is_ready(answer):
        return 0
    if answer is not None and not is_ours(answer):
        print(f'port {args.port} is used by another program', file=sys.stderr)
        return 1
    proc = None
    log_path = data / 'server.log'
    if answer is None:
        data.mkdir(parents=True, exist_ok=True)
        try:
            if log_path.stat().st_size > 1 << 20:
                log_path.unlink()
        except OSError:
            pass
        command = [sys.executable, '-I', str(Path(__file__).resolve()), 'run', '--data', str(data), '--port', str(args.port)]
        with open(log_path, 'ab') as out:
            proc = popen_detached(command, cwd=str(data), stdout=out, stderr=out)
    # One budget for the whole start, the wait for an install included, so the caller's own timeout is never passed.
    deadline = max(deadline, time.monotonic() + 15)
    while time.monotonic() < deadline:
        if is_ready(probe(url)):
            return 0
        code = None if proc is None else proc.poll()
        # One that found the port taken lost a race with another session's: that one is awaited.
        if code is not None and code != EXIT_PORT_TAKEN:
            print(f'the voice stopped as it started (exit {code}):\n{tail(log_path)}', file=sys.stderr)
            return 1
        time.sleep(0.2)
    if proc is not None and proc.poll() == EXIT_PORT_TAKEN and not is_ours(probe(url)):
        print(f'port {args.port} is used by another program', file=sys.stderr)
    else:
        print(f'the voice did not answer within {args.seconds:g} seconds:\n{tail(log_path)}', file=sys.stderr)
    return 1


def stop(args: argparse.Namespace) -> int:
    """Asks the service on this port to stop, and waits until it has. None running is success."""
    url = f'http://127.0.0.1:{args.port}'
    if not is_ours(probe(url)):
        return 0
    try:
        request = urllib.request.Request(
            f'{url}/v1/shutdown',
            data=b'{}',
            headers={'Content-Type': 'application/json', 'X-Readalong-Token': token_of(args.data.resolve())},
        )
        urllib.request.urlopen(request, timeout=5).close()
    except (urllib.error.URLError, OSError) as err:
        print(f'the voice on port {args.port} did not take the request to stop ({err})', file=sys.stderr)
        return 1
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if probe(url, 0.5) is None:
            return 0
        time.sleep(0.1)
    print(f'the voice on port {args.port} is still answering', file=sys.stderr)
    return 1


def spawn(args: argparse.Namespace) -> int:
    """Runs a shell command of the user's in the background: the start command of a server of their own."""
    popen_detached(args.shell_command, shell=True)
    return 0


def wait(args: argparse.Namespace) -> int:
    deadline = time.monotonic() + args.seconds
    while True:
        answer = probe(args.url)
        if answer is not None and 200 <= answer[0] < 300:
            return 0
        if time.monotonic() >= deadline:
            return 1
        time.sleep(0.5)


def log(message: str) -> None:
    print(f'[readalong {time.strftime("%H:%M:%S")}] {message}', file=sys.stderr, flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description='The readalong service.')
    commands = parser.add_subparsers(dest='command', required=True)

    def served(name: str, about: str) -> argparse.ArgumentParser:
        sub = commands.add_parser(name, help=about)
        sub.add_argument('--data', type=Path, required=True, help='folder holding the model and voice files')
        sub.add_argument('--port', type=int, default=int(os.environ.get('READALONG_PORT') or DEFAULT_PORT))
        return sub

    running = served('run', 'the service, in the foreground')
    running.add_argument('--model', default='kokoro-v1.0.onnx')
    running.add_argument('--voices', default='voices.npz')
    running.add_argument('--idle-minutes', type=float, default=float(os.environ.get('READALONG_IDLE_MINUTES') or 30))
    running.set_defaults(act=run)
    starting = served('start', 'start the service in the background and wait until it answers')
    starting.add_argument('--seconds', type=float, default=60)
    starting.set_defaults(act=start)
    served('stop', 'stop the running service').set_defaults(act=stop)
    spawning = commands.add_parser('spawn', help='run a shell command in the background')
    spawning.add_argument('shell_command')
    spawning.set_defaults(act=spawn)
    waiting = commands.add_parser('wait', help='wait until URL/health answers')
    waiting.add_argument('url')
    waiting.add_argument('--seconds', type=float, default=60)
    waiting.set_defaults(act=wait)
    args = parser.parse_args()
    return int(args.act(args))


if __name__ == '__main__':
    sys.exit(main())
