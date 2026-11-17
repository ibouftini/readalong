import { expect, mock, test } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'

// Three sentences, then code that is never read.
const TEXT = 'First sentence here. Second one follows!\n\n- A list item.\n\n```\nls -la\n```'
const S1 = 'First sentence here.'
const S2 = 'Second one follows!'
const S3 = 'A list item.'
const YELLOW = '#F9C74F'
/** The colour row's swatches, by the word each is labelled with. */
const SWATCHES = ['Red', 'Orange', 'Yellow', 'Green', 'Teal', 'Blue']
// Each act waits for the reading's background work to settle, so a whole reading takes seconds.
const SLOW = { timeoutMs: 30_000 }
const HOME = '/home/u'
/** The plugin's data folder, where the voice is installed. */
const VOICE = `${HOME}/.claude/plugins/data/readalong-readalong`
const PYTHON = `${VOICE}/server/.venv/bin/python`

const reply = (requestId = 'msg-1', text = TEXT) =>
  ({ plugin: 'readalong', component: 'AssistantMessage', requestId, props: { text, isFirstOfReply: true } }) as const

/** How the fake service names a sentence it played: its text, speed and voice. */
const heard = (text: string, speed = 1, voice = 'af_heart') => `${text} @${speed} ${voice}`

/**
 * The colour behind the innermost Text that shows exactly `text`: 'none' when it has none,
 * undefined when no Text shows it. Innermost, as a paragraph that is one sentence shows it too.
 */
async function litColour(
  ui: { findAll: (q: { type: string; text: RegExp }) => Promise<Array<{ props: Record<string, unknown> }>> },
  text: string,
) {
  const exact = new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
  const found = await ui.findAll({ type: 'Text', text: exact })
  const innermost = found[found.length - 1]
  return innermost === undefined ? undefined : (innermost.props.backgroundColor ?? 'none')
}

type Found = { props: Record<string, unknown>; text: string }
type Drawing = {
  find: (q: { type?: string; key?: string; text?: string | RegExp }) => Promise<Found | undefined>
  findAll: (q: { type?: string; key?: string; text?: string | RegExp }) => Promise<Found[]>
}

/** The names of the icons drawn, in order: what a screen reader says for each control. */
async function icons(ui: Drawing): Promise<string[]> {
  // The transparent pixels that lift each button have no name.
  return (await ui.findAll({ type: 'Svg' })).map(icon => String(icon.props.alt)).filter(alt => alt.trim() !== '')
}

/** What the play/pause control shows: Pause, Resume or Loading. */
async function toggleShows(ui: Drawing): Promise<string | undefined> {
  return (await icons(ui)).find(name => ['Pause', 'Resume', 'Loading'].includes(name))
}

/** Whether the reply shows only its read-aloud control, as when it is not being read. */
async function isIdle(ui: Drawing): Promise<boolean> {
  return (await icons(ui)).join() === 'Read aloud,Settings' && (await ui.find({ key: 'read' })) !== undefined
}

type Host = {
  said: string[]
  voices: string[]
  /** The language each sentence was asked in; '' where none was named. */
  langs: string[]
  /** The words of each sentence asked to be said in English; [] where none were. */
  english: unknown[]
  /** What the service played, by `heard`; the chime as `chime`, or `chime (over)` over another reading. */
  played: string[]
  /** The player each sound was asked of. */
  players: string[]
  /** The speech server of the user's own each sentence was asked of, if any. */
  upstreams: string[]
  /** How many times the reader asked the service to stop what it was playing. */
  stops: number
  toasts: string[]
  /** How the reader held the voice: claim:yield, claim:take, release. */
  listed: string[]
  /** The commands the plugin ran, by their first two words after the program. */
  ran: string[][]
  /** Paths the plugin checked for. */
  checked: string[]
  /** Another session's reading takes the voice. */
  takeOver: () => void
  /** A program starts recording from a microphone, or stops: the service stops the reading heard. */
  setMic: (isOn: boolean) => void
  /** The service as it stands: installed, and answering. */
  state: { isInstalled: boolean; isUp: boolean }
  /** The service stops on its idle timer, forgetting the clips it made; the plugin starts it again. */
  idleStop: () => void
}

type On = Parameters<typeof mock.clock>[0]

type Play = { id: string; owner: string; state: string; endsAt: number; wake: () => void; ended: Promise<void> }

/**
 * Stands for the readalong service beneath the plugin: it makes each sentence at once (or after
 * `synthMs` on the clock), plays each for a second of the mocked clock, and holds the voice for
 * one reading at a time. With `otherHeard`, another session's reading is heard, so a claim that
 * yields is refused; with `failPlayer`, that player fails; with `isInstalled` false, nothing is
 * installed until the installer has run; with `upstreamDown`, a speech server of the user's own
 * does not answer.
 */
