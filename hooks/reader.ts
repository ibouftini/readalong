// Reads a reply sentence by sentence.
//
// Each sentence is made into audio by the readalong service (one request at a time, the sentence
// being read first, then the next two), and the service plays it. Playing one sentence at a time
// is what lets the reader highlight it, step back or forward, pause and change speed without
// losing its place: a step or a new speed stops the sentence playing and starts the one wanted,
// from its audio when it is already made.
//
// Each sentence is read in the language it is written in: an English one in the voice picked, one
// in another language in that language's own voice, or in the voice picked where Kokoro has none
// for it, pronounced by that language's rules; its equations and code names in English.
//
// The service also says when each word of a sentence starts in its audio; while the sentence
// plays, a timer per word moves the reader's place to that word, for the highlight to follow
// when it follows words.
//
// Every session's sound goes through the one service, which also decides which reading is heard:
// a reading claims the voice before it plays, and one claimed by another session takes it over.
// The service also stops the reading heard when a program starts to record from a microphone,
// as for dictation, so the voice does not talk into it; the reading then ends, as a stop ends it.
//
// `$` is handed to every function rather than kept in the run: the engine reads each call on it
// where it is spelled.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Timer } from 'claude-code'

import type { Phase } from '../types'
import { offerInstall } from './install'
import type { Spoken } from './language'
import { call, ensureUp, isOwnServer, place } from './service'
import type { Answer, Problem } from './service'
import { voiceFor } from './state'
import type { Settings } from './state'

type $ = EngineInterface

// The engine reads each file's state values off its source, so each file names its own.
const player = atom({ plugin: 'readalong', key: 'player' } as const, null)
const pickedSpeed = atom({ plugin: 'readalong', key: 'speed' } as const, null)
const frame = atom({ plugin: 'readalong', key: 'frame' } as const, 0)
const followState = atom({ plugin: 'readalong', key: 'follow' } as const, null)

/** Sentences made ahead of the one being read. */
const AHEAD = 2
const SPIN_MS = 120
/** How long one wait for a sound to end is held by the service, in seconds. */
const WAIT_S = 15

/** A sentence's audio, kept by the service, with when each of its spoken words starts, in ms; none from a server that does not say. */
type Clip = { clip: string; words: number[] } | { error: string; problem?: Problem } | { isCancelled: true }

/** A sentence to read: what is said, the language it is said in, and which of its words are English all the same. */
export type Line = { speech: string; language: Spoken; english: ReadonlyArray<readonly [number, number]> }

type Job = { key: string; index: number; speed: number; voice: string; resolve: (clip: Clip) => void }

/**
 * How a sound ended: played to its end, cut short by this reading, taken by another session's,
 * stopped as a microphone started recording, or why it failed.
 */
type Played = 'done' | 'cancelled' | 'taken' | 'mic' | { error: string }

type Run = {
  s: Settings
  id: string
  mark: string
  speech: readonly Line[]
  index: number
  phase: Phase
  /** The word of the sentence being said, by its index among the spoken words; null while none is timed. */
  word: number | null
  /** Whether the server has timed the words of a sentence of this reading. */
  isTimed: boolean
  speed: number
  /** The voice picked, which reads the English sentences. */
  voice: string
  /** Bumped by every step, pause, new speed and stop, so work started before it stands down. */
  token: number
  clips: Map<string, Promise<Clip>>
  made: Set<string>
  jobs: Job[]
  isWorking: boolean
  isLooping: boolean
  isClosed: boolean
  spinner?: Timer
  /** The service up, or what keeps it down; settled once per reading. */
  server?: Promise<Problem | null>
  /** Whether this reading holds the voice: from its claim until a pause, its end, or another session's taking it. */
  isClaimed: boolean
  /** The soft chime played once before the first sentence, while that sentence is made. */
  hasChime: boolean
  /**
   * Whether an answer read automatically is still finding out if it reads: the voice starting,
   * then whether another session's reading is heard. Nothing plays meanwhile.
   */
  isDeciding: boolean
  /** The reading's name for the service, which knows which reading is heard by it. */
  owner: string
}

