// The readalong service, as the plugin sees it: where it is installed, starting it, and asking it
// things over HTTP.
//
// The service (server/serve.py) makes the speech and plays it, on Linux, macOS and Windows
// alike, so nothing here runs a shell or a Unix tool: the plugin only runs the installed Python
// on the service's own commands, and talks HTTP to it.

import type { EngineInterface } from 'claude-code'

import type { Settings } from './state'

type $ = EngineInterface

export const DEFAULT_PORT = 8881
/** What the plugin and the service agree on: the service's `protocol`, from its /health. */
export const PROTOCOL = 6

/** Something that keeps the service from answering, and what to do about it. */
export type Problem = { code: 'not-installed' | 'no-model' | 'down' | 'failed'; error: string }

export type Place = {
  isWindows: boolean
  sep: string
  /** The folder the voice is installed in; the installer picks the same. */
  home: string
  /** The installed Python, which runs the service. */
  python: string
  port: number
  /** The service's address. */
  url: string
}

export function join(sep: string, ...parts: string[]): string {
  return parts.map((part, i) => (i === 0 ? part.replace(/[\\/]+$/, '') : part.replace(/^[\\/]+|[\\/]+$/g, ''))).join(sep)
}

/** The plugin's data folder in Claude Code's own, as Claude Code names it: the plugin, then its marketplace. */
const DATA = ['plugins', 'data', 'readalong-readalong']

/**
 * Where the voice is installed on this computer: $READALONG_HOME; else the plugin's data folder,
 * in $CLAUDE_CONFIG_DIR or ~/.claude. Claude Code removes that folder when the plugin is
 * uninstalled, so removing the plugin removes the voice with it. server/install.py, bootstrap.sh
 * and bootstrap.ps1 pick the same.
 */
export async function place($: $): Promise<Place> {
  const isWindows = (await $.env.get('OS')) === 'Windows_NT' || /^[A-Za-z]:[\\/]/.test($.plugin.root)
  const sep = isWindows ? '\\' : '/'
  const given = (await $.env.get('READALONG_HOME'))?.trim()
  let home: string
  if (given) {
    home = given
  } else {
    const user = (isWindows ? await $.env.get('USERPROFILE') : await $.env.get('HOME')) ?? ''
    const claude = (await $.env.get('CLAUDE_CONFIG_DIR'))?.trim() || join(sep, user, '.claude')
    home = join(sep, claude, ...DATA)
  }
  const port = Number((await $.env.get('READALONG_PORT'))?.trim()) || DEFAULT_PORT
  const python = isWindows ? join(sep, home, 'server', '.venv', 'Scripts', 'python.exe') : join(sep, home, 'server', '.venv', 'bin', 'python')
  return { isWindows, sep, home, python, port, url: `http://127.0.0.1:${port}` }
}

/**
 * Whether `server` names a speech server of the user's own, rather than the readalong voice: any
 * address but the service's. With one, the service plays what that server makes.
 */
export function isOwnServer(s: Settings, p: Place): boolean {
  if (s.server === 'auto' || s.server === `http://127.0.0.1:${DEFAULT_PORT}`) return false
  const local = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]):(\d+)$/i.exec(s.server)
  return local === null || Number(local[2]) !== p.port
}

/** The same, asked of the settings alone where they tell: the readalong voice's usual address is never the user's own. */
export async function hasOwnServer($: $, s: Settings): Promise<boolean> {
  if (s.server === 'auto' || s.server === `http://127.0.0.1:${DEFAULT_PORT}`) return false
  // Any other address is the user's own, unless it turns out to be where the voice was moved to.
  const p = await place($).catch(() => null)
  return p === null || isOwnServer(s, p)
}

export type Answer = { ok: true; data: Record<string, unknown> } | { ok: false; status: number; code: string; error: string }

