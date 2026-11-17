"""Tests of the readalong service that need no voice model: run on Linux, macOS and Windows alike.

    python -m unittest discover -s server -p 'test_*.py'

The service is started as the plugin starts it, on a free port, with a silent player
(READALONG_PLAYER=null) that takes a sound's length to play it. Sentences are made by a small
speech server of the test's own, as for a user who brings their own.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import unittest.mock
import urllib.error
import urllib.request
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
SERVE = HERE / 'serve.py'
CHIME = HERE.parent / 'assets' / 'chime.wav'


def free_port() -> int:
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def silence(ms: int) -> bytes:
    out = io.BytesIO()
    with wave.open(out, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(b'\0\0' * (24 * ms))
    return out.getvalue()


class Upstream(BaseHTTPRequestHandler):
    """A speech server of the user's own: half a second of silence per sentence, its words timed."""

    def do_POST(self) -> None:
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if body.get('voice') == 'missing':
            self.send_response(400)
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        # A voice that takes its time: a sentence still being made when the voice would idle out.
        if body.get('voice') == 'slow':
            time.sleep(8)
        # A sentence that says it is long plays long enough for the microphone to start meanwhile.
        audio = silence(3000 if 'long' in str(body['input']).lower() else 500)
        starts = ','.join(str(i * 100) for i, _ in enumerate(str(body['input']).split()))
        self.send_response(200)
        self.send_header('Content-Type', 'audio/wav')
        self.send_header('X-Word-Starts', starts)
        self.send_header('Content-Length', str(len(audio)))
        self.end_headers()
        self.wfile.write(audio)

    def log_message(self, *args: object) -> None:
        pass


class ServiceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.data = Path(tempfile.mkdtemp(prefix='readalong-test-'))
        shutil.copyfile(CHIME, cls.data / 'chime.wav')
        cls.port = free_port()
        cls.url = f'http://127.0.0.1:{cls.port}'
        # The microphone records while this file exists.
        cls.mic = cls.data / 'mic-on'
        cls.env = {**os.environ, 'READALONG_PLAYER': 'null', 'READALONG_IDLE_MINUTES': '5', 'READALONG_MIC': f'file:{cls.mic}'}
        cls.env.pop('READALONG_TOKEN', None)
        cls.upstream = ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
        threading.Thread(target=cls.upstream.serve_forever, daemon=True).start()
        cls.upstream_url = f'http://127.0.0.1:{cls.upstream.server_address[1]}'
        started = cls.serve('start', '--data', str(cls.data), '--port', str(cls.port))
        if started.returncode != 0:
            raise RuntimeError(f'the service did not start: {started.stderr}')
        cls.token = (cls.data / 'token').read_text().strip()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.serve('stop', '--data', str(cls.data), '--port', str(cls.port))
        cls.upstream.shutdown()
        shutil.rmtree(cls.data, ignore_errors=True)

    @classmethod
    def serve(cls, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run([sys.executable, '-I', str(SERVE), *args], capture_output=True, text=True, env=cls.env, timeout=90, check=False)

    def ask(self, route: str, body: dict, headers: dict | None = None) -> tuple[int, dict]:
        request = urllib.request.Request(
            f'{self.url}{route}',
            data=json.dumps(body).encode(),
            headers={'Content-Type': 'application/json', 'X-Readalong-Token': self.token, **(headers or {})},
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as err:
            return err.code, json.loads(err.read() or b'{}')

    def clip(self, text: str = 'One two three.') -> dict:
        status, made = self.ask('/v1/clips', {'input': text, 'voice': 'af_heart', 'speed': 1, 'upstream': self.upstream_url})
        self.assertEqual(status, 200, made)
        return made

    def wait(self, play: str, owner: str, seconds: float = 10) -> str:
        status, said = self.ask('/v1/wait', {'play': play, 'owner': owner, 'seconds': seconds})
        self.assertEqual(status, 200, said)
        return said['state']

    def test_health_names_the_service(self) -> None:
        with urllib.request.urlopen(f'{self.url}/health', timeout=5) as response:
            said = json.loads(response.read())
        self.assertEqual(said['service'], 'readalong')
        self.assertEqual(said['protocol'], 6)
        self.assertFalse(said['model'])

    def test_a_second_start_finds_it_running(self) -> None:
        self.assertEqual(self.serve('start', '--data', str(self.data), '--port', str(self.port)).returncode, 0)

    def test_the_token_is_the_users_alone(self) -> None:
        if os.name != 'nt':
            self.assertEqual((self.data / 'token').stat().st_mode & 0o777, 0o600)
        status, said = self.ask('/v1/claim', {'owner': 'x'}, {'X-Readalong-Token': 'wrong'})
        self.assertEqual((status, said['code']), (401, 'token'))

    def test_a_web_page_is_refused(self) -> None:
        status, _ = self.ask('/v1/claim', {'owner': 'x'}, {'Origin': 'https://example.com'})
        self.assertEqual(status, 403)
        status, _ = self.ask('/v1/claim', {'owner': 'x'}, {'Host': 'example.com'})
        self.assertEqual(status, 403)

    def test_a_sentence_is_made_once_and_kept(self) -> None:
        first = self.clip('Made once, kept after.')
        again = self.clip('Made once, kept after.')
        self.assertEqual(first['clip'], again['clip'])
        self.assertEqual(first['words'], [0, 100, 200, 300])
        self.assertEqual(first['ms'], 500)

    def test_a_server_that_refuses_says_so(self) -> None:
        status, said = self.ask('/v1/clips', {'input': 'Hi.', 'voice': 'missing', 'upstream': self.upstream_url})
        self.assertEqual((status, said['code']), (502, 'upstream-refused'))
        status, said = self.ask('/v1/clips', {'input': 'Hi.', 'upstream': f'http://127.0.0.1:{free_port()}'})
        self.assertEqual((status, said['code']), (502, 'upstream-down'))

    def test_a_language_the_voice_does_not_read_is_refused(self) -> None:
        status, said = self.ask('/v1/clips', {'input': 'こんにちは。', 'voice': 'af_heart', 'lang': 'ja'})
        self.assertEqual((status, said['code']), (400, 'unknown-language'))

    def test_without_the_model_the_bundled_voice_is_missing(self) -> None:
        status, said = self.ask('/v1/clips', {'input': 'Hi.', 'voice': 'af_heart'})
        self.assertEqual((status, said['code']), (503, 'no-model'))

    def test_a_reading_plays_to_its_end(self) -> None:
        made = self.clip('Played to its end.')
        self.assertTrue(self.ask('/v1/claim', {'owner': 'end', 'yields': False})[1]['granted'])
        status, play = self.ask('/v1/play', {'clip': made['clip'], 'owner': 'end'})
        self.assertEqual((status, play['state']), (200, 'playing'))
        started = time.monotonic()
        self.assertEqual(self.wait(play['play'], 'end'), 'done')
        self.assertGreater(time.monotonic() - started, 0.3)
        self.ask('/v1/release', {'owner': 'end'})

    def test_only_the_reading_heard_plays_and_a_stop_ends_it(self) -> None:
        made = self.clip('Only one at a time.')
        status, said = self.ask('/v1/play', {'clip': made['clip'], 'owner': 'nobody'})
        self.assertEqual((status, said['code']), (409, 'not-heard'))
        self.ask('/v1/claim', {'owner': 'a', 'yields': False})
        _, play = self.ask('/v1/play', {'clip': made['clip'], 'owner': 'a'})
        self.ask('/v1/stop', {'owner': 'a'})
        self.assertEqual(self.wait(play['play'], 'a'), 'stopped')
        self.ask('/v1/release', {'owner': 'a'})

    def test_an_answer_read_automatically_gives_way_and_a_press_takes_the_voice(self) -> None:
        made = self.clip('Heard first.')
        self.ask('/v1/claim', {'owner': 'first', 'yields': False})
        _, play = self.ask('/v1/play', {'clip': made['clip'], 'owner': 'first'})
        self.assertFalse(self.ask('/v1/claim', {'owner': 'auto', 'yields': True})[1]['granted'])
        # The chime of the answer that gave way sounds over the reading, which plays on.
        _, chime = self.ask('/v1/play', {'sound': 'chime', 'owner': 'auto', 'overlay': True})
        self.assertEqual(chime['state'], 'playing')
        self.assertTrue(self.ask('/v1/claim', {'owner': 'press', 'yields': False})[1]['granted'])
        self.assertEqual(self.wait(play['play'], 'first'), 'taken')
        self.ask('/v1/release', {'owner': 'press'})
        # With nothing heard, an answer read automatically may be.
        self.assertTrue(self.ask('/v1/claim', {'owner': 'later', 'yields': True})[1]['granted'])
        self.ask('/v1/release', {'owner': 'later'})

    def test_a_reading_between_sentences_is_still_heard(self) -> None:
        self.ask('/v1/claim', {'owner': 'reader', 'yields': False})
        self.assertFalse(self.ask('/v1/claim', {'owner': 'other', 'yields': True})[1]['granted'])
        self.ask('/v1/release', {'owner': 'reader'})
        self.assertTrue(self.ask('/v1/claim', {'owner': 'other', 'yields': True})[1]['granted'])
        self.ask('/v1/release', {'owner': 'other'})

    def test_a_microphone_that_starts_recording_stops_the_reading_for_good(self) -> None:
        made = self.clip('A long sentence, read while the microphone starts.')
        self.ask('/v1/claim', {'owner': 'dictated', 'yields': False})
        _, play = self.ask('/v1/play', {'clip': made['clip'], 'owner': 'dictated'})
        try:
            time.sleep(0.8)  # the microphone is seen off first
            self.mic.touch()
            started = time.monotonic()
            self.assertEqual(self.wait(play['play'], 'dictated'), 'mic')
            self.assertLess(time.monotonic() - started, 1.5)
            for route, body in (('/v1/play', {'clip': made['clip'], 'owner': 'dictated'}), ('/v1/claim', {'owner': 'dictated', 'yields': False})):
                status, said = self.ask(route, body)
                self.assertEqual((status, said.get('code')), (409, 'mic'), route)
            # While it records, an answer read automatically is not; a press is.
            self.assertEqual(self.ask('/v1/claim', {'owner': 'auto', 'yields': True})[1], {'granted': False, 'reason': 'mic'})
            self.assertTrue(self.ask('/v1/claim', {'owner': 'press', 'yields': False})[1]['granted'])
            _, pressed = self.ask('/v1/play', {'clip': self.clip('Read during a call.')['clip'], 'owner': 'press'})
            self.assertEqual(self.wait(pressed['play'], 'press'), 'done')
            self.ask('/v1/release', {'owner': 'press'})
        finally:
            self.mic.unlink(missing_ok=True)

    def test_a_reading_with_the_microphone_off_plays_on(self) -> None:
        made = self.clip('A long sentence, with nobody recording.')
        self.ask('/v1/claim', {'owner': 'quiet', 'yields': False})
        _, play = self.ask('/v1/play', {'clip': made['clip'], 'owner': 'quiet'})
        self.assertEqual(self.wait(play['play'], 'quiet'), 'done')
        self.ask('/v1/release', {'owner': 'quiet'})


class MicCheckTest(unittest.TestCase):
    def test_recording_the_speakers_is_not_a_microphone(self) -> None:
        sys.path.insert(0, str(HERE))
        try:
            import serve
        finally:
            sys.path.pop(0)

        def node(kind: str, **props: object) -> dict:
            return {'type': 'PipeWire:Interface:Node', 'info': {'state': 'running', 'props': {'media.class': kind, **props}}}

        # A screen recorder taking the desktop's sound (as ffmpeg and OBS do through PipeWire).
        self.assertFalse(serve.is_recording(node('Stream/Input/Audio', **{'stream.capture.sink': True})))
        self.assertFalse(serve.is_recording(node('Stream/Input/Audio', **{'target.object': 'speakers.monitor'})))
        # A program recording a microphone, and the microphone itself.
        self.assertTrue(serve.is_recording(node('Stream/Input/Audio', **{'target.object': 'alsa_input.mic'})))
        self.assertTrue(serve.is_recording(node('Stream/Input/Audio')))
        self.assertTrue(serve.is_recording(node('Audio/Source')))
        # Nothing records while idle.
        idle = node('Stream/Input/Audio')
        idle['info']['state'] = 'suspended'
        self.assertFalse(serve.is_recording(idle))

    def test_this_system_can_be_asked_whether_a_microphone_records(self) -> None:
        sys.path.insert(0, str(HERE))
        try:
            import serve
        finally:
            sys.path.pop(0)
        saved = os.environ.pop('READALONG_MIC', None)
        try:
            check = serve.mic_check()
            self.assertIn(check(), (True, False, None))
        finally:
            if saved is not None:
                os.environ['READALONG_MIC'] = saved


class InstallLockTest(unittest.TestCase):
    def setUp(self) -> None:
        sys.path.insert(0, str(HERE))
        try:
            import install
        finally:
            sys.path.pop(0)
        self.install = install
        self.home = Path(tempfile.mkdtemp(prefix='readalong-lock-'))

    def tearDown(self) -> None:
        shutil.rmtree(self.home, ignore_errors=True)

    def test_one_install_at_a_time(self) -> None:
        first, second = self.install.Lock(self.home), self.install.Lock(self.home)
        self.assertTrue(first.take())
        self.assertFalse(second.take())
        first.release()
        self.assertTrue(second.take())
        second.release()

    def test_a_lock_left_by_a_killed_install_is_taken_over(self) -> None:
        dead = subprocess.Popen([sys.executable, '-c', 'pass'])
        dead.wait()
        (self.home / '.installing').write_text(str(dead.pid))
        lock = self.install.Lock(self.home)
        self.assertTrue(lock.take())
        lock.release()

    def test_this_process_is_alive(self) -> None:
        self.assertTrue(self.install.is_alive(os.getpid()))


class PlayerTest(unittest.TestCase):
    def test_each_system_has_its_own_player(self) -> None:
        sys.path.insert(0, str(HERE))
        try:
            import serve
        finally:
            sys.path.pop(0)
        # CI sets READALONG_PLAYER=null for its silent runners; this test is about the system's own.
        with unittest.mock.patch.dict(os.environ, {'READALONG_PLAYER': ''}):
            names = serve.player_names()
        if os.name == 'nt':
            self.assertEqual(names, ['winsound'])
            self.assertIsNotNone(serve.player_command('winsound', Path('x.wav'), 1))
        elif sys.platform == 'darwin':
            self.assertEqual(names[0], 'afplay')
            self.assertIsNotNone(serve.player_command('afplay', Path('x.wav'), 1))
        else:
            self.assertEqual(names[:4], ['pw-play', 'paplay', 'aplay', 'ffplay'])
        self.assertIsNone(serve.player_command('no-such-player', Path('x.wav'), 1))



class InstallerTest(unittest.TestCase):
    def setUp(self) -> None:
        sys.path.insert(0, str(HERE))
        try:
            import install
        finally:
            sys.path.pop(0)
        self.install = install
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        # Never this computer's own earlier install: an install takes it over, an uninstall removes it.
        self.former = self.tmp / 'former' / 'readalong'
        patched = unittest.mock.patch.object(install, 'former_home', return_value=self.former)
        patched.start()
        self.addCleanup(patched.stop)

    def test_a_lock_taken_over_is_left_to_its_new_holder(self) -> None:
        lock = self.install.Lock(self.tmp)
        self.assertTrue(lock.take())
        self.assertFalse(self.install.Lock(self.tmp).take())
        # Another run took it over as stale; this run's release leaves it be.
        lock.path.write_text('999999999')
        lock.release()
        self.assertTrue(lock.path.exists())

    def test_a_lock_held_is_touched_while_its_holder_works(self) -> None:
        lock = self.install.Lock(self.tmp)
        self.assertTrue(lock.take())
        old = time.time() - 3600
        os.utime(lock.path, (old, old))
        lock.touch()
        self.assertGreater(lock.path.stat().st_mtime, old + 3000)
        lock.release()
        self.assertFalse(lock.path.exists())

    def test_uninstall_leaves_a_folder_readalong_did_not_make(self) -> None:
        other = self.tmp / 'tools'
        other.mkdir()
        (other / 'notes.txt').write_text('mine')
        args = unittest.mock.Mock(home=other, port=1, plugin=False)
        self.install.uninstall(args, self.install.Out(is_json=True))
        self.assertTrue((other / 'notes.txt').exists())
        ours = self.tmp / 'readalong'
        ours.mkdir()
        self.install.uninstall(unittest.mock.Mock(home=ours, port=1, plugin=False), self.install.Out(is_json=True))
        self.assertFalse(ours.exists())

    def test_the_voice_lives_in_the_plugins_data_folder(self) -> None:
        claude = self.tmp / 'claude'
        with unittest.mock.patch.dict(os.environ, {'CLAUDE_CONFIG_DIR': str(claude)}):
            os.environ.pop('READALONG_HOME', None)
            self.assertEqual(self.install.default_home(), claude / 'plugins' / 'data' / 'readalong-readalong')
            os.environ['READALONG_HOME'] = str(self.tmp / 'elsewhere')
            self.assertEqual(self.install.default_home(), self.tmp / 'elsewhere')

    def test_an_earlier_install_gives_its_model_and_goes_with_an_uninstall(self) -> None:
        (self.former / 'server').mkdir(parents=True)
        (self.former / 'server' / 'serve.py').write_text('')
        (self.former / self.install.MODEL_FILE).write_bytes(b'the model')
        home = self.tmp / 'plugins' / 'data' / 'readalong-readalong'
        home.mkdir(parents=True)
        self.assertEqual(self.install.former_install(home), self.former)
        self.assertIsNone(self.install.former_install(self.former))
        checksum = hashlib.sha256(b'the model').hexdigest()
        with unittest.mock.patch.object(self.install, 'MODEL_SHA256', checksum):
            self.install.get_model(home, self.install.Out(is_json=True))
        self.assertEqual((home / self.install.MODEL_FILE).read_bytes(), b'the model')
        self.install.uninstall(unittest.mock.Mock(home=home, port=1, plugin=False), self.install.Out(is_json=True))
        self.assertFalse(home.exists())
        self.assertFalse(self.former.exists())


class UninstalledTest(unittest.TestCase):
    """The voice in the plugin's data folder, laid out as Claude Code does, when the plugin is removed under it."""

    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix='readalong-test-'))
        self.addCleanup(shutil.rmtree, self.root, True)
        self.data = self.root / 'plugins' / 'data' / 'readalong-readalong'
        self.data.mkdir(parents=True)
        shutil.copyfile(CHIME, self.data / 'chime.wav')
        (self.data / 'ready.json').write_text('{}')
        self.list_plugins({'readalong@readalong': [{'scope': 'user'}], 'other@market': [{'scope': 'user'}]})
        self.port = free_port()
        self.env = {**os.environ, 'READALONG_PLAYER': 'null', 'READALONG_MIC': f'file:{self.root / "mic-on"}'}
        self.env.pop('READALONG_TOKEN', None)
        self.addCleanup(self.serve, 'stop')
        started = self.serve('start')
        self.assertEqual(started.returncode, 0, started.stderr)

    def serve(self, command: str) -> subprocess.CompletedProcess[str]:
        argv = [sys.executable, '-I', str(SERVE), command, '--data', str(self.data), '--port', str(self.port)]
        return subprocess.run(argv, capture_output=True, text=True, env=self.env, timeout=90, check=False)

    def list_plugins(self, plugins: dict) -> None:
        (self.root / 'plugins' / 'installed_plugins.json').write_text(json.dumps({'version': 2, 'plugins': plugins}))

    def is_up(self) -> bool:
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{self.port}/health', timeout=2):
                return True
        except urllib.error.HTTPError:
            return True
        except OSError:
            return False

    def within(self, seconds: float, is_so) -> bool:
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if is_so():
                return True
            time.sleep(0.2)
        return is_so()

    def test_it_runs_on_while_the_plugin_is_installed(self) -> None:
        time.sleep(7)  # longer than the service waits between two looks
        self.assertTrue(self.is_up())

    def test_a_plugin_removed_with_its_data_kept_stops_the_voice_and_leaves_the_folder(self) -> None:
        self.list_plugins({'other@market': [{'scope': 'user'}]})
        self.assertTrue(self.within(20, lambda: not self.is_up()), 'the voice runs on')
        time.sleep(4)  # what a removal would take, were one started
        self.assertTrue((self.data / 'ready.json').exists())

    def test_a_removal_that_left_part_of_the_folder_is_finished(self) -> None:
        # As Claude Code leaves it where a file was in use: the plugin off its list, some of the folder gone.
        (self.data / 'chime.wav').unlink()
        self.list_plugins({})
        self.assertTrue(self.within(20, lambda: not self.is_up()), 'the voice runs on')
        is_gone = self.within(40, lambda: not self.data.exists())
        left = sorted(str(path.relative_to(self.data)) for path in self.data.rglob('*')) if self.data.exists() else []
        self.assertTrue(is_gone, f'the folder is still there, holding {left}')

    @unittest.skipIf(os.name == 'nt', 'Windows does not remove a folder whose files are in use')
    def test_a_folder_removed_stops_the_voice(self) -> None:
        shutil.rmtree(self.data)
        self.assertTrue(self.within(20, lambda: not self.is_up()), 'the voice runs on')