let run: Run | null = null
/** Whether following words has been said to fall back to sentences, once per load. */
let isUntimedSaid = false

/** Whether the reply with text `mark`, known by any of `ids`, is the one being read. */
export function isReading(ids: readonly string[], mark: string): boolean {
  return run !== null && ids.includes(run.id) && run.mark === mark
}

/** The sentence being read, as it is said, and its language; undefined while nothing is read. */
export function sentenceNow(): Line | undefined {
  return run === null || run.id === HELLO ? undefined : run.speech[run.index]
}

/**
 * Starts reading a reply from its first sentence at `speed`, its English sentences in `voice`,
 * stopping whatever was being read; with `chime`, a soft chime plays first.
 *
 * With `yields`, as for an answer read automatically, it reads only when no other session is
 * being heard: otherwise it plays the chime alone, if it has one, so the listener knows another
 * answer is ready without losing the one being read, and reads nothing.
 *
 * The reading is this session's from the moment it is asked for, the voice starting included:
 * a stop, a message sent, or a newer reading ends it there, and nothing of it is heard after.
 */
export async function start(
  $: $,
  s: Settings,
  id: string,
  mark: string,
  speech: readonly Line[],
  speed: number,
  voice: string,
  options: { chime?: boolean; yields?: boolean } = {},
) {
  if (speech.length === 0) {
    if (run !== null) await close($, run)
    return
  }
  const r: Run = {
    owner: crypto.randomUUID(),
    isClaimed: false,
    hasChime: options.chime === true,
    isDeciding: options.yields === true,
    s,
    id,
    mark,
    speech,
    index: 0,
    phase: 'loading',
    word: null,
    isTimed: false,
    speed,
    voice,
    token: 0,
    clips: new Map(),
    made: new Set(),
    jobs: [],
    isWorking: false,
    isLooping: false,
    isClosed: false,
  }
  // Taken over at once, before any wait, so two readings asked for together never both go on.
  const previous = run
  run = r
  if (previous !== null) await close($, previous)
  if (r.isClosed) return
  if (r.isDeciding && !(await decide($, r))) return
  await publish($, r)
  void loop($, r)
}

/**
 * For an answer read automatically: starts the voice if it is not up (the reply shows it
 * loading meanwhile), then claims it unless another session's reading is heard. True when it
 * reads; otherwise it has ended, or was paused meanwhile and holds still.
 */
async function decide($: $, r: Run): Promise<boolean> {
  try {
    const problem = await ensureUp($, r.s, async () => {
      if (r.isClosed || r.phase === 'paused') return
      r.phase = 'starting'
      await publish($, r)
    })
    r.server = Promise.resolve(problem)
    if (r.isClosed) return false
    if (problem !== null) {
      await fail($, r, problem.error, problem)
      return false
    }
    if (isPaused(r)) return false
    const claimed = await call($, '/v1/claim', { owner: r.owner, yields: true })
    const isGranted = claimed.ok && claimed.data.granted === true
    if (r.isClosed || isPaused(r)) {
      // Ended or paused while it asked: a reading that does not play holds no voice.
      if (isGranted) await call($, '/v1/release', { owner: r.owner })
      return false
    }
    if (!isGranted) {
      // Another session's reading is heard: only the chime says this answer is ready. A
      // microphone recording hears no chime either. A claim that could not be asked reads
      // nothing: read anyway, it would take the voice from a reading being heard.
      if (claimed.ok && r.hasChime && claimed.data.reason !== 'mic') void chimeOver($, r.s)
      await close($, r)
      return false
    }
    r.isClaimed = true
    if (r.phase === 'starting') r.phase = 'loading'
    return true
  } finally {
    r.isDeciding = false
  }
}

/**
 * Pauses the reading, or resumes it from the start of the sentence it stopped in. A paused
 * reading is not heard, so another session's answer may be read meanwhile.
 */