/** Asks the service `route` with `body`; never rejects. */
export async function call($: $, route: string, body: Record<string, unknown>): Promise<Answer> {
  const p = await place($)
  for (let attempt = 0; ; attempt += 1) {
    const token = await $.fs
      .read(join(p.sep, p.home, 'token'))
      .then(text => String(text).trim())
      .catch(() => '')
    let response
    try {
      response = await $.http.fetch(`${p.url}${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Readalong-Token': token },
        body: JSON.stringify(body),
      })
    } catch {
      return { ok: false, status: 0, code: 'down', error: `the readalong voice does not answer at ${p.url}` }
    }
    let data: Record<string, unknown> = {}
    try {
      const parsed: unknown = JSON.parse(response.text)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as Record<string, unknown>
    } catch {
      // Not JSON: not the readalong service, or one that failed before answering.
    }
    if (response.ok) return { ok: true, data }
    const code = typeof data.code === 'string' ? data.code : ''
    // A service started again since the token was read made a new one only if the file was gone.
    if (code === 'token' && attempt === 0) continue
    if (code === 'token') {
      const error = `the readalong voice at ${p.url} is another user's; set READALONG_PORT to give yours a port of its own`
      return { ok: false, status: response.status, code, error }
    }
    const error = typeof data.error === 'string' && data.error !== '' ? data.error : `the readalong voice answered ${response.status}`
    return { ok: false, status: response.status, code, error }
  }
}

type Health = { status: number; isOurs: boolean; isReady: boolean; protocol: number; hasModel: boolean }

async function health($: $, url: string): Promise<Health | null> {
  try {
    const response = await $.http.fetch(`${url}/health`)
    let said: Record<string, unknown> = {}
    try {
      said = JSON.parse(response.text) as Record<string, unknown>
    } catch {
      // Something answers that is not the service.
    }
    const isOurs = said?.service === 'readalong'
    return {
      status: response.status,
      isOurs,
      isReady: isOurs && response.ok,
      protocol: typeof said?.protocol === 'number' ? said.protocol : 0,
      hasModel: said?.model === true,
    }
  } catch {
    return null
  }
}

function serveOf(p: Place): string {
  return join(p.sep, p.home, 'server', 'serve.py')
}

/**
 * Whether the voice is installed: its Python is there, and the install or an update finished
 * (ready.json is written last). An install cut short is not, and is offered again, to finish it.
 */
async function isInstalled($: $, p: Place): Promise<boolean> {
  return (await $.fs.exists(p.python)) && (await $.fs.exists(join(p.sep, p.home, 'ready.json')))
}

function lastLine(text: string): string {
  return text.trim().split(/\r?\n/).filter(line => line.trim() !== '').slice(-1)[0]?.trim() ?? ''
}

/**
 * The start under way in this session, if any: every reading, warm-up and look-ahead that asks
 * meanwhile waits for this one rather than starting its own. `isStarting` is set once the start
 * itself begins, after the checks that may end it first.
 */
type Bringing = { done: Promise<Problem | null>; isStarting: boolean; onStarting: Array<() => Promise<void>> }
let bringing: Bringing | null = null

/**
 * Makes sure the service answers, starting it when it does not and it is installed; with a
 * speech server of the user's own, that one too, when there is a command to start it. Resolves
 * null once all is up, or the problem; never rejects. `onStarting` is called before a start that
 * takes a while, whoever began it.
 */
export async function ensureUp($: $, s: Settings, onStarting?: () => Promise<void>): Promise<Problem | null> {
  try {
    const p = await place($)
    const now = await health($, p.url)
    if (now?.isReady === true && now.protocol === PROTOCOL) return isOwnServer(s, p) ? await ensureOwn($, s, p) : null
    if (bringing === null) {
      const b: Bringing = { done: Promise.resolve(null), isStarting: false, onStarting: [] }
      const starting = async () => {
        b.isStarting = true
        await Promise.all(b.onStarting.map(told => told().catch(() => undefined)))
      }
      b.done = bringUp($, s, p, now, starting)
        .catch((err: unknown): Problem => ({ code: 'failed', error: String(err) }))
        .finally(() => {
          if (bringing === b) bringing = null
        })
      bringing = b
    }
    const b = bringing
    if (onStarting !== undefined) {
      if (b.isStarting) await onStarting().catch(() => undefined)
      else b.onStarting.push(onStarting)
    }
    return await b.done
  } catch (err) {
    return { code: 'failed', error: String(err) }
  }
}

/** Starts what does not answer: the service, then a speech server of the user's own. */
async function bringUp($: $, s: Settings, p: Place, now: Health | null, onStarting: () => Promise<void>): Promise<Problem | null> {
  const own = isOwnServer(s, p)
  if (now !== null && !now.isOurs) {
    return { code: 'down', error: `another program answers at ${p.url}; set READALONG_PORT to move the readalong voice to another port` }
  }
  if (!own && s.startCommand === 'none') {
    return { code: 'down', error: `nothing answers at ${p.url}; start the readalong voice, or set the start command to auto in /config` }
  }
  if (!(await isInstalled($, p))) return { code: 'not-installed', error: 'the readalong voice is not installed' }
  // A newer service than this session's plugin: a session started after an update runs it, and
  // stopping it would cut off that session's reading, so this older session asks for a new one.
  if (now !== null && now.isReady && now.protocol > PROTOCOL) return { code: 'failed', error: NEWER }
  if (now?.isReady !== true) await onStarting()
  // An older service (the plugin was updated) is stopped and started again from the installed
  // files; the update at session start does this too, so it happens here only mid-session.
  if (now !== null && now.isReady && now.protocol !== PROTOCOL) {
    await $.process.run([p.python, '-I', serveOf(p), 'stop', '--data', p.home, '--port', String(p.port)], { timeoutMs: 30_000 }).catch(() => undefined)
  }
  // Waits in a child process, not on the clock, so the wait spends no hook budget.
  const started = await $.process
    .run([p.python, '-I', serveOf(p), 'start', '--data', p.home, '--port', String(p.port)], { timeoutMs: 90_000 })
    .catch((err: unknown) => ({ exitCode: 1, stderr: String(err) }))
  if (started.exitCode !== 0) return { code: 'failed', error: lastLine(started.stderr) || 'the readalong voice did not start' }
  const after = await health($, p.url)
  if (after !== null && after.isReady && after.protocol !== PROTOCOL) return { code: 'failed', error: NEWER }
  return own ? ensureOwn($, s, p) : null
}

const NEWER = 'the installed voice and this session are of different readalong versions; start a new Claude Code session'

/** Starts the user's own speech server by its start command, when it has one and does not answer. */
async function ensureOwn($: $, s: Settings, p: Place): Promise<Problem | null> {
  if (s.startCommand === 'auto' || s.startCommand === 'none') return null
  if ((await health($, s.server)) !== null) return null
  await $.process.run([p.python, '-I', serveOf(p), 'spawn', s.startCommand], { timeoutMs: 30_000 }).catch(() => undefined)
  await $.process.run([p.python, '-I', serveOf(p), 'wait', s.server, '--seconds', '60'], { timeoutMs: 70_000 }).catch(() => undefined)
  return null
}

/**
 * When a session starts: brings an installed voice up to this plugin's version and starts it, so
 * the first press finds it ready (the bundled voice is up in about two seconds). Nothing when the
 * voice is not installed: the first press offers to install it.
 */
export async function warmUp($: $, s: Settings) {
  const p = await place($)
  if (!(await $.fs.exists(p.python))) return
  if (!isOwnServer(s, p) && s.startCommand === 'none') return
  const installer = join(p.sep, $.plugin.root, 'server', 'install.py')
  // Quick when nothing changed; when the packages did, uv installs them (up to a few minutes).
  // An install from before the first release, which wrote no ready.json, is brought up to date here and writes it.
  await $.process.run([p.python, '-I', installer, '--home', p.home, '--port', String(p.port), '--update'], { timeoutMs: 600_000 }).catch(() => undefined)
  await ensureUp($, s)
}

/** The command that installs the voice: the bootstrap script for this system, which fetches uv if need be. */
export function installCommand($: $, p: Place, withModel: boolean): string[] {
  const options = ['--progress', 'json', '--no-sound', '--port', String(p.port), ...(withModel ? [] : ['--no-model'])]
  if (p.isWindows) {
    const script = join(p.sep, $.plugin.root, 'server', 'bootstrap.ps1')
    return ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...options]
  }
  return ['sh', join(p.sep, $.plugin.root, 'server', 'bootstrap.sh'), ...options]
}