class SessionsTest(unittest.TestCase):
    """The voice lives as long as the Claude Code sessions that use it, and a little longer."""

    def setUp(self) -> None:
        self.data = Path(tempfile.mkdtemp(prefix='readalong-test-'))
        self.addCleanup(shutil.rmtree, self.data, True)
        shutil.copyfile(CHIME, self.data / 'chime.wav')
        self.port = free_port()
        self.env = {**os.environ, 'READALONG_PLAYER': 'null', 'READALONG_SESSION_GRACE_S': '2', 'READALONG_MIC': f'file:{self.data / "mic-on"}'}
        self.env.pop('READALONG_TOKEN', None)
        self.addCleanup(self.serve, 'stop')
        started = self.serve('start')
        self.assertEqual(started.returncode, 0, started.stderr)
        self.token = (self.data / 'token').read_text().strip()

    def serve(self, command: str) -> subprocess.CompletedProcess[str]:
        argv = [sys.executable, '-I', str(SERVE), command, '--data', str(self.data), '--port', str(self.port)]
        return subprocess.run(argv, capture_output=True, text=True, env=self.env, timeout=90, check=False)

    def say(self, session: str, is_open: bool) -> dict:
        request = urllib.request.Request(
            f'http://127.0.0.1:{self.port}/v1/session',
            data=json.dumps({'session': session, 'open': is_open}).encode(),
            headers={'Content-Type': 'application/json', 'X-Readalong-Token': self.token},
        )
        with urllib.request.urlopen(request, timeout=5) as response:
            return json.loads(response.read())

    def health(self) -> dict | None:
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{self.port}/health', timeout=2) as response:
                return json.loads(response.read())
        except OSError:
            return None

    def test_it_stops_once_the_last_session_has_closed(self) -> None:
        self.assertEqual(self.say('one', True)['sessions'], 1)
        self.assertEqual(self.say('two', True)['sessions'], 2)
        self.say('one', False)
        time.sleep(8)  # past the grace, and a look of the service's
        self.assertEqual((self.health() or {}).get('sessions'), 1, 'a session is still open')
        self.say('two', False)
        deadline = time.monotonic() + 20
        while self.health() is not None and time.monotonic() < deadline:
            time.sleep(0.2)
        self.assertIsNone(self.health(), 'the voice runs on with no session open')
        self.assertIn('no Claude Code session is open', (self.data / 'server.log').read_text())

    def test_started_with_no_session_it_waits_for_one(self) -> None:
        # As the installer starts it, to test it: no session has opened yet, so none has closed.
        time.sleep(8)
        self.assertIsNotNone(self.health())