export async function toggle($: $) {
  const r = run
  if (r === null) return
  r.token += 1
  r.word = null
  if (r.phase === 'paused') {
    r.phase = r.made.has(keyOf(r.index, r.speed, r.voice)) ? 'playing' : 'loading'
    // The service may have stopped on its idle timer during a long pause: asked again, it starts.
    r.server = undefined
    void loop($, r)
  } else {
    r.phase = 'paused'
    // A reading paused is picked up again by the listener: no chime announces it then.
    r.hasChime = false
    await letGo($, r)
  }
  await publish($, r)
}

/** Moves `delta` sentences; past the last one the reading ends. */
export async function step($: $, delta: number) {
  const r = run
  if (r === null) return
  const index = Math.max(0, r.index + delta)
  if (index >= r.speech.length) return close($, r)
  r.index = index
  r.token += 1
  r.word = null
  await hush($, r)
  if (r.phase !== 'paused') {
    r.phase = r.made.has(keyOf(index, r.speed, r.voice)) ? 'playing' : 'loading'
    void loop($, r)
  }
  await publish($, r)
  void work($, r)
}

/** Changes the speed, keeps it for later sessions, and says the current sentence again at it. */
export async function setSpeed($: $, s: Settings, speed: number) {
  await update($, pickedSpeed, () => speed)
  await $.store.set('speed', { value: speed, configured: s.speed })
  const r = run
  if (r === null || r.speed === speed) return
  r.speed = speed
  await restartSentence($, r)
}

/**
 * Reads on in `voice` from the start of the current sentence, as a new speed does; with nothing
 * being read, `voice` says `hello` instead, so it is heard. A paused reading keeps still, and
 * goes on in the voice when it resumes.
 */
export async function setVoice($: $, s: Settings, voice: string, hello: string, speed: number) {
  const r = run
  if (r === null || r.id === HELLO) return start($, s, HELLO, HELLO, [{ speech: hello, language: 'en', english: [] }], speed, voice)
  if (r.voice === voice) return
  r.voice = voice
  await restartSentence($, r)
}

async function restartSentence($: $, r: Run) {
  r.token += 1
  r.word = null
  await hush($, r)
  if (r.phase !== 'paused') {
    r.phase = 'loading'
    void loop($, r)
  }
  await publish($, r)
  void work($, r)
}

/** The id a voice saying hello reads under: no reply's, so no reply shows a player for it. */
const HELLO = ''

export async function stop($: $) {
  if (run !== null) await close($, run)
}

/** The speed to read at: the one picked in the player, unless the configured speed changed since. */
export async function restoreSpeed($: $, s: Settings) {
  const kept = (await $.store.get('speed')) as { value?: unknown; configured?: unknown } | undefined
  const value = typeof kept?.value === 'number' && kept.configured === s.speed ? kept.value : null
  await update($, pickedSpeed, () => value)
}

/** Clears what an earlier load of the module left: its player state. */
export async function reset($: $) {
  if (run !== null) await close($, run)
  await update($, player, () => null)
}