function fakeMachine(
  on: On,
  clock: MockClock,
  options: {
    synthMs?: number
    wordMs?: number
    otherHeard?: boolean
    failPlayer?: string
    isInstalled?: boolean
    isUp?: boolean
    upstreamDown?: boolean
    env?: Record<string, string>
    install?: Array<{ line: string; ms?: number }>
    /** How long the voice takes to start, and an update at session start to run, on the clock. */
    startMs?: number
    updateMs?: number
  } = {},
): Host {
  const state = { isInstalled: options.isInstalled ?? true, isUp: options.isUp ?? options.isInstalled ?? true }
  const plays = new Map<string, Play>()
  let current: Play | null = null
  let heardOwner: string | null = options.otherHeard === true ? 'another-session' : null
  let count = 0
  let isMicOn = false
  /** The clips the service holds: those made since it last started. */
  const clips = new Set<string>()
  /** The readings a microphone stopped, which the service refuses from then on. */
  const hushed = new Set<string>()
  const finish = (play: Play, as: string) => {
    if (play.state !== 'playing') return
    play.state = as
    play.wake()
    if (current === play) current = null
  }
  const host: Host = {
    said: [],
    voices: [],
    langs: [],
    english: [],
    played: [],
    players: [],
    upstreams: [],
    stops: 0,
    toasts: [],
    listed: [],
    ran: [],
    checked: [],
    state,
    takeOver: () => {
      if (current !== null) finish(current, 'taken')
      heardOwner = 'another-session'
    },
    idleStop: () => {
      state.isUp = false
      clips.clear()
      current = null
      heardOwner = null
    },
    setMic: isOn => {
      if (isOn && !isMicOn) {
        if (heardOwner !== null) hushed.add(heardOwner)
        if (current !== null) {
          hushed.add(current.owner)
          finish(current, 'mic')
        }
        heardOwner = null
      }
      isMicOn = isOn
    },
  }
  const json = (data: unknown, status = 200) => ({
    value: { status, ok: status >= 200 && status < 300, headers: { 'content-type': 'application/json' }, text: JSON.stringify(data) },
  })
  mock.env(on, options.env ?? { HOME })
  on('fs.exists', ($, e) => {
    host.checked.push(e.path)
    return { value: state.isInstalled }
  })
  on('fs.read', () => (state.isInstalled ? { value: 'the-token' } : { deny: 'ENOENT' }))
  on('http.fetch', async ($, e) => {
    const route = e.url.replace(/^https?:\/\/[^/]+/, '')
    if (!state.isUp) return { deny: 'connect ECONNREFUSED' }
    if (route === '/health') return json({ status: 'healthy', service: 'readalong', protocol: 6, model: true })
    const sent = e.init?.body
    const body = JSON.parse(typeof sent === 'string' ? sent : '{}') as Record<string, unknown>
    const owner = String(body.owner ?? '')
    if (route === '/v1/clips') {
      const input = String(body.input)
      host.said.push(`${input} @${String(body.speed)}`)
      host.voices.push(String(body.voice))
      host.langs.push(String(body.lang ?? ''))
      host.english.push(body.english ?? [])
      if (typeof body.upstream === 'string') host.upstreams.push(body.upstream)
      if (options.synthMs !== undefined) await clock.sleep(options.synthMs)
      if (options.upstreamDown === true) return json({ error: `nothing answers at ${String(body.upstream)}`, code: 'upstream-down' }, 502)
      // With `wordMs`, each word starts that long after the one before.
      const words = options.wordMs === undefined ? [] : input.split(' ').map((_, i) => i * (options.wordMs ?? 0))
      const clip = heard(input, Number(body.speed), String(body.voice))
      clips.add(clip)
      return json({ clip, words, ms: 1000 })
    }
    if (route === '/v1/play') {
      const isOverlay = body.overlay === true
      host.players.push(String(body.player))
      if (hushed.has(owner)) return json({ error: 'a microphone started recording, which stopped this reading', code: 'mic' }, 409)
      if (!isOverlay && owner !== heardOwner) return json({ error: 'another reading is being heard', code: 'not-heard' }, 409)
      if (typeof body.clip === 'string' && !clips.has(body.clip)) return json({ error: 'no such clip', code: 'unknown-clip' }, 404)
      const id = `play-${(count += 1)}`
      if (body.player === options.failPlayer) return json({ play: id, state: 'failed', error: 'Connection refused' })
      host.played.push(body.sound === 'chime' ? (isOverlay ? 'chime (over)' : 'chime') : String(body.clip))
      let wake = () => {}
      const ended = new Promise<void>(resolve => (wake = resolve))
      const play: Play = { id, owner, state: 'playing', endsAt: clock.now() + 1000, wake, ended }
      plays.set(id, play)
      if (!isOverlay) {
        if (current !== null) finish(current, 'stopped')
        current = play
      }
      return json({ play: id, state: 'playing', error: '' })
    }
    if (route === '/v1/wait') {
      const play = plays.get(String(body.play))
      if (play === undefined) return json({ error: 'no such play', code: 'unknown-play' }, 404)
      const left = play.endsAt - clock.now()
      if (play.state === 'playing' && left > 0) await Promise.race([clock.sleep(Math.min(left, Number(body.seconds) * 1000)), play.ended])
      if (play.state === 'playing' && clock.now() >= play.endsAt) finish(play, 'done')
      return json({ state: play.state, error: '' })
    }
    if (route === '/v1/stop') {
      host.stops += 1
      if (current !== null && current.owner === owner) finish(current, 'stopped')
      return json({})
    }
    if (route === '/v1/claim') {
      host.listed.push(`claim:${body.yields === true ? 'yield' : 'take'}`)
      if (hushed.has(owner)) return json({ error: 'a microphone started recording, which stopped this reading', code: 'mic' }, 409)
      if (body.yields === true && isMicOn) return json({ granted: false, reason: 'mic' })
      if (body.yields === true && heardOwner !== null && heardOwner !== owner) return json({ granted: false })
      if (current !== null && current.owner !== owner) finish(current, 'taken')
      heardOwner = owner
      return json({ granted: true })
    }
    if (route === '/v1/release') {
      host.listed.push('release')
      if (current !== null && current.owner === owner) finish(current, 'stopped')
      if (heardOwner === owner) heardOwner = null
      return json({})
    }
    return json({ error: 'not found' }, 404)
  })
  on('process.run', async ($, e) => {
    host.ran.push(e.argv.slice(2, 4).map(String))
    if (e.argv.includes('--update') && options.updateMs !== undefined) await clock.sleep(options.updateMs)
    if (e.argv.includes('start') && options.startMs !== undefined) await clock.sleep(options.startMs)
    const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv.includes('--update')) return ok('{"state": "current"}\n')
    if (e.argv.includes('start')) {
      if (!state.isInstalled) return { value: { exitCode: 1, stdout: '', stderr: 'not installed\n', isStdoutTruncated: false, isStderrTruncated: false } }
      state.isUp = true
    }
    return ok()
  })
  on('process.spawn', async function* ($, e) {
    host.ran.push(e.argv.map(String))
    for (const { line, ms } of options.install ?? [{ line: '{"step":"done","text":"The voice is installed"}' }]) {
      if (ms !== undefined) await clock.sleep(ms)
      if (line.includes('"done"')) {
        state.isInstalled = true
        state.isUp = true
      }
      yield { stream: 'stdout' as const, text: `${line}\n` }
    }
    return { value: { code: 0, signal: null } }
  })
  on('ui.toast', ($, e) => {
    host.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  return host
}

test('play reads the first sentence and lights it, then moves on by itself', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock)
  const ui = await $.ui.mount({ ...reply(), surface: 'vscode' })

  await ui.press({ key: 'read' })
  expect(host.said[0]).toBe('First sentence here. @1')
  expect(host.played).toEqual([heard(S1)])
  expect(await litColour(ui, S1)).toBe(YELLOW)
  expect(await icons(ui)).toEqual(['Previous sentence', 'Pause', 'Next sentence', 'Stop reading', 'Settings', 'Slower', 'Faster'])
  expect(await ui.find({ type: 'Text', text: '1 / 3' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '1×' })).toBeDefined()
  // The next two sentences are made ahead, while the first plays.
  expect(host.said).toEqual(['First sentence here. @1', 'Second one follows! @1', 'A list item. @1'])
  expect(host.players).toEqual(['auto'])

  await clock.advance(1000)
  expect(host.played).toEqual([heard(S1), heard(S2)])
  expect(await litColour(ui, S2)).toBe(YELLOW)
  expect(await litColour(ui, S1)).toBeUndefined()

  // The last sentence is a list item: drawn with its marker, and lit.
  await clock.advance(1000)
  expect(await litColour(ui, S3)).toBe(YELLOW)
  expect(await ui.find({ type: 'Text', text: '• ' })).toBeDefined()

  // At the end the reply is drawn as the engine draws it again, with its read-aloud button, and
  // the voice is let go.
  await clock.advance(1000)
  expect(await isIdle(ui)).toBe(true)
  expect(await ui.find({ key: 'next' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
  expect(host.listed).toEqual(['claim:take', 'release'])
  await ui.unmount()
})

test('the editor shows a turning loader icon while the first sentence is synthesised', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock, { synthMs: 600 })
  const ui = await $.ui.mount({ ...reply(), surface: 'desktop' })

  await ui.press({ key: 'read' })
  expect(await toggleShows(ui)).toBe('Loading')
  const loader = (await ui.findAll({ type: 'Svg' })).find(icon => icon.props.alt === 'Loading')
  expect(String(loader?.props.source)).toContain('<animateTransform')
  expect(host.played).toEqual([])

  await clock.advance(600)
  expect(host.played).toEqual([heard(S1)])
  expect(await toggleShows(ui)).toBe('Pause')
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

test('the terminal turns a spinner of text while the first sentence is synthesised', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  fakeMachine(on, clock, { synthMs: 600 })
  const ui = await $.ui.mount({ ...reply(), surface: 'terminal' })

  await ui.press({ key: 'read' })
  const first = (await ui.find({ key: 'read' }))?.props.label
  expect(String(first)).toMatch(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]$/)
  await clock.advance(240)
  expect((await ui.find({ key: 'read' }))?.props.label).not.toBe(first)
  await clock.advance(400)
  expect((await ui.find({ key: 'read' }))?.props.label).toBe('pause')
  await ui.press({ key: 'stop' })
  expect((await ui.find({ key: 'read' }))?.props.label).toBe('read aloud')
  await ui.unmount()
})

test('a voice that is installed but not running is started by the first press', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock, { isUp: false })
  const ui = await $.ui.mount({ ...reply(), surface: 'vscode' })
  await ui.press({ key: 'read' })
  expect(host.checked).toEqual([PYTHON, `${VOICE}/ready.json`])
  expect(host.ran).toContainEqual([`${VOICE}/server/serve.py`, 'start'])
  expect(host.played).toEqual([heard(S1)])
  expect(host.toasts).toEqual([])
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

test('next and previous move the highlight and the audio by a sentence', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock)
  const ui = await $.ui.mount({ ...reply(), surface: 'vscode' })
  await ui.press({ key: 'read' })

  // The sentence playing stops, and the next is heard at once.
  await ui.press({ key: 'next' })
  expect(host.stops).toBe(1)
  expect(host.played).toEqual([heard(S1), heard(S2)])
  expect(await litColour(ui, S2)).toBe(YELLOW)
  expect(await ui.find({ type: 'Text', text: '2 / 3' })).toBeDefined()

  await ui.press({ key: 'previous' })
  expect(await litColour(ui, S1)).toBe(YELLOW)
  expect(host.played.at(-1)).toBe(heard(S1))
  // Going back plays the audio already made; nothing is synthesised twice.
  expect(host.said.filter(s => s.startsWith('First'))).toHaveLength(1)

  await ui.press({ key: 'stop' })
  expect(await isIdle(ui)).toBe(true)
  await ui.unmount()
})

test('pause stops the audio, keeps the place and lets the voice go; play says that sentence again', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock)
  const ui = await $.ui.mount({ ...reply(), surface: 'vscode' })
  await ui.press({ key: 'read' })
  await clock.advance(1000)

  await ui.press({ key: 'read' })
  expect(host.listed).toEqual(['claim:take', 'release'])
  expect(await toggleShows(ui)).toBe('Resume')
  expect(await litColour(ui, S2)).toBe(YELLOW)
  await clock.advance(5000)
  expect(host.played).toEqual([heard(S1), heard(S2)])

  await ui.press({ key: 'read' })
  expect(host.played).toEqual([heard(S1), heard(S2), heard(S2)])
  expect(host.listed).toEqual(['claim:take', 'release', 'claim:take'])
  expect(await toggleShows(ui)).toBe('Pause')
  await ui.press({ key: 'stop' })
  expect(host.listed.at(-1)).toBe('release')
  await ui.unmount()
})