class LifecycleTest(unittest.TestCase):
    """When the voice starts and when it stops: an install under way, work in progress, a client gone."""

    def setUp(self) -> None:
        self.data = Path(tempfile.mkdtemp(prefix='readalong-test-'))
        self.addCleanup(shutil.rmtree, self.data, True)
        shutil.copyfile(CHIME, self.data / 'chime.wav')
        self.port = free_port()
        self.env = {**os.environ, 'READALONG_PLAYER': 'null', 'READALONG_MIC': f'file:{self.data / "mic-on"}'}
        self.env.pop('READALONG_TOKEN', None)
        self.addCleanup(self.serve, 'stop')
        self.upstream = ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
        self.upstream.daemon_threads = True
        threading.Thread(target=self.upstream.serve_forever, daemon=True).start()
        self.addCleanup(self.upstream.shutdown)

    def serve(self, command: str, *more: str, env: dict | None = None) -> subprocess.CompletedProcess[str]:
        argv = [sys.executable, '-I', str(SERVE), command, '--data', str(self.data), '--port', str(self.port), *more]
        return subprocess.run(argv, capture_output=True, text=True, env=env or self.env, timeout=90, check=False)

    def health(self) -> dict | None:
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{self.port}/health', timeout=2) as response:
                return json.loads(response.read())
        except OSError:
            return None

    def ask(self, route: str, body: dict) -> tuple[int, dict]:
        token = (self.data / 'token').read_text().strip()
        request = urllib.request.Request(
            f'http://127.0.0.1:{self.port}{route}',
            data=json.dumps(body).encode(),
            headers={'Content-Type': 'application/json', 'X-Readalong-Token': token},
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as err:
            return err.code, json.loads(err.read() or b'{}')

    def test_a_start_waits_for_an_install_under_way_then_starts(self) -> None:
        holder = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])
        self.addCleanup(holder.wait)
        self.addCleanup(holder.kill)
        lock = self.data / '.installing'
        lock.write_text(str(holder.pid))
        refused = self.serve('start', '--seconds', '2')
        self.assertEqual(refused.returncode, 1)
        self.assertIn('being installed or updated', refused.stderr)
        self.assertIsNone(self.health(), 'the voice started while an install changed its folder')
        threading.Timer(2, lock.unlink).start()
        began = time.monotonic()
        started = self.serve('start')
        self.assertEqual(started.returncode, 0, started.stderr)
        self.assertGreaterEqual(time.monotonic() - began, 1.5)
        self.assertIsNotNone(self.health())

    def test_a_lock_left_by_a_killed_install_does_not_hold_a_start(self) -> None:
        dead = subprocess.Popen([sys.executable, '-c', 'pass'])
        dead.wait()
        (self.data / '.installing').write_text(str(dead.pid))
        started = self.serve('start')
        self.assertEqual(started.returncode, 0, started.stderr)

    def test_a_sentence_still_being_made_keeps_the_voice_up(self) -> None:
        # Idle after 3 s; the sentence takes 8 s to make. It is use: the voice answers it, and stays.
        started = self.serve('start', env={**self.env, 'READALONG_IDLE_MINUTES': '0.05'})
        self.assertEqual(started.returncode, 0, started.stderr)
        upstream = f'http://127.0.0.1:{self.upstream.server_address[1]}'
        status, made = self.ask('/v1/clips', {'input': 'Slow.', 'voice': 'slow', 'speed': 1, 'upstream': upstream})
        self.assertEqual(status, 200, made)
        self.assertIsNotNone(self.health(), 'the voice stopped right after answering')
        deadline = time.monotonic() + 20
        while self.health() is not None and time.monotonic() < deadline:
            time.sleep(0.2)
        self.assertIsNone(self.health(), 'the voice never idled out')

    def test_a_client_that_drops_its_connection_leaves_no_traceback(self) -> None:
        started = self.serve('start')
        self.assertEqual(started.returncode, 0, started.stderr)
        for _ in range(3):
            with socket.create_connection(('127.0.0.1', self.port)) as client:
                client.sendall(b'GET /health HTTP/1.1\r\nHost: x\r\n\r\n')
                time.sleep(0.2)
                # Closed with a reset, as a client that gives up mid-connection does.
                # Windows' linger holds two shorts, the others' two ints.
                client.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack('HH' if os.name == 'nt' else 'ii', 1, 0))
        time.sleep(0.5)
        self.assertIsNotNone(self.health())
        self.assertNotIn('Traceback', (self.data / 'server.log').read_text())