async function loop($: $, r: Run) {
  // While an answer read automatically is deciding, start() runs the loop once it reads.
  if (r.isLooping || r.isDeciding || r.isClosed) return
  r.isLooping = true
  try {
    if (!(await ready($, r))) return
    if (r.isClosed || isPaused(r)) return
    if (r.hasChime) {
      // The chime sounds while the first sentence is made, so it costs no time; one that cannot
      // play is skipped, and a pause, step or stop during it ends it as it ends a sentence.
      r.hasChime = false
      if (!r.isClaimed && !(await claim($, r))) return
      const token = r.token
      void clip($, r, r.index, r.speed, r.voice)
      const chimed = await playing($, r, token, await call($, '/v1/play', { sound: 'chime', owner: r.owner, player: r.s.player }))
      if (chimed === 'taken') return void (await yieldTo($, r))
      if (chimed === 'mic') return void (await close($, r))
    }
    let lost = -1
    while (!r.isClosed && !isPaused(r)) {
      if (r.index >= r.speech.length) return void (await close($, r))
      const { token, index, speed, voice } = r
      const pending = clip($, r, index, speed, voice)
      if (!r.made.has(keyOf(index, speed, voice)) && r.phase !== 'starting' && r.phase !== 'loading') {
        r.phase = 'loading'
        await publish($, r)
      }
      const got = await pending
      if (token !== r.token || r.isClosed || 'isCancelled' in got) continue
      if ('error' in got) return void (await fail($, r, got.error, got.problem))
      for (let ahead = 1; ahead <= AHEAD && index + ahead < r.speech.length; ahead += 1) void clip($, r, index + ahead, speed, voice)
      if (!r.isClaimed && !(await claim($, r))) return
      if (token !== r.token || r.isClosed) continue
      r.phase = 'playing'
      r.word = got.words.length > 0 ? 0 : null
      if (got.words.length > 0) r.isTimed = true
      else await sayUntimed($, r)
      await publish($, r)
      const started = await call($, '/v1/play', { clip: got.clip, owner: r.owner, player: r.s.player })
      if (!started.ok && started.code === 'unknown-clip' && lost !== index && token === r.token) {
        // The service no longer holds the clip (it started again, or other sessions' clips pushed it out): made again, once.
        lost = index
        r.clips.delete(keyOf(index, speed, voice))
        r.made.delete(keyOf(index, speed, voice))
        continue
      }
      const played = await playing($, r, token, started, got.words)
      r.word = null
      if (token !== r.token || r.isClosed || played === 'cancelled') continue
      if (played === 'taken') return void (await yieldTo($, r))
      if (played === 'mic') return void (await close($, r))
      if (played !== 'done') return void (await fail($, r, played.error))
      r.index += 1
    }
  } catch (err) {
    // Whatever went wrong, the reading stops and says why, rather than hanging on ⏸.
    if (!r.isClosed) await fail($, r, String(err)).catch(() => undefined)
  } finally {
    r.isLooping = false
  }
}

/** Starts the service when it does not answer, if it can, once per reading; false when it cannot, and the reading has ended. */
async function ready($: $, r: Run): Promise<boolean> {
  r.server ??= (async () => {
    const problem = await ensureUp($, r.s, async () => {
      if (r.isClosed) return
      r.phase = 'starting'
      await publish($, r)
    })
    if (r.phase === 'starting') {
      r.phase = 'loading'
      await publish($, r)
    }
    return problem
  })()
  const problem = await r.server
  if (problem === null) return true
  // A reading stopped while the service started has nothing to say.
  if (!r.isClosed) await fail($, r, problem.error, problem)
  return false
}

/** Takes the voice for this reading, over any other session's; false when the service could not be asked, and the reading has ended. */
async function claim($: $, r: Run): Promise<boolean> {
  const claimed = await call($, '/v1/claim', { owner: r.owner, yields: false })
  if (!claimed.ok) {
    if (r.isClosed) return false
    if (claimed.code === 'mic') await close($, r)
    else await fail($, r, claimed.error)
    return false
  }
  // Stopped or paused while it asked: the voice it was given goes back at once, so it holds no
  // one else's turn. Resuming asks again.
  if (r.isClosed || isPaused(r)) {
    await call($, '/v1/release', { owner: r.owner })
    return false
  }
  r.isClaimed = true
  return true
}

/**
 * Follows a sound the service started (`started`, its answer to /v1/play) to its end, the
 * reader's place moving to each of its `words` as it starts.
 */