test('a reading that another session takes the voice from holds still, and resumes where it was', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock)
  const ui = await $.ui.mount({ ...reply(), surface: 'vscode' })
  await ui.press({ key: 'read' })
  await clock.advance(1000)
  expect(host.played).toEqual([heard(S1), heard(S2)])

  host.takeOver()
  await clock.settle()
  expect(await toggleShows(ui)).toBe('Resume')
  expect(await litColour(ui, S2)).toBe(YELLOW)
  await clock.advance(5000)
  expect(host.played).toHaveLength(2)

  await ui.press({ key: 'read' })
  expect(host.played.at(-1)).toBe(heard(S2))
  expect(host.toasts).toEqual([])
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

test('a microphone that starts recording stops the reading, with no toast', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock)
  const ui = await $.ui.mount({ ...reply(), surface: 'vscode' })
  await ui.press({ key: 'read' })
  await clock.advance(1000)
  expect(host.played).toEqual([heard(S1), heard(S2)])

  host.setMic(true)
  await clock.settle()
  expect(await isIdle(ui)).toBe(true)
  await clock.advance(5000)
  expect(host.played).toHaveLength(2)
  expect(host.toasts).toEqual([])
  expect(host.listed.at(-1)).toBe('release')

  // Pressed while the microphone records, as during a call, it reads.
  await ui.press({ key: 'read' })
  await clock.advance(10)
  expect(host.played.at(-1)).toBe(heard(S1))
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

test('a message the person sends stops the reading, as speaking does', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock)
  on('prompt.submit', (_, e) => ({ text: e.text }))
  const ui = await $.ui.mount({ ...reply(), surface: 'vscode' })
  await ui.press({ key: 'read' })
  await clock.advance(1000)
  expect(host.played).toEqual([heard(S1), heard(S2)])

  await $.prompt.submit({ text: 'And what about the rest?', origin: { kind: 'composer' }, wait: false })
  await clock.settle()
  expect(await isIdle(ui)).toBe(true)
  await clock.advance(5000)
  expect(host.played).toHaveLength(2)
  expect(host.listed.at(-1)).toBe('release')
  expect(host.toasts).toEqual([])
  await ui.unmount()
})

test('a message that is not the person\'s, as a background task\'s, leaves the reading be', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock)
  on('prompt.submit', (_, e) => ({ text: e.text }))
  const ui = await $.ui.mount({ ...reply(), surface: 'vscode' })
  await ui.press({ key: 'read' })
  await clock.advance(1000)

  await $.prompt.submit({ text: 'The build finished.', origin: { kind: 'task-notification' }, wait: false })
  await clock.advance(1000)
  expect(host.played).toEqual([heard(S1), heard(S2), heard(S3)])
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

test('the speed stepper restarts the sentence at the new speed, and it is remembered', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const ui = await $.ui.mount({ ...reply(), surface: 'vscode' })
  await ui.press({ key: 'read' })

  // 1× → 1.1× → 1.2×: the sentence playing stops, and is said again at the speed reached.
  await ui.press({ key: 'faster' })
  await ui.press({ key: 'faster' })
  expect(await ui.find({ type: 'Text', text: '1.2×' })).toBeDefined()
  expect(host.stops).toBe(2)
  expect(host.played.at(-1)).toBe(heard(S1, 1.2))
  expect(host.said).toContain('First sentence here. @1.2')
  expect(await litColour(ui, S1)).toBe(YELLOW)

  await ui.press({ key: 'slower' })
  expect(await ui.find({ type: 'Text', text: '1.1×' })).toBeDefined()

  // A reply read later, in a session started after, starts at the speed picked.
  await ui.press({ key: 'stop' })
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await ui.press({ key: 'read' })
  expect(host.said[host.said.length - 3]).toBe('First sentence here. @1.1')
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

test('the terminal steps through the speeds with − and +', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  fakeMachine(on, clock)
  const ui = await $.ui.mount({ ...reply(), surface: 'terminal' })
  await ui.press({ key: 'read' })
  expect(await ui.findAll({ type: 'Svg' })).toEqual([])
  expect((await ui.find({ key: 'next' }))?.props.label).toBe('next')
  expect(await ui.find({ type: 'Text', text: '1×' })).toBeDefined()

  await ui.press({ key: 'faster' })
  await ui.press({ key: 'faster' })
  expect(await ui.find({ type: 'Text', text: '1.2×' })).toBeDefined()
  await ui.press({ key: 'slower' })
  expect(await ui.find({ type: 'Text', text: '1.1×' })).toBeDefined()
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

test('a speed kept from an earlier session applies, unless the configured speed changed', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on, { speed: { value: 1.5, configured: 1 } })
  const host = fakeMachine(on, clock)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  const ui = await $.ui.mount({ ...reply(), surface: 'vscode' })
  await ui.press({ key: 'read' })
  expect(host.said[0]).toBe('First sentence here. @1.5')
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

test('a changed configured speed wins over the one kept', { ...SLOW, options: { speed: 1.2 } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on, { speed: { value: 1.5, configured: 1 } })
  const host = fakeMachine(on, clock)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  const ui = await $.ui.mount({ ...reply(), surface: 'vscode' })
  await ui.press({ key: 'read' })
  expect(host.said[0]).toBe('First sentence here. @1.2')
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

test('a session start brings the installed voice up to date, then starts it', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock, { isUp: true })
  host.state.isUp = false
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await clock.settle()
  const steps = host.ran.map(([script, step]) => `${String(script).split('/').pop()} ${step}`)
  expect(steps).toEqual(['install.py --home', 'serve.py start'])
  expect(host.state.isUp).toBe(true)
})

test('only the reply being read shows the player', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  fakeMachine(on, clock)
  const one = await $.ui.mount({ ...reply('msg-1'), surface: 'vscode' })
  const two = await $.ui.mount({ ...reply('msg-2', 'Another reply. It has two sentences.'), surface: 'vscode' })
  await one.press({ key: 'read' })
  expect(await one.find({ key: 'next' })).toBeDefined()
  expect(await two.find({ key: 'next' })).toBeUndefined()
  expect(await isIdle(two)).toBe(true)

  // Playing the other reply stops the first.
  await two.press({ key: 'read' })
  expect(await one.find({ key: 'next' })).toBeUndefined()
  expect(await litColour(two, 'Another reply.')).toBe(YELLOW)
  await two.press({ key: 'stop' })
  await one.unmount()
  await two.unmount()
})