/**
 * Tells the service this session is open, or that it closed. The service lives as long as the
 * sessions that say so, and a minute longer: one that stops saying it (closed, or killed) counts
 * as gone after 90 seconds. Never starts the service, and never rejects.
 */
export async function sayOpen($: $, session: string, isOpen: boolean): Promise<void> {
  await call($, '/v1/session', { session, open: isOpen })
}

/** What the voice is doing, for the `/readalong` panel: running, and since when, or why not. */
export type VoiceStatus =
  | { state: 'running'; since: number; sessions: number; port: number; home: string }
  | { state: 'stopped' | 'not-installed' | 'other'; port: number; home: string }

export async function voiceStatus($: $): Promise<VoiceStatus> {
  const p = await place($)
  const where = { port: p.port, home: p.home }
  try {
    const response = await $.http.fetch(`${p.url}/health`)
    const said = JSON.parse(response.text) as Record<string, unknown>
    if (said?.service !== 'readalong') return { state: 'other', ...where }
    const since = typeof said.since === 'number' ? said.since : 0
    const sessions = typeof said.sessions === 'number' ? said.sessions : 0
    return { state: 'running', since, sessions, ...where }
  } catch {
    return { state: (await isInstalled($, p)) ? 'stopped' : 'not-installed', ...where }
  }
}

/** Stops the voice now, for every session; the next press starts it again. */
export async function stopVoice($: $): Promise<void> {
  const p = await place($)
  if (!(await $.fs.exists(p.python))) return
  await $.process.run([p.python, '-I', serveOf(p), 'stop', '--data', p.home, '--port', String(p.port)], { timeoutMs: 30_000 }).catch(() => undefined)
}