async function playing($: $, r: Run, token: number, started: Answer, words: readonly number[] = []): Promise<Played> {
  if (!started.ok) {
    if (started.code === 'not-heard') return 'taken'
    return started.code === 'mic' ? 'mic' : { error: started.error }
  }
  const id = String(started.data.play ?? '')
  let state = String(started.data.state ?? '')
  let error = String(started.data.error ?? '')
  // Timed from when the service says the sound has started; the first word is lit already.
  const timers = state === 'playing' ? words.slice(1).map((ms, i) => $.clock.after(ms, () => void reach($, r, token, i + 1))) : []
  try {
    while (state === 'playing') {
      if (token !== r.token || r.isClosed) return 'cancelled'
      const waited = await call($, '/v1/wait', { play: id, owner: r.owner, seconds: WAIT_S })
      if (!waited.ok) return token !== r.token || r.isClosed ? 'cancelled' : { error: waited.error }
      state = String(waited.data.state ?? '')
      error = String(waited.data.error ?? '')
    }
  } finally {
    for (const timer of timers) timer.cancel()
  }
  if (token !== r.token || r.isClosed) return 'cancelled'
  if (state === 'done') return 'done'
  if (state === 'mic') return 'mic'
  // Stopped from outside this reading: another session's, or the service stopping for an update.
  if (state === 'taken' || state === 'stopped') return 'taken'
  return { error: error || `the sound ended as ${state || 'unknown'}` }
}

/** Another session's reading took the voice: this one holds still where it was, to resume from there. */
async function yieldTo($: $, r: Run) {
  if (r.isClosed) return
  r.token += 1
  r.word = null
  r.isClaimed = false
  r.phase = 'paused'
  await publish($, r)
}

/**
 * Whether the reading is paused now. Asked through a function: a pause comes in while the reader
 * waits, which a check of `r.phase` made before the wait cannot know.
 */
function isPaused(r: Run): boolean {
  return r.phase === 'paused'
}

function keyOf(index: number, speed: number, voice: string) {
  return `${index}@${speed}@${voice}`
}

/** The audio of one sentence at one speed in one voice: made once, then kept for the rest of the run. */
function clip($: $, r: Run, index: number, speed: number, voice: string): Promise<Clip> {
  const key = keyOf(index, speed, voice)
  let pending = r.clips.get(key)
  if (pending === undefined) {
    pending = new Promise<Clip>(resolve => r.jobs.push({ key, index, speed, voice, resolve }))
    r.clips.set(key, pending)
    void work($, r)
  }
  return pending
}

/** The one synthesis worker: the sentence being read first, then those after it, nothing stale. */
async function work($: $, r: Run) {
  if (r.isWorking) return
  r.isWorking = true
  try {
    for (;;) {
      r.jobs = r.jobs.filter(job => {
        const isStale = r.isClosed || job.speed !== r.speed || job.voice !== r.voice || job.index < r.index || job.index > r.index + AHEAD
        if (isStale) {
          r.clips.delete(job.key)
          job.resolve({ isCancelled: true })
        }
        return !isStale
      })
      const job = r.jobs.sort((a, b) => a.index - b.index).shift()
      if (job === undefined) break
      const made = await synthesize($, r, job).catch((err: unknown): Clip => ({ error: String(err) }))
      if ('clip' in made) r.made.add(job.key)
      // A sentence that failed ahead of time is asked again when it is reached.
      else if (job.index !== r.index) r.clips.delete(job.key)
      job.resolve(made)
    }
  } finally {
    r.isWorking = false
  }
}

async function synthesize($: $, r: Run, job: Job): Promise<Clip> {
  const problem = await (r.server ?? Promise.resolve(null))
  if (problem !== null) return { error: problem.error, problem }
  if (r.isClosed) return { isCancelled: true }
  const p = await place($)
  const own = isOwnServer(r.s, p)
  const line = r.speech[job.index]
  const made = await call($, '/v1/clips', {
    input: line?.speech,
    speed: job.speed,
    owner: r.owner,
    // A speech server of the user's own reads in the voice they named, whatever the language.
    ...(own
      ? { voice: job.voice, upstream: r.s.server }
      : { voice: voiceFor(line?.language ?? 'en', job.voice), lang: line?.language ?? 'en', ...(line?.english.length ? { english: line.english } : {}) }),
  })
  if (made.ok) {
    const words = Array.isArray(made.data.words) ? made.data.words.filter((ms): ms is number => typeof ms === 'number' && ms >= 0) : []
    return { clip: String(made.data.clip ?? ''), words }
  }
  if (made.code === 'no-model') {
    return { error: 'the voice model is not installed', problem: { code: 'no-model', error: 'the voice model is not installed' } }
  }
  if (made.code === 'upstream-down' && (r.s.startCommand === 'auto' || r.s.startCommand === 'none')) {
    return { error: `${made.error}; start it, or set a start command in /config` }
  }
  return { error: made.error }
}