test('with the voice not installed, the play button offers to install it, and reads once it is', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock, {
    isInstalled: false,
    install: [
      { line: '{"step":"uv","text":"Fetching uv, which installs Python and its packages"}' },
      { line: 'something uv printed' },
      { line: '{"step":"model","text":"Downloading the voice model","percent":42,"done_mb":137,"total_mb":325}', ms: 1100 },
      { line: '{"step":"done","text":"The voice is installed"}', ms: 100 },
    ],
  })
  const ui = await $.ui.mount({ ...reply(), surface: 'vscode' })
  await ui.press({ key: 'read' })
  expect(host.toasts).toEqual([])
  expect(await isIdle(ui)).toBe(true)
  expect(await ui.find({ type: 'Text', text: /needs the readalong voice, which runs on this computer/ })).toBeDefined()
  expect(host.played).toEqual([])

  await ui.press({ key: 'install' })
  const [command] = host.ran.filter(argv => argv[0] === 'sh')
  expect(command?.[1]).toMatch(/\/server\/bootstrap\.sh$/)
  expect(command?.slice(2, 5)).toEqual(['--progress', 'json', '--no-sound'])
  expect(await ui.find({ type: 'Text', text: 'Installing the voice, step 1 of 4 (0:00)' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Fetching uv, which installs Python and its packages…' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Keep working meanwhile/ })).toBeDefined()
  await clock.advance(1100)
  expect(await ui.find({ type: 'Text', text: 'Downloading the voice model: 137 of 325 MB, 42%…' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Installing the voice, step 3 of 4 (0:01)' })).toBeDefined()

  // Installed, the reply it was offered under is read at once.
  await clock.advance(100)
  expect(host.toasts).toEqual(['The readalong voice is installed'])
  expect(await ui.find({ key: 'install' })).toBeUndefined()
  expect(host.played).toEqual([heard(S1)])
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

test('an install that stops says why, and can be tried again or put away', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  fakeMachine(on, clock, {
    isInstalled: false,
    install: [{ line: '{"step":"failed","error":"uv could not be fetched; install it yourself (https://docs.astral.sh/uv/), then run this again"}' }],
  })
  const ui = await $.ui.mount({ ...reply(), surface: 'vscode' })
  await ui.press({ key: 'read' })
  await ui.press({ key: 'install' })
  expect(await ui.find({ type: 'Text', text: /^The install stopped: uv could not be fetched/ })).toBeDefined()
  expect((await ui.find({ key: 'install' }))?.props.label).toBe('Try again')
  await ui.press({ key: 'dismiss' })
  expect(await ui.find({ key: 'install' })).toBeUndefined()
  await ui.unmount()
})

test(
  "on Windows the voice is looked for in the plugin's data folder, and installed by PowerShell",
  SLOW,
  async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    const user = 'C:\\Users\\u'
    const host = fakeMachine(on, clock, { isInstalled: false, env: { OS: 'Windows_NT', USERPROFILE: user } })
    const ui = await $.ui.mount({ ...reply(), surface: 'vscode' })
    await ui.press({ key: 'read' })
    // On Linux the test engine makes a `C:\` path relative to the working folder; Windows reads it whole.
    expect(host.checked).toHaveLength(1)
    expect(host.checked[0]?.endsWith(`${user}\\.claude\\plugins\\data\\readalong-readalong\\server\\.venv\\Scripts\\python.exe`)).toBe(true)
    await ui.press({ key: 'install' })
    const command = host.ran.find(argv => argv[0] === 'powershell.exe')
    expect(command?.slice(0, 6)).toEqual(['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File'])
    expect(command?.[6]).toMatch(/bootstrap\.ps1$/)
    await ui.press({ key: 'stop' })
    await ui.unmount()
  },
)

test('with a speech server of your own, the service plays what it makes', { ...SLOW, options: { server: 'http://127.0.0.1:8880' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock)
  const ui = await $.ui.mount({ ...reply(), surface: 'vscode' })
  await ui.press({ key: 'read' })
  expect(host.upstreams[0]).toBe('http://127.0.0.1:8880')
  expect(host.played).toEqual([heard(S1)])
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

test('with a server of your own that is down, a toast says so', { ...SLOW, options: { startCommand: 'none', server: 'http://127.0.0.1:8880' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock, { upstreamDown: true })
  const ui = await $.ui.mount({ ...reply(), surface: 'vscode' })
  await ui.press({ key: 'read' })
  expect(host.toasts).toEqual([
    'Could not read this aloud: nothing answers at http://127.0.0.1:8880; start it, or set a start command in /config',
  ])
  expect(await isIdle(ui)).toBe(true)
  await ui.unmount()
})

test('with the highlight off, the reply is drawn as with it on, only unmarked, the player under it', { ...SLOW, options: { highlight: 'off' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  fakeMachine(on, clock)
  const ui = await $.ui.mount({ ...reply(), surface: 'vscode' })
  await ui.press({ key: 'read' })
  // Drawn one way whatever the highlight, so turning it off or on moves nothing.
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^First sentence here\. Second one follows!$/ })).toBeDefined()
  // Unmarked: the sentence is not a Text of its own.
  expect(await litColour(ui, S1)).toBeUndefined()
  expect(await ui.find({ key: 'next' })).toBeDefined()
  await ui.press({ key: 'settings' })
  await ui.press({ key: 'highlight:Marker' })
  expect(await litColour(ui, S1)).toBe(YELLOW)
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

test('the player picked in /config is the one asked to play', { ...SLOW, options: { player: 'aplay' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock)
  const ui = await $.ui.mount({ ...reply(), surface: 'vscode' })
  await ui.press({ key: 'read' })
  expect(host.players).toEqual(['aplay'])
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

test('a player that fails stops the reading and says why', { ...SLOW, options: { player: 'paplay' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock, { failPlayer: 'paplay' })
  const ui = await $.ui.mount({ ...reply(), surface: 'vscode' })
  await ui.press({ key: 'read' })
  expect(host.toasts).toEqual(['Could not read this aloud: Connection refused'])
  expect(await isIdle(ui)).toBe(true)
  await ui.unmount()
})

const ANSWER = 'The answer is here. It has two sentences.'
const A1 = 'The answer is here.'

/** A main-loop turn that ended with `answer`, as the engine raises it. */
const answered = (answer: string) =>
  ({ answer, reason: 'answer', durationMs: 1000, isAborted: false, turnId: 'turn-1' }) as const

/** Which colour swatch is in force, in the editor: the one ringed in the text colour. */
async function chosenSwatch(ui: Drawing, words: string[]): Promise<string | undefined> {
  for (const word of words) if ((await ui.find({ key: `swatch:${word}` }))?.props.borderColor === 'text') return word
  return undefined
}

/** Which choice of a settings-menu row is in force: the one not drawn dim. */
async function chosen(ui: Drawing, row: string, words: string[]): Promise<string | undefined> {
  for (const word of words) {
    const button = await ui.find({ key: `${row}:${word}` })
    if (button !== undefined && button.props.dimColor !== true) return word
  }
  return undefined
}

test('the gear opens and closes the settings menu, under its own reply only', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  fakeMachine(on, clock)
  const ui = await $.ui.mount({ ...reply(), surface: 'vscode' })
  const other = await $.ui.mount({ ...reply('msg-2'), surface: 'vscode' })
  expect(await ui.find({ key: 'autoRead:On' })).toBeUndefined()

  await ui.press({ key: 'settings' })
  expect(await chosen(ui, 'autoRead', ['On', 'Off'])).toBe('Off')
  // The choice in force is labelled in Claude's orange.
  const off = await ui.findAll({ type: 'Text', text: 'Off' })
  expect(off.some(label => label.props.color === 'claude')).toBe(true)
  expect(await chosen(ui, 'chime', ['On', 'Off'])).toBe('On')
  expect(await chosen(ui, 'highlight', ['Marker', 'Underline', 'Off'])).toBe('Marker')
  expect(await chosenSwatch(ui, SWATCHES)).toBe('Yellow')
  expect(await chosen(ui, 'follow', ['Sentence', 'Word'])).toBe('Sentence')
  expect(await chosen(ui, 'voice', ['Heart', 'Emma', 'Michael'])).toBe('Heart')
  expect(await other.find({ key: 'autoRead:On' })).toBeUndefined()

  await ui.press({ key: 'settings' })
  expect(await ui.find({ key: 'autoRead:On' })).toBeUndefined()
  await other.unmount()
  await ui.unmount()
})

test('auto-read and the chime picked in the menu are remembered by a later session', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  fakeMachine(on, clock)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const ui = await $.ui.mount({ ...reply(), surface: 'vscode' })
  await ui.press({ key: 'settings' })
  await ui.press({ key: 'autoRead:On' })
  await ui.press({ key: 'chime:Off' })
  expect(await chosen(ui, 'autoRead', ['On', 'Off'])).toBe('On')
  expect(await chosen(ui, 'chime', ['On', 'Off'])).toBe('Off')

  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  // A new session starts with the menu closed and the picks kept.
  expect(await ui.find({ key: 'autoRead:On' })).toBeUndefined()
  await ui.press({ key: 'settings' })
  expect(await chosen(ui, 'autoRead', ['On', 'Off'])).toBe('On')
  expect(await chosen(ui, 'chime', ['On', 'Off'])).toBe('Off')
  await ui.unmount()
})

test('a highlight picked in the menu restyles the sentence being read at once', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  fakeMachine(on, clock)
  const ui = await $.ui.mount({ ...reply(), surface: 'vscode' })
  await ui.press({ key: 'read' })
  expect(await litColour(ui, S1)).toBe(YELLOW)

  await ui.press({ key: 'settings' })
  await ui.press({ key: 'color:Teal' })
  expect(await litColour(ui, S1)).toBe('#43AA8B')
  await ui.press({ key: 'highlight:Off' })
  expect(await litColour(ui, S1)).toBeUndefined()
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

test('following words, each word is lit as it is said, and the next sentence from its first', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  fakeMachine(on, clock, { wordMs: 300 })
  const ui = await $.ui.mount({ ...reply(), surface: 'vscode' })
  await ui.press({ key: 'settings' })
  await ui.press({ key: 'follow:Word' })
  await ui.press({ key: 'read' })
  expect(await litColour(ui, 'First')).toBe(YELLOW)
  expect(await litColour(ui, S1)).toBeUndefined()

  await clock.advance(300)
  expect(await litColour(ui, 'sentence')).toBe(YELLOW)
  expect(await litColour(ui, 'First')).toBeUndefined()
  // The full stop is not lit with its word.
  await clock.advance(300)
  expect(await litColour(ui, 'here')).toBe(YELLOW)

  // Each sentence plays for a second here; the next starts from its first word.
  await clock.advance(400)
  expect(await litColour(ui, 'Second')).toBe(YELLOW)
  // Back to sentences mid-sentence: the whole one is lit at once.
  await ui.press({ key: 'follow:Sentence' })
  expect(await litColour(ui, S2)).toBe(YELLOW)
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

test('following words, a pause lights the first word of the sentence, where play starts again', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  fakeMachine(on, clock, { wordMs: 300 })
  const ui = await $.ui.mount({ ...reply(), surface: 'vscode' })
  await ui.press({ key: 'settings' })
  await ui.press({ key: 'follow:Word' })
  await ui.press({ key: 'read' })
  await clock.advance(600)
  expect(await litColour(ui, 'here')).toBe(YELLOW)

  await ui.press({ key: 'read' })
  expect(await toggleShows(ui)).toBe('Resume')
  expect(await litColour(ui, 'First')).toBe(YELLOW)
  await clock.advance(2000)
  expect(await litColour(ui, 'First')).toBe(YELLOW)
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

test('a reading paused while the service stopped on its idle timer resumes, its sentence made again', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock)
  const ui = await $.ui.mount({ ...reply(), surface: 'vscode' })
  await ui.press({ key: 'read' })
  await clock.advance(200)
  await ui.press({ key: 'read' })
  expect(await toggleShows(ui)).toBe('Resume')

  host.idleStop()
  await ui.press({ key: 'read' })
  await clock.advance(500)
  expect(host.toasts).toEqual([])
  expect(host.played).toEqual([heard(S1), heard(S1)])
  expect(host.said.filter(said => said === `${S1} @1`).length).toBe(2)
  await clock.advance(1000)
  expect(host.played).toEqual([heard(S1), heard(S1), heard(S2)])
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

test('following words with a voice that times none, the sentence is lit, and a toast says why', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock, { synthMs: 400 })
  const ui = await $.ui.mount({ ...reply(), surface: 'vscode' })
  await ui.press({ key: 'settings' })
  await ui.press({ key: 'follow:Word' })
  await ui.press({ key: 'read' })
  // While the first sentence is made it is not yet known whether words are timed: the sentence.
  expect(await toggleShows(ui)).toBe('Loading')
  expect(await litColour(ui, S1)).toBe(YELLOW)
  await clock.advance(400)
  expect(await litColour(ui, S1)).toBe(YELLOW)
  expect(host.toasts).toEqual(['Highlighting by sentence: the readalong voice gave no word timings'])
  await clock.advance(1500)
  expect(await litColour(ui, S2)).toBe(YELLOW)
  // Said once, not for every sentence.
  expect(host.toasts).toHaveLength(1)
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

test('following words is remembered by a later session', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  fakeMachine(on, clock)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const ui = await $.ui.mount({ ...reply(), surface: 'vscode' })
  await ui.press({ key: 'settings' })
  await ui.press({ key: 'follow:Word' })
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await ui.press({ key: 'settings' })
  expect(await chosen(ui, 'follow', ['Sentence', 'Word'])).toBe('Word')
  await ui.unmount()
})

test('a voice picked with nothing being read says hello in it, and no reply shows a player', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock)
  const ui = await $.ui.mount({ ...reply(), surface: 'vscode' })
  await ui.press({ key: 'settings' })
  await ui.press({ key: 'voice:Emma' })
  const emma = 'My name is Emma and I will read for you.'
  expect(host.said).toEqual([`${emma} @1`])
  expect(host.voices).toEqual(['bf_emma'])
  expect(host.played).toEqual([heard(emma, 1, 'bf_emma')])
  expect(await chosen(ui, 'voice', ['Heart', 'Emma', 'Michael'])).toBe('Emma')
  expect(await ui.find({ key: 'next' })).toBeUndefined()

  // Another pick before the first is done: that one stops, the new one says hello.
  await ui.press({ key: 'voice:Michael' })
  expect(host.said).toEqual([`${emma} @1`, 'My name is Michael and I will read for you. @1'])
  expect(host.voices).toEqual(['bf_emma', 'am_michael'])
  await clock.advance(1000)

  // A reading started afterwards is in the voice picked.
  await ui.press({ key: 'read' })
  expect(host.voices.slice(2)).toEqual(['am_michael', 'am_michael', 'am_michael'])
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

test('a voice picked while reading says the current sentence again in it, and goes on in it', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock)
  const ui = await $.ui.mount({ ...reply(), surface: 'vscode' })
  await ui.press({ key: 'read' })
  await clock.advance(1000)
  expect(host.played).toEqual([heard(S1), heard(S2)])

  await ui.press({ key: 'settings' })
  await ui.press({ key: 'voice:Emma' })
  // No hello in the middle of a reading: the sentence playing stops, and is heard in the new voice.
  expect(host.said).not.toContain('My name is Emma and I will read for you. @1')
  expect(host.stops).toBe(1)
  expect(await litColour(ui, S2)).toBe(YELLOW)
  expect(host.played.at(-1)).toBe(heard(S2, 1, 'bf_emma'))
  await clock.advance(1000)
  expect(host.played.at(-1)).toBe(heard(S3, 1, 'bf_emma'))
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

test('a voice picked in the menu is remembered by a later session', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const ui = await $.ui.mount({ ...reply(), surface: 'vscode' })
  await ui.press({ key: 'settings' })
  await ui.press({ key: 'voice:Michael' })
  await clock.advance(1000)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await ui.press({ key: 'settings' })
  expect(await chosen(ui, 'voice', ['Heart', 'Emma', 'Michael'])).toBe('Michael')
  await ui.press({ key: 'read' })
  expect(host.voices.at(-1)).toBe('am_michael')
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

/** The props of the innermost Text that shows exactly `text`. */
async function styleOfText(ui: Drawing, text: string): Promise<Record<string, unknown> | undefined> {
  const exact = new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
  const found = await ui.findAll({ type: 'Text', text: exact })
  return found[found.length - 1]?.props
}

test('the colour picked applies to the underline too', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  fakeMachine(on, clock)
  const ui = await $.ui.mount({ ...reply(), surface: 'vscode' })
  await ui.press({ key: 'read' })
  await ui.press({ key: 'settings' })
  await ui.press({ key: 'highlight:Underline' })
  await ui.press({ key: 'color:Blue' })
  const lit = await styleOfText(ui, S1)
  expect(lit?.underline).toBe(true)
  expect(lit?.color).toBe('#277DA1')
  expect(lit?.backgroundColor).toBeUndefined()

  await ui.press({ key: 'color:Orange' })
  expect((await styleOfText(ui, S1))?.color).toBe('#F8961E')
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

test('each colour is a swatch of its colour alone, the one in force ringed', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  fakeMachine(on, clock)
  const ui = await $.ui.mount({ ...reply(), surface: 'vscode' })
  await ui.press({ key: 'read' })
  await ui.press({ key: 'settings' })

  // Each swatch is its colour alone: a blank, see-through button, the colour the background of
  // a box the button's size, rounded, so it fills the button to its border and no further.
  const blue = await ui.find({ key: 'color:Blue' })
  expect(blue?.props.label).toBe('\u2002')
  expect(blue?.props.dimColor).toBe(true)
  const box = await ui.find({ key: 'swatch:Blue' })
  expect(box?.props.backgroundColor).toBe('#277DA1')
  expect(box?.props.borderStyle).toBe('round')
  expect(box?.props.borderColor).toBe('background')
  expect(await ui.findAll({ type: 'Text', text: /^Blue$/ })).toEqual([])
  expect(await chosenSwatch(ui, SWATCHES)).toBe('Yellow')

  // A dark swatch: the sentence marked in it with white text, the dot moved onto it.
  await ui.press({ key: 'color:Blue' })
  expect(await litColour(ui, S1)).toBe('#277DA1')
  expect((await styleOfText(ui, S1))?.color).toBe('#FFFFFF')
  expect(await chosenSwatch(ui, SWATCHES)).toBe('Blue')
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

test('with the highlight off, a colour picked turns the marker on', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  fakeMachine(on, clock)
  const ui = await $.ui.mount({ ...reply(), surface: 'vscode' })
  await ui.press({ key: 'read' })
  await ui.press({ key: 'settings' })
  await ui.press({ key: 'highlight:Off' })
  expect(await litColour(ui, S1)).toBeUndefined()
  await ui.press({ key: 'color:Green' })
  expect(await chosen(ui, 'highlight', ['Marker', 'Underline', 'Off'])).toBe('Marker')
  expect(await litColour(ui, S1)).toBe('#90BE6D')
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

test('a custom #RGB colour from /config marks the sentence, offered as one more swatch', { ...SLOW, options: { highlightColor: 'custom', customColor: 'f0c' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  fakeMachine(on, clock)
  const ui = await $.ui.mount({ ...reply(), surface: 'vscode' })
  await ui.press({ key: 'read' })
  expect(await litColour(ui, S1)).toBe('#FF00CC')
  await ui.press({ key: 'settings' })
  expect(await chosenSwatch(ui, [...SWATCHES, '#FF00CC'])).toBe('#FF00CC')
  // Another swatch picked, the configured colour stays on offer to go back to.
  await ui.press({ key: 'color:Red' })
  expect(await litColour(ui, S1)).toBe('#F94144')
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

test('a colour from /config by name marks the sentence in its swatch', { ...SLOW, options: { highlightColor: 'teal' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  fakeMachine(on, clock)
  const ui = await $.ui.mount({ ...reply(), surface: 'vscode' })
  await ui.press({ key: 'read' })
  expect(await litColour(ui, S1)).toBe('#43AA8B')
  await ui.press({ key: 'settings' })
  expect(await chosenSwatch(ui, SWATCHES)).toBe('Teal')
  expect(await ui.find({ key: 'color:#43AA8B' })).toBeUndefined()
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

test('auto-read turned on in the menu reads the next answer, without the chime turned off there', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const ui = await $.ui.mount({ ...reply('msg-9', ANSWER), surface: 'vscode' })
  await ui.press({ key: 'settings' })
  await ui.press({ key: 'autoRead:On' })
  await ui.press({ key: 'chime:Off' })
  await $.turn.complete(answered(ANSWER))
  await clock.settle()
  expect(host.played).toEqual([heard(A1)])
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

test('with auto-read on, a finished answer is read from the block it is drawn in', { ...SLOW, options: { autoRead: true } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const ui = await $.ui.mount({ ...reply('msg-9', ANSWER), surface: 'vscode' })
  // Drawing a reply starts nothing by itself, nor does a subagent's answer.
  expect(await isIdle(ui)).toBe(true)
  await $.turn.complete({ ...answered(ANSWER), agentId: 'agent-1' })
  expect(host.said).toEqual([])

  await $.turn.complete(answered(ANSWER))
  // The reading runs on after the turn's hook returns: let it get as far as it can.
  await clock.settle()
  // A soft chime first, while the first sentence is made; then the answer.
  expect(host.listed).toEqual(['claim:yield'])
  expect(host.played).toEqual(['chime'])
  expect(host.said[0]).toBe('The answer is here. @1')
  expect(await litColour(ui, A1)).toBe(YELLOW)
  await clock.advance(1000)
  expect(host.played[1]).toBe(heard(A1))

  // Once read through, nothing starts it again.
  await clock.advance(2000)
  expect(await isIdle(ui)).toBe(true)
  await clock.advance(2000)
  expect(host.played).toHaveLength(3)
  await ui.unmount()
})

test('with the chime turned off, auto-read starts with the answer itself', { ...SLOW, options: { autoRead: true, chime: false } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const ui = await $.ui.mount({ ...reply('msg-9', ANSWER), surface: 'vscode' })
  await $.turn.complete(answered(ANSWER))
  await clock.settle()
  expect(host.played).toEqual([heard(A1)])
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

test('while another session is heard, an answer read automatically gives way: only its chime sounds', { ...SLOW, options: { autoRead: true } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock, { otherHeard: true })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const ui = await $.ui.mount({ ...reply('msg-9', ANSWER), surface: 'vscode' })
  await $.turn.complete(answered(ANSWER))
  await clock.advance(5000)
  expect(host.listed).toEqual(['claim:yield'])
  expect(host.played).toEqual(['chime (over)'])
  expect(host.said).toEqual([])
  expect(await isIdle(ui)).toBe(true)
  await ui.unmount()
})

test('while a microphone records, an answer read automatically is not read, and no chime sounds', { ...SLOW, options: { autoRead: true } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock)
  host.setMic(true)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const ui = await $.ui.mount({ ...reply('msg-9', ANSWER), surface: 'vscode' })
  await $.turn.complete(answered(ANSWER))
  await clock.advance(5000)
  expect(host.listed).toEqual(['claim:yield'])
  expect(host.played).toEqual([])
  expect(host.said).toEqual([])
  expect(await isIdle(ui)).toBe(true)
  await ui.unmount()
})

test('while another session is heard, with the chime off, an answer read automatically makes no sound', { ...SLOW, options: { autoRead: true, chime: false } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock, { otherHeard: true })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const ui = await $.ui.mount({ ...reply('msg-9', ANSWER), surface: 'vscode' })
  await $.turn.complete(answered(ANSWER))
  await clock.advance(5000)
  expect(host.played).toEqual([])
  expect(host.said).toEqual([])
  expect(await isIdle(ui)).toBe(true)
  await ui.unmount()
})

test('the play button reads even while another session is heard', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock, { otherHeard: true })
  const ui = await $.ui.mount({ ...reply(), surface: 'vscode' })
  await ui.press({ key: 'read' })
  expect(host.listed).toEqual(['claim:take'])
  expect(host.played).toEqual([heard(S1)])
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

test('auto-read and the chime turned off in the menu apply to the next answer', { ...SLOW, options: { autoRead: true, chime: true } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const ui = await $.ui.mount({ ...reply('msg-9', ANSWER), surface: 'vscode' })
  await ui.press({ key: 'settings' })
  await ui.press({ key: 'chime:Off' })
  await $.turn.complete(answered(ANSWER))
  await clock.settle()
  expect(host.played).toEqual([heard(A1)])
  await ui.press({ key: 'stop' })
  await ui.press({ key: 'autoRead:Off' })
  host.played.length = 0
  host.said.length = 0
  await $.turn.complete(answered(ANSWER))
  await clock.settle()
  expect(host.said).toEqual([])
  await ui.unmount()
})

test('with auto-read off, a finished answer is not read', { ...SLOW, options: { autoRead: false } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const ui = await $.ui.mount({ ...reply('msg-9', ANSWER), surface: 'vscode' })
  await $.turn.complete(answered(ANSWER))
  expect(host.said).toEqual([])
  expect(await isIdle(ui)).toBe(true)
  await ui.unmount()
})

const FRENCH = "J'ai modifié la boucle pour qu'elle attende le clip avant de jouer le suivant. Les tests passent et le lecteur est plus stable avec cette version."

const SPANISH = 'He cambiado el bucle para que espere el clip antes de reproducir el siguiente. Las pruebas pasan y el lector es más estable con esta versión.'

test('a French reply is read in the French voice, as French', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock)
  const ui = await $.ui.mount({ ...reply('msg-fr', FRENCH), surface: 'vscode' })
  await ui.press({ key: 'read' })
  expect(await ui.find({ key: 'notice:read' })).toBeUndefined()
  expect(host.said[0]).toMatch(/^J'ai modifié/)
  expect(host.voices).toEqual(['ff_siwis', 'ff_siwis'])
  expect(host.langs).toEqual(['fr', 'fr'])
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

test('a reply that changes language is read sentence by sentence in the voice of each', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock)
  const mixed = `Here is the note you asked for, and it is in French.\n\n${FRENCH}\n\nThat is all that was changed in this file.`
  const ui = await $.ui.mount({ ...reply('msg-mixed', mixed), surface: 'vscode' })
  await ui.press({ key: 'read' })
  await clock.advance(1000)
  await clock.advance(1000)
  await clock.advance(1000)
  expect(host.voices).toEqual(['af_heart', 'ff_siwis', 'ff_siwis', 'af_heart'])
  expect(host.langs).toEqual(['en', 'fr', 'fr', 'en'])
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

const JAPANESE = 'ループを変更して、次のクリップを再生する前に待つようにしました。テストは通ります。'

test('a Spanish reply is read in a Spanish voice of the kind picked for English', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock)
  const ui = await $.ui.mount({ ...reply('msg-es', SPANISH), surface: 'vscode' })
  await ui.press({ key: 'read' })
  expect(await ui.find({ key: 'notice:close' })).toBeUndefined()
  expect(host.said[0]).toMatch(/^He cambiado/)
  expect(host.voices).toEqual(['ef_dora', 'ef_dora'])
  expect(host.langs).toEqual(['es', 'es'])
  await ui.press({ key: 'stop' })
  // Michael picked: a man's voice for Spanish too.
  await ui.press({ key: 'settings' })
  await ui.press({ key: 'voice:Michael' })
  await clock.advance(1000)
  const before = host.voices.length
  await ui.press({ key: 'read' })
  expect(host.voices.slice(before)).toEqual(['em_alex', 'em_alex'])
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

test('a German reply, which Kokoro has no voice for, is read by the voice picked with German sounds', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock)
  const german = 'Ich habe die Schleife geändert, damit sie auf den Clip wartet. Die Tests sind jetzt grün und der Player ist mit dieser Version auch stabiler.'
  const ui = await $.ui.mount({ ...reply('msg-de', german), surface: 'vscode' })
  await ui.press({ key: 'read' })
  expect(host.voices).toEqual(['af_heart', 'af_heart'])
  expect(host.langs).toEqual(['de', 'de'])
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

test('an equation and a code name in a French sentence are named as English words', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock)
  const text = "Si $x^2 = 4$, alors la fonction `settingsNow` renvoie la valeur que nous avons choisie pour le lecteur."
  const ui = await $.ui.mount({ ...reply('msg-eq', text), surface: 'vscode' })
  await ui.press({ key: 'read' })
  expect(host.said[0]).toBe('Si x squared equals 4, alors la fonction settingsNow renvoie la valeur que nous avons choisie pour le lecteur. @1')
  expect(host.langs[0]).toBe('fr')
  expect(host.english[0]).toEqual([[1, 5], [8, 9]])
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

test('a reply in a language with no voice is not read, and says why', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock)
  const ui = await $.ui.mount({ ...reply('msg-ja', JAPANESE), surface: 'vscode' })
  await ui.press({ key: 'read' })
  expect(host.said).toEqual([])
  expect((await ui.find({ type: 'Text', text: /looks Japanese/ }))?.text).toContain('no voice for it yet')
  // Nothing of it can be read: no button offers to.
  expect(await ui.find({ key: 'notice:read' })).toBeUndefined()
  await ui.press({ key: 'notice:close' })
  expect(await ui.find({ type: 'Text', text: /looks Japanese/ })).toBeUndefined()
  await ui.unmount()
})

test('a reply mostly in a language with no voice offers to read the rest, and leaves the other sentences out', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock)
  const ui = await $.ui.mount({ ...reply('msg-ja', `${JAPANESE}\n\nThat is the Japanese note you asked for.`), surface: 'vscode' })
  await ui.press({ key: 'read' })
  expect(host.said).toEqual([])
  await ui.press({ key: 'notice:read' })
  expect(host.said).toEqual(['That is the Japanese note you asked for. @1'])
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

test('with auto-read on, an answer in a language with no voice is not read, and a toast says why', { ...SLOW, options: { autoRead: true } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const ui = await $.ui.mount({ ...reply('msg-ja', JAPANESE), surface: 'vscode' })
  await $.turn.complete(answered(JAPANESE))
  await clock.settle()
  expect(host.said).toEqual([])
  expect(host.played).toEqual([])
  expect(host.toasts.some(text => /looks Japanese/.test(text))).toBe(true)
  await ui.unmount()
})

test('a speech server of your own reads in the voice named: a French reply asks first', { ...SLOW, options: { server: 'http://127.0.0.1:8880' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock)
  const ui = await $.ui.mount({ ...reply('msg-fr', FRENCH), surface: 'vscode' })
  await ui.press({ key: 'read' })
  expect(host.said).toEqual([])
  expect((await ui.find({ type: 'Text', text: /looks French/ }))?.text).toContain('the voice you named')
  await ui.press({ key: 'notice:read' })
  expect(host.voices[0]).toBe('af_heart')
  expect(host.langs[0]).toBe('')
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

const PANEL = {
  plugin: 'readalong',
  component: 'Pane',
  requestId: 'readalong',
  props: { title: 'readalong', isFocused: true, bodyColumns: 100, placement: 'inline', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

test('/readalong reads the last answer by keyboard, and shows the sentence being read', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const shown = await $.ui.mount({ ...reply('msg-9', ANSWER), surface: 'terminal' })
  const panel = await $.ui.mount({ ...PANEL, surface: 'terminal' })
  // The reply on screen is the last answer until one finishes in this session, as in a resumed one.
  expect(await panel.find({ key: 'panel:read' })).toBeDefined()

  await $.turn.complete(answered(ANSWER))
  await panel.press({ key: 'panel:read' })
  expect(host.played).toEqual([heard(A1)])
  expect(await panel.find({ type: 'Text', text: A1 })).toBeDefined()
  // The reply it came from is lit, as with its own play button.
  expect(await litColour(shown, A1)).toBe(YELLOW)

  await panel.press({ key: 'panel:stop' })
  expect(await panel.find({ key: 'panel:read' })).toBeDefined()
  await panel.unmount()
  await shown.unmount()
})

test('/readalong offers the voices by name, and takes a colour by its hex code', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock)
  const panel = await $.ui.mount({ ...PANEL, surface: 'terminal' })
  expect(await panel.find({ key: 'voice:Emma, British' })).toBeDefined()

  await panel.input({ key: 'custom-color', text: '#ffb3c7' })
  expect(await panel.find({ key: 'color:#FFB3C7' })).toBeDefined()
  // The sample sentence shows the colour picked.
  expect(await litColour(panel, 'the sentence being read is marked')).toBe('#FFB3C7')

  await panel.input({ key: 'custom-color', text: 'pink' })
  expect(host.toasts.some(text => /"pink" is not a colour/.test(text))).toBe(true)
  await panel.unmount()
})

test('/readalong says what the voice is doing, and stops it on request', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run({ command: 'readalong', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  await clock.settle()
  const panel = await $.ui.mount({ ...PANEL, surface: 'terminal' })
  expect(await panel.find({ type: 'Text', text: /^Running on 127\.0\.0\.1:8881/ })).toBeDefined()
  expect(await panel.find({ type: 'Text', text: /stops a minute after the last session closes/ })).toBeDefined()
  expect(await panel.find({ type: 'Text', text: /with auto-read on, when Claude begins an answer/ })).toBeDefined()

  await panel.press({ key: 'panel:quit' })
  expect(host.ran.some(argv => argv.includes('stop'))).toBe(true)
  await panel.unmount()
})

test('in a terminal, the reading in progress is shown above the prompt, with keys for it', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock)
  const shown = await $.ui.mount({ ...reply(), surface: 'terminal' })
  const band = await $.ui.mount({
    plugin: 'readalong',
    component: 'AbovePrompt',
    requestId: 'above-prompt',
    props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
    surface: 'terminal',
  })
  expect(await band.find({ type: 'Text', text: 'engine' })).toBeDefined()

  await shown.press({ key: 'read' })
  expect(await band.find({ type: 'Text', text: S1 })).toBeDefined()
  expect((await band.find({ key: 'band:toggle' }))?.props.hotkey).toBe('1')
  await band.press({ key: 'band:next' })
  expect(host.played).toEqual([heard(S1), heard(S2)])
  await band.press({ key: 'band:stop' })
  expect(await band.find({ type: 'Text', text: 'engine' })).toBeDefined()
  await band.unmount()
  await shown.unmount()
})

test('when a reading ends by itself, the panel and the line above the prompt let it go', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  fakeMachine(on, clock)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const shown = await $.ui.mount({ ...reply('msg-9', ANSWER), surface: 'terminal' })
  const panel = await $.ui.mount({ ...PANEL, surface: 'terminal' })
  const band = await $.ui.mount({
    plugin: 'readalong',
    component: 'AbovePrompt',
    requestId: 'above-prompt',
    props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
    surface: 'terminal',
  })
  await $.turn.complete(answered(ANSWER))
  await panel.press({ key: 'panel:read' })
  expect(await band.find({ key: 'band:stop' })).toBeDefined()
  await clock.advance(1000)
  await clock.advance(1000)
  await clock.settle()
  expect(await panel.find({ key: 'panel:read' })).toBeDefined()
  expect(await panel.find({ key: 'panel:stop' })).toBeUndefined()
  expect(await band.find({ type: 'Text', text: 'engine' })).toBeDefined()
  await band.unmount()
  await panel.unmount()
  await shown.unmount()
})

test('a message the person sends closes the panel, but /readalong itself leaves the reading be', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock)
  const closed: string[] = []
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('ui.close', (_, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  const ui = await $.ui.mount({ ...reply(), surface: 'terminal' })
  await ui.press({ key: 'read' })
  await $.prompt.submit({ text: '/readalong', origin: { kind: 'composer' }, wait: false })
  await clock.settle()
  expect(closed).toEqual([])
  expect(host.listed).toEqual(['claim:take'])

  await $.prompt.submit({ text: 'Thanks, next question.', origin: { kind: 'composer' }, wait: false })
  await clock.settle()
  expect(closed).toEqual(['readalong'])
  expect(await ui.find({ key: 'next' })).toBeUndefined()
  await ui.unmount()
})

test('a lone player letter at the prompt works the player and is not sent to Claude', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock)
  const sent: string[] = []
  on('prompt.submit', (_, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const shown = await $.ui.mount({ ...reply('msg-9', ANSWER), surface: 'terminal' })
  // Nothing read yet, and no answer finished: a lone p is a message like any other.
  expect((await $.prompt.submit({ text: 'p', origin: { kind: 'composer' }, wait: false })).drop).toBeUndefined()
  expect(sent).toEqual(['p'])

  await $.turn.complete(answered(ANSWER))
  const read = await $.prompt.submit({ text: 'r', origin: { kind: 'composer' }, wait: false })
  expect(read.drop).toMatch(/not sent to Claude/)
  await clock.settle()
  expect(host.played).toEqual([heard(A1)])

  const paused = await $.prompt.submit({ text: ' P ', origin: { kind: 'composer' }, wait: false })
  expect(paused.drop).toMatch(/paused/)
  await clock.settle()
  expect(host.listed.at(-1)).toBe('release')
  // A longer message is the person's, and goes to Claude, ending the reading as before.
  await $.prompt.submit({ text: 'please continue', origin: { kind: 'composer' }, wait: false })
  expect(sent).toEqual(['p', 'please continue'])
  await shown.unmount()
})

// When the voice starts, and what a finished answer does whatever the order things happen in.

const LONG = 'This answer is long enough that its first hundred and sixty characters are already drawn while the model is still writing the rest of it. Then it goes on for a while longer. And it ends here.'
const B1 = 'A second answer.'
const SECOND = `${B1} Short too.`

test('an answer that ends before its block is drawn is read at once, and its block shows the player once drawn', { ...SLOW, options: { autoRead: true } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  await $.turn.complete(answered(ANSWER))
  await clock.advance(100)
  expect(host.played).toEqual(['chime'])
  // The editor draws the answer now: its block takes the reading over, lit and with its player.
  const ui = await $.ui.mount({ ...reply('msg-9', ANSWER), surface: 'vscode' })
  await clock.advance(1000)
  expect(host.played).toEqual(['chime', heard(A1)])
  expect(await litColour(ui, A1)).toBe(YELLOW)
  expect(await toggleShows(ui)).toBe('Pause')
  // Its controls work the reading: pause, then resume.
  await ui.press({ key: 'read' })
  expect(await toggleShows(ui)).toBe('Resume')
  await ui.press({ key: 'read' })
  expect(await toggleShows(ui)).toBe('Pause')
  await ui.press({ key: 'stop' })
  expect(await isIdle(ui)).toBe(true)
  await ui.unmount()
})

test('a short answer last drawn mid-sentence is read when the turn ends', { ...SLOW, options: { autoRead: true } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const ui = await $.ui.mount({ ...reply('msg-9', 'The answer is here. It has'), surface: 'vscode' })
  await $.turn.complete(answered(ANSWER))
  await clock.advance(1000)
  expect(host.played).toEqual(['chime', heard(A1)])
  await ui.unmount()
})

test('a long answer drawn while it was written is read in its block', { ...SLOW, options: { autoRead: true } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const ui = await $.ui.mount({ ...reply('msg-9', LONG.slice(0, 170)), surface: 'vscode' })
  await $.turn.complete(answered(LONG))
  await clock.advance(1000)
  expect(host.played[0]).toBe('chime')
  expect(host.said).toHaveLength(3)
  expect(await toggleShows(ui)).toBe('Pause')
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

test('an answer that ends while the voice is stopped starts it, shows it loading, then chimes and reads', { ...SLOW, options: { autoRead: true } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock, { isUp: false, startMs: 3000 })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const ui = await $.ui.mount({ ...reply('msg-9', ANSWER), surface: 'vscode' })
  await $.turn.complete(answered(ANSWER))
  await clock.advance(1500)
  expect(await toggleShows(ui)).toBe('Loading')
  expect(await ui.find({ type: 'Text', text: 'Starting the speech server…' })).toBeDefined()
  expect(host.played).toEqual([])
  await clock.advance(1600)
  expect(host.ran.filter(([, step]) => step === 'start')).toHaveLength(1)
  expect(host.played).toEqual(['chime'])
  await clock.advance(1000)
  expect(host.played).toEqual(['chime', heard(A1)])
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

test('with the voice not installed, an answer read automatically offers the install under it', { ...SLOW, options: { autoRead: true } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock, { isInstalled: false })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const ui = await $.ui.mount({ ...reply('msg-9', ANSWER), surface: 'vscode' })
  await $.turn.complete(answered(ANSWER))
  await clock.advance(2000)
  expect(host.toasts).toEqual([])
  expect(host.played).toEqual([])
  expect(await ui.find({ type: 'Text', text: /needs the readalong voice, which runs on this computer/ })).toBeDefined()
  await ui.unmount()
})

test('a message sent while the voice starts for an answer means it is not read', { ...SLOW, options: { autoRead: true } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock, { isUp: false, startMs: 3000 })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  const ui = await $.ui.mount({ ...reply('msg-9', ANSWER), surface: 'vscode' })
  await $.turn.complete(answered(ANSWER))
  await clock.advance(1000)
  await $.prompt.submit({ text: 'Actually, do something else.', origin: { kind: 'composer' }, wait: false })
  await clock.advance(5000)
  expect(host.played).toEqual([])
  expect(host.listed).toEqual([])
  expect(await isIdle(ui)).toBe(true)
  await ui.unmount()
})

test('of two answers that end while the voice starts, the later is read', { ...SLOW, options: { autoRead: true, chime: false } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock, { isUp: false, startMs: 3000 })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const one = await $.ui.mount({ ...reply('msg-1', ANSWER), surface: 'vscode' })
  const two = await $.ui.mount({ ...reply('msg-2', SECOND), surface: 'vscode' })
  await $.turn.complete(answered(ANSWER))
  await clock.advance(500)
  await $.turn.complete({ ...answered(SECOND), turnId: 'turn-2' })
  await clock.advance(4000)
  // The second answer, whole; nothing of the first.
  expect(host.played).toEqual([heard(B1), heard('Short too.')])
  // One start for both.
  expect(host.ran.filter(([, step]) => step === 'start')).toHaveLength(1)
  expect(await isIdle(one)).toBe(true)
  expect(await toggleShows(two)).toBe('Pause')
  await two.press({ key: 'stop' })
  await one.unmount()
  await two.unmount()
})

test('of two replies played while the voice starts, the one pressed last is read', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock, { isUp: false, startMs: 3000 })
  const one = await $.ui.mount({ ...reply('msg-1', ANSWER), surface: 'vscode' })
  const two = await $.ui.mount({ ...reply('msg-2', SECOND), surface: 'vscode' })
  void one.press({ key: 'read' })
  await clock.advance(500)
  void two.press({ key: 'read' })
  await clock.advance(3000)
  expect(host.played).toEqual([heard(B1)])
  expect(await isIdle(one)).toBe(true)
  await two.press({ key: 'stop' })
  await clock.advance(3000)
  expect(host.played).toEqual([heard(B1)])
  expect(host.ran.filter(([, step]) => step === 'start')).toHaveLength(1)
  await one.unmount()
  await two.unmount()
})

test('an answer paused while the voice starts holds still, and resumes without its chime', { ...SLOW, options: { autoRead: true } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock, { isUp: false, startMs: 3000 })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const ui = await $.ui.mount({ ...reply('msg-9', ANSWER), surface: 'vscode' })
  await $.turn.complete(answered(ANSWER))
  await clock.advance(1000)
  await ui.press({ key: 'read' })
  expect(await toggleShows(ui)).toBe('Resume')
  await clock.advance(5000)
  expect(host.played).toEqual([])
  expect(host.listed.filter(step => step.startsWith('claim'))).toEqual([])
  await ui.press({ key: 'read' })
  await clock.advance(100)
  expect(host.played).toEqual([heard(A1)])
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

test('the first answer of a session is read while the session-start update still runs', { ...SLOW, options: { autoRead: true } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock, { isUp: false, updateMs: 20_000 })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  const ui = await $.ui.mount({ ...reply('msg-9', ANSWER), surface: 'vscode' })
  await clock.advance(1000)
  await $.turn.complete(answered(ANSWER))
  await clock.advance(1500)
  expect(host.played).toEqual(['chime', heard(A1)])
  await ui.press({ key: 'stop' })
  await clock.advance(25_000)
  await ui.unmount()
})

test('a slow first sentence: the chime is heard while it is made', { ...SLOW, options: { autoRead: true } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock, { synthMs: 2500 })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const ui = await $.ui.mount({ ...reply('msg-9', ANSWER), surface: 'vscode' })
  await $.turn.complete(answered(ANSWER))
  await clock.advance(200)
  expect(host.played).toEqual(['chime'])
  await clock.advance(3000)
  expect(host.played).toEqual(['chime', heard(A1)])
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

const turnStarted = { text: 'Look at the tests.', turnId: 'turn-1' } as const

test('with auto-read on, the voice is started when a turn begins, so its answer is heard at once', { ...SLOW, options: { autoRead: true } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock, { isUp: false, startMs: 3000 })
  on('turn.start', () => ({ turnId: 'turn-1' }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const ui = await $.ui.mount({ ...reply('msg-9', ANSWER), surface: 'vscode' })
  await $.turn.start(turnStarted)
  await clock.advance(5000)
  expect(host.state.isUp).toBe(true)
  await $.turn.complete(answered(ANSWER))
  await clock.advance(10)
  expect(host.played).toEqual(['chime'])
  // A subagent's turn starts nothing; the voice up, a turn starts nothing either.
  expect(host.ran.filter(([, step]) => step === 'start')).toHaveLength(1)
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

test('with auto-read off, a turn beginning leaves a stopped voice stopped', SLOW, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const host = fakeMachine(on, clock, { isUp: false })
  on('turn.start', () => ({ turnId: 'turn-1' }))
  await $.turn.start(turnStarted)
  await clock.advance(5000)
  expect(host.state.isUp).toBe(false)
  expect(host.ran).toEqual([])
})