class FrenchSpellingTest(unittest.TestCase):
    """What espeak-ng is given to read French: no model needed."""

    def setUp(self) -> None:
        sys.path.insert(0, str(HERE))
        try:
            import serve
        finally:
            sys.path.pop(0)
        self.serve = serve

    def test_a_french_word_says_its_th_as_t(self) -> None:
        said = self.serve.spelled_for
        self.assertEqual(said('Les rythmes sont variés.', 'fr-fr'), 'Les rytmes sont variés.')
        self.assertEqual(said("L'algorithme, l'arithmétique et Authentique.", 'fr-fr'), "L'algoritme, l'aritmétique et Autentique.")
        self.assertEqual(said('enthousiasme, lithium, maths, méthode', 'fr-fr'), 'entousiasme, litium, mats, métode')
        # English words in a French sentence are read as English.
        self.assertEqual(said('Le thread GitHub, the path, with token.', 'fr-fr'), 'Le thread GitHub, the path, with token.')
        # Only French is respelled.
        self.assertEqual(said('The rhythm of rythmes.', 'en-us'), 'The rhythm of rythmes.')

    def test_an_english_word_in_french_or_italian_is_said_in_its_sounds(self) -> None:
        french = lambda sounds: self.serve.borrowed(sounds, 'fr-fr')
        self.assertEqual(french('stɹˈɛs'), 'stʁˈɛs')
        self.assertEqual(french('dɪzˈaɪn'), 'dizˈajn')
        self.assertEqual(french('pˈɑːɹkɪŋ'), 'pˈaʁkiŋ')
        self.assertEqual(french('lˈiːdɚ'), 'lˈidœʁ')
        self.assertEqual(french('hˈʊk'), 'ˈuk')
        self.assertEqual(french('ʃˈoʊ'), 'ʃˈo')
        self.assertEqual(french('θɹˈɛd'), 'tʁˈɛd')
        self.assertEqual(self.serve.borrowed('stɹˈiːmɪŋ', 'it'), 'strˈimiŋ')
        self.assertEqual(self.serve.borrowed('bˈɪznəs', 'it'), 'bˈiznes')
        # No English sound is left for a voice that does not say it.
        for sounds in self.serve.BORROWED.values():
            for _, own in sounds:
                self.assertFalse(set(own) & set('ɹɚɝɜʌæɒɪʊθðh'), own)

    def test_the_words_named_english_are_read_by_english_rules(self) -> None:
        langs = self.serve.word_languages(6, 'fr-fr', [(1, 3), (5, 9)])
        self.assertEqual(langs, ['fr-fr', 'en-us', 'en-us', 'fr-fr', 'fr-fr', 'en-us'])
        # An English sentence is English throughout, in its voice's accent.
        self.assertEqual(self.serve.word_languages(3, 'en-gb', [(0, 2)]), ['en-gb'] * 3)
        self.assertEqual(self.serve.english_of({'english': [[1, 3]]}), ((1, 3),))
        self.assertEqual(self.serve.english_of({}), ())
        with self.assertRaises(self.serve.Refused):
            self.serve.english_of({'english': ['x']})

    def test_each_language_has_its_rules(self) -> None:
        self.assertEqual(self.serve.accent('ef_dora', 'es'), 'es')
        self.assertEqual(self.serve.accent('pf_dora', 'pt'), 'pt-br')
        # German is read by an English voice, with German rules.
        self.assertEqual(self.serve.accent('af_heart', 'de'), 'de')
        self.assertEqual(self.serve.accent('bf_emma', 'en'), 'en-gb')

    def test_espeak_marks_of_another_language_are_not_said(self) -> None:
        self.assertEqual(self.serve.SWITCH.sub('', '(en)hˈʊk(fr) e (en)pˈʊʃ(fr), (pt-br)x'), 'hˈʊk e pˈʊʃ, x')
        # Brackets in what is said are kept.
        self.assertEqual(self.serve.SWITCH.sub('', '(ˈa)'), '(ˈa)')
        # With tied sounds a mark comes with ties between its letters, and is made whole.
        whole = lambda said: self.serve.TIED_SWITCH.sub(lambda mark: mark.group(0).replace('^', ''), said)
        self.assertEqual(whole('(^e^n)d^ʒˈaz(^i^t) (^e^n-^u^s)'), '(en)d^ʒˈaz(it) (en-us)')


if __name__ == '__main__':
    unittest.main()