/** With the highlight following words and a server that times none, says so once: the sentence is lit instead. */
async function sayUntimed($: $, r: Run) {
  if (isUntimedSaid || ((await read($, followState)) ?? r.s.follow) !== 'word') return
  isUntimedSaid = true
  const why = isOwnServer(r.s, await place($))
    ? `the speech server at ${r.s.server} sends no word timings`
    : 'the readalong voice gave no word timings'
  $.ui.toast(`Highlighting by sentence: ${why}`)
}

/** Moves the reader's place to word `word`, unless it has moved on; redrawn only when following words. */
async function reach($: $, r: Run, token: number, word: number) {
  if (token !== r.token || r.isClosed) return
  r.word = word
  if (((await read($, followState)) ?? r.s.follow) === 'word') await publish($, r)
}

/** Plays the chime over whatever is heard, as an answer that gave way does; it takes no one's turn. */
async function chimeOver($: $, s: Settings) {
  await call($, '/v1/play', { sound: 'chime', owner: crypto.randomUUID(), overlay: true, player: s.player })
}

/** Stops what this reading is playing; it keeps the voice. */
async function hush($: $, r: Run) {
  if (r.server !== undefined) await call($, '/v1/stop', { owner: r.owner })
}

/**
 * Stops what this reading is playing and lets the voice go, for another session's reading. A
 * claim still on its way when this runs gives the voice back itself (claim, decide).
 */
async function letGo($: $, r: Run) {
  const wasClaimed = r.isClaimed
  r.isClaimed = false
  if (wasClaimed) await call($, '/v1/release', { owner: r.owner })
}

/** Says why the reading cannot go on, and ends it; a voice not installed is offered for install instead. */
async function fail($: $, r: Run, why: string, problem?: Problem) {
  if (problem?.code === 'not-installed' || problem?.code === 'no-model') {
    await offerInstall($, r.id, !isOwnServer(r.s, await place($)))
  } else {
    $.ui.toast(`Could not read this aloud: ${why}`)
  }
  await close($, r)
}

async function close($: $, r: Run) {
  if (r.isClosed) return
  r.isClosed = true
  r.token += 1
  r.word = null
  spin($, r)
  if (run === r) run = null
  // Its player goes, unless another reading shows its own there already.
  await update($, player, p => (p?.id === r.id && p.mark === r.mark ? null : p))
  await letGo($, r)
  void work($, r)
}

/** Writes the run's place to session state, which redraws the reply it belongs to. */
async function publish($: $, r: Run) {
  spin($, r)
  if (run !== r || r.isClosed) return
  const now = { id: r.id, mark: r.mark, index: r.index, count: r.speech.length, phase: r.phase, word: r.word, isTimed: r.isTimed }
  await update($, player, () => now)
}

/** Turns the loading spinner on while the reader waits for audio, and off otherwise. */
function spin($: $, r: Run) {
  const isBusy = !r.isClosed && (r.phase === 'loading' || r.phase === 'starting')
  if (isBusy && r.spinner === undefined) {
    r.spinner = $.clock.every(SPIN_MS, () => void update($, frame, f => (f + 1) % 600))
  } else if (!isBusy && r.spinner !== undefined) {
    r.spinner.cancel()
    r.spinner = undefined
  }
}
