import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, TextProps } from 'claude-code'

import type { Setup } from '../types'
import { iconSvg } from './icons'
import type { IconName } from './icons'
import { dismissInstall, runInstall } from './install'
import { isSpoken, languageOf } from './language'
import type { Language } from './language'
import { isReading, reset, restoreSpeed, sentenceNow, setSpeed, start, step, stop, toggle } from './reader'
import { ensureUp, hasOwnServer, sayOpen, stopVoice, voiceStatus, warmUp } from './service'
import { autoReadNow, litBy, pickView, picksFor, restorePicks, settingsNow, settingsRows } from './settings'
import { settingsFrom, speedLabel, speedsWith } from './state'
import type { Settings } from './state'
import { markOf, parse, piecesOf, piecesTo, splitNested, terminalMarker, wordsOf } from './text'
import type { Block, Piece, Run } from './text'
import { breaksOf, isGapBefore, linesOfReply, roomOf, TEXT_LINES, textOf, WINDOW_LINES, windowOf } from './window'

// The engine reads each file's state values off its source, so each file names its own.
const player = atom({ plugin: 'readalong', key: 'player' } as const, null)
const frame = atom({ plugin: 'readalong', key: 'frame' } as const, 0)
const menuFor = atom({ plugin: 'readalong', key: 'menu' } as const, null)
const setupState = atom({ plugin: 'readalong', key: 'setup' } as const, null)
const noticeState = atom({ plugin: 'readalong', key: 'notice' } as const, null)
const lastReply = atom({ plugin: 'readalong', key: 'lastReply' } as const, null)
const serviceState = atom({ plugin: 'readalong', key: 'service' } as const, null)

/** The /readalong panel's id, and the command that opens it. */
const PANEL = 'readalong'

/** The terminal's loading spinner; the editor turns Lucide's loader icon instead. */
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/** What an icon button's own label holds: room for its icon, which is drawn beneath it. */
const ROOM = ' '

/**
 * A transparent pixel. The editor makes a box that holds a drawn picture a positioned one, which
 * stacks above any box that is not; one beside each button lifts the button over its icon.
 */
const LIFT = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill-opacity="0"/></svg>'

/** The icon's size in pixels, and how far in from the button's left edge it starts, in `ch`. */
const ICON = 14
// The editor's button is 8px of padding, a 1px border and the 1em label each side of the icon;
// at its 13px font that leaves (2 + 16 + 13 - 14) / 2 = 8.5px, about 1.15ch, either side.
const ICON_INSET = 1.15

/** Each control: its Lucide icon, the name a screen reader says, and its label where there are no icons. */
const CONTROLS = {
  read: { icon: 'volume-2', name: 'Read aloud', word: 'read aloud' },
  previous: { icon: 'skip-back', name: 'Previous sentence', word: 'previous' },
  pause: { icon: 'pause', name: 'Pause', word: 'pause' },
  resume: { icon: 'play', name: 'Resume', word: 'play' },
  loading: { icon: 'loader-circle', name: 'Loading', word: 'loading' },
  next: { icon: 'skip-forward', name: 'Next sentence', word: 'next' },
  stop: { icon: 'square', name: 'Stop reading', word: 'stop' },
  whole: { icon: 'chevrons-up-down', name: 'Show the whole reply', word: 'whole' },
  window: { icon: 'chevrons-down-up', name: 'Show the reading window', word: 'window' },
  slower: { icon: 'minus', name: 'Slower', word: '−' },
  faster: { icon: 'plus', name: 'Faster', word: '+' },
  settings: { icon: 'settings', name: 'Settings', word: 'settings' },
} satisfies Record<string, { icon: IconName; name: string; word: string }>

type ControlName = keyof typeof CONTROLS

/**
 * The reply blocks drawn so far, by the mark of their text: their id, so auto-read can find the
 * block a finished turn's answer is drawn in. Kept small: only the latest blocks matter.
 */
const drawnBlocks = new Map<string, string>()

/**
 * The reply block drawn last, for reading "the last answer" in a conversation resumed from
 * earlier, where no turn has finished in this session yet. Not session state: drawing writes it.
 */
let lastDrawn: { id: string; text: string } | null = null

/**
 * Claude Code's own lines in a reply's place, which are not replies: the one for a prompt a hook
 * dropped (such as a lone r taken as readalong's key), and the one it saves for a turn stopped
 * before any answer, which it does not draw. They get no button, and are never "the last answer".
 */
function isEngineLine(text: string): boolean {
  const said = text.trim()
  return said.startsWith('Prompt dropped by a hook') || said === 'No response requested.'
}

/** The id an answer is read under before the block it is drawn in is known. */
function answerId(mark: string): string {
  return `answer:${mark}`
}

/**
 * The answer that finished last before its block was drawn in its final form, as when the editor
 * draws a turn's last words after the turn has ended, or draws nothing while its panel is hidden.
 * It is read at once under `answerId`; the first block drawn with its text from then on is its
 * block, and shows its player (`aliasOf`). One at a time: a newer answer replaces it.
 */
let awaitedBlock: { mark: string; id: string } | null = null

/** A block that took over an answer read before it was drawn: the block's id, then the answer's. */
const aliasOf = new Map<string, string>()
const ALIASES_KEPT = 50

/** The last answer: the one that finished last in this session, else the reply drawn last. */
async function lastAnswer($: EngineInterface) {
  return (await read($, lastReply)) ?? lastDrawn
}
const DRAWN_KEPT = 200

/**
 * Whose voice reads: readalong's, each sentence in its own language; or a speech server of the
 * user's own, which reads in the one voice they named, every sentence as English.
 */
async function voiceOf($: EngineInterface, s: Settings): Promise<'readalong' | 'own'> {
  return (await hasOwnServer($, s)) ? 'own' : 'readalong'
}

/**
 * The language of a reply that no voice reads, to say so before reading what can be read of it;
 * null for a reply that is read. With a speech server of the user's own, any language but
 * English: its one voice may read it as if it were English.
 */
async function unreadLanguage($: EngineInterface, s: Settings, text: string): Promise<Language | null> {
  const language = languageOf(text)
  const isRead = (await hasOwnServer($, s)) ? language.code === 'en' : isSpoken(language.code)
  return isRead ? null : language
}

/** Why a reply in a language is not read without asking, after "this reply looks Japanese, and": */
async function whyUnread($: EngineInterface, s: Settings): Promise<string> {
  return (await hasOwnServer($, s))
    ? 'your speech server reads in the voice you named, which may read it as if it were English'
    : 'readalong has no voice for it yet'
}

export const register: Register = (on, options) => {
  const s = settingsFrom(options)

  /** This session, as it tells the voice it is open: the voice lives as long as the sessions that use it. */
  const session = crypto.randomUUID()
  let beat: { cancel: () => void } | undefined

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // Start the voice now, in the background, so the first press finds it ready; then say this
    // session is open, and keep saying so every 30 seconds.
    void warmUp($, s)
      .catch(() => undefined)
      .then(() => sayOpen($, session, true))
    beat?.cancel()
    beat = $.clock.every(30_000, () => void sayOpen($, session, true))
    void $.command
      .register({ name: PANEL, description: 'Read the last reply aloud, and change the voice and the highlight, by keyboard' })
      .catch(() => undefined)
    await reset($)
    await restoreSpeed($, s)
    // The settings as last picked in the menu, each unless its configured value changed since.
    await restorePicks($, s)
    await update($, menuFor, () => null)
    await update($, noticeState, () => null)
    // An install that was running ended with the module that ran it.
    await update($, setupState, () => null)
    return started
  })

  // With auto-read on, the voice is made ready while the model works, so the answer is heard as
  // soon as it ends: a voice stopped by its idle timer takes seconds to start, which a turn
  // nearly always outlasts. Nothing when the voice is up, but a look at it.
  on('turn.start', async ($, e, next) => {
    const started = await next(e)
    if (e.agentId === undefined) {
      void autoReadNow($, s)
        .then(({ isOn }) => (isOn ? ensureUp($, s) : null))
        .catch(() => undefined)
    }
    return started
  })

  // Auto-read: when the model has answered, read the answer at once, in the block it is drawn in;
  // one not drawn yet in its final form is read all the same, and its block shows the player
  // once drawn.
  on('turn.complete', async ($, e, next) => {
    const ended = await next(e)
    if (e.agentId !== undefined || e.reason !== 'answer' || e.answer.trim() === '') return ended
    const mark = markOf(e.answer)
    const drawnId = drawnBlocks.get(mark)
    const id = drawnId ?? answerId(mark)
    awaitedBlock = drawnId === undefined ? { mark, id } : null
    // Kept for /readalong, which reads the last answer from the keyboard.
    await update($, lastReply, () => ({ id, text: e.answer }))
    const { isOn, isChiming, voice, speed } = await autoReadNow($, s)
    if (!isOn) return ended
    // An answer in a language readalong has no voice for is not read with another's.
    const language = await unreadLanguage($, s, e.answer)
    if (language !== null) {
      $.ui.toast(`Not read aloud: this answer looks ${language.name}, and ${await whyUnread($, s)}`)
      return ended
    }
    const speech = parse(e.answer, await voiceOf($, s)).sentences
    if (speech.length > 0) {
      // A soft "ding ding" first, unless turned off (assets/chime.py makes it). While another
      // session's answer is being read, this one gives way: only its chime is heard. Not awaited:
      // starting the voice can take seconds, which the turn's end should not wait for.
      void start($, s, id, mark, speech, speed, voice, { chime: isChiming, yields: true }).catch(() => undefined)
    }
    return ended
  })

  on('session.end', async ($, e, next) => {
    beat?.cancel()
    // Both at once: the session's end allows little time.
    await Promise.all([stop($).catch(() => undefined), sayOpen($, session, false).catch(() => undefined)])
    return next(e)
  })

  // /readalong: the panel, which takes the keyboard. In a terminal it is the way to read and to
  // change the settings without a mouse: the buttons under a reply are clicked, and the terminal
  // reports clicks only in its fullscreen layout.
  //
  // Where it shows is Claude Code's choice, made from its layout, which it picks as a session
  // starts: in the fullscreen layout, beside the conversation from 110 columns, else above the
  // prompt; in the classic layout, above the prompt, and clicks never reach it. The panel says
  // which, so the person knows why, and how to have the same layout in every session.
  on('command.run', { command: PANEL }, async ($, e) => {
    await update($, serviceState, () => null)
    // The classic layout's panel holds three more rows: the lines that say clicks do not work there.
    const rows = e.presentation.isFullscreen ? 27 : 30
    const opened = await $.ui.open({ id: PANEL, title: 'readalong', focus: true, closeOnEscape: true, rows }).catch(() => undefined)
    void refreshService($).catch(() => undefined)
    return opened?.isPlaced === false ? { text: `readalong: the panel could not open (${opened.reason})` } : {}
  })

  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e) =>
    drawPanel($, s, $.ui.resolve(e), e.surface, e.surface === 'terminal' ? e.viewport?.isFullscreen : true),
  )

  // A message sent by the person, typed or from Remote Control, ends this session's reading, as
  // speaking does (the service stops a reading when a microphone starts recording): they have
  // moved on. A notification, another session's message or a schedule is not theirs, and leaves
  // it be. Not awaited, so the message is never held up.
  // The /readalong panel closes too: it is a dialog, and they have left it. Opening the panel
  // again is not moving on: it keeps the reading, and the panel open.
  //
  // A message that is one of the player's letters alone works the player instead, and is not sent
  // to Claude, which would cost a turn for nothing: r reads the last answer; p, b, n and s pause,
  // go back, go on and stop while a reply is read, and w switches a long reply between the window
  // and the whole reply. The prompt says so, so nothing is hidden.
  on('prompt.submit', async ($, e, next) => {
    const isPerson = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    const typed = e.text.trim().toLowerCase()
    if (isPerson && typed === 'r' && (await lastAnswer($)) !== null) {
      void readLastAnswer($, s).catch(() => undefined)
      clearPrompt($)
      return { drop: 'readalong: reading the last answer (r is its key, not sent to Claude)' }
    }
    const isReadingNow = (await read($, player)) !== null && sentenceNow() !== undefined
    const did = isPerson && isReadingNow ? KEYS[typed] : undefined
    if (did !== undefined) {
      if (typed === 'p') void toggle($).catch(() => undefined)
      else if (typed === 'b') void step($, -1).catch(() => undefined)
      else if (typed === 'n') void step($, 1).catch(() => undefined)
      else if (typed === 'w') void settingsNow($, s).then(now => pickView($, now.view === 'window' ? 'whole' : 'window')).catch(() => undefined)
      else void stop($).catch(() => undefined)
      clearPrompt($)
      return { drop: `readalong: ${did} (${typed} is its key while it reads, not sent to Claude)` }
    }
    const isPanel = /^\/readalong\b/.test(e.text.trim())
    if (isPerson && !isPanel) {
      void stop($).catch(() => undefined)
      void $.ui.close({ id: PANEL }).catch(() => undefined)
    }
    return next(e)
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const drawn = await next(e)
    // A summary, or Claude Code's own line for a prompt a hook dropped (such as a lone r taken as
    // readalong's key), is not a reply: it gets no button, and is never "the last answer".
    if (e.props.isSummary || drawn === null || drawn === undefined || isEngineLine(e.props.text)) return drawn
    const now = await settingsNow($, s)
    const reading = parse(e.props.text, await voiceOf($, s))
    // Nothing to read: only code or tables, which get no button; or a reply in a language no
    // voice reads, whose button says so.
    const unread = reading.sentences.length === 0 ? await unreadLanguage($, s, e.props.text) : null
    if (reading.sentences.length === 0 && unread === null) return drawn

    const mark = markOf(e.props.text)
    drawnBlocks.delete(mark)
    drawnBlocks.set(mark, e.requestId)
    lastDrawn = { id: e.requestId, text: e.props.text }
    if (drawnBlocks.size > DRAWN_KEPT) drawnBlocks.delete(drawnBlocks.keys().next().value ?? '')
    // The first block drawn with the text of an answer read before it was drawn is that answer's.
    if (awaitedBlock !== null && awaitedBlock.mark === mark) {
      aliasOf.set(e.requestId, awaitedBlock.id)
      awaitedBlock = null
      if (aliasOf.size > ALIASES_KEPT) aliasOf.delete(aliasOf.keys().next().value ?? '')
    }
    // The ids a reading, an install offer or a notice of this block may go by.
    const ids = [e.requestId, ...(aliasOf.has(e.requestId) ? [aliasOf.get(e.requestId) ?? ''] : [])]
    const owns = (id: string | undefined) => id !== undefined && ids.includes(id)
    const playing = await read($, player)
    const ui = $.ui.resolve(e)
    const { Box, Button, Text, Markdown } = ui
    // Icons where the surface draws SVG and lays a box over another: the editor and the desktop app.
    const Svg = (e.surface === 'vscode' || e.surface === 'desktop') && 'Svg' in ui ? ui.Svg : undefined
    const speedNow = async () => (await settingsNow($, s)).speed
    // A reply in a language readalong has no voice for says so first, rather than be read as if
    // it were English, which is hard to follow and sounds absurd; asked, what can be read of it is.
    const begin = async (isAsked = false) => {
      const language = isAsked ? null : await unreadLanguage($, s, e.props.text)
      if (language !== null) {
        return void update($, noticeState, () => ({ id: e.requestId, language: language.name, hasRest: reading.sentences.length > 0 }))
      }
      await update($, noticeState, n => (n?.id === e.requestId ? null : n))
      const { speed, voice } = await settingsNow($, s)
      await start($, s, e.requestId, mark, reading.sentences, speed, voice)
    }

    /**
     * A control: in the editor, a Lucide icon with a blank button over it; elsewhere a word.
     *
     * A button holds text only, so the icon is drawn under it: in a box of no width just before
     * the button, it spills into the button's place, centred by its padding (the editor has no
     * positions and no negative margins). The editor makes a box that holds a drawn picture a
     * positioned one, stacked above the button; a transparent pixel in the button's own box
     * makes that box positioned too, and coming later it stacks on top, so a click anywhere on
     * the control lands on the button. Checked in Chrome against the editor's own CSS.
     */
    const control = (key: string, which: ControlName, onPress: () => void, label?: string): RenderElement => {
      const { icon, name, word } = CONTROLS[which]
      if (Svg === undefined) return <Button key={key} plain dimColor label={label ?? word} onPress={onPress} />
      const source = iconSvg(icon, { size: ICON, isSpinning: which === 'loading' })
      return (
        <Box flexDirection="row" flexWrap="nowrap" alignItems="center">
          <Box width={0} flexShrink={0}>
            <Box flexShrink={0} paddingLeft={ICON_INSET}>
              <Svg source={source} alt={name} width={ICON} height={ICON} />
            </Box>
          </Box>
          <Box flexDirection="row" flexWrap="nowrap" alignItems="center">
            <Button key={key} dimColor label={ROOM} onPress={onPress} />
            {/* A space, not "": where the editor cannot draw, an empty alt shows its own notice. */}
            <Svg source={LIFT} alt=" " width={1} height={1} />
          </Box>
        </Box>
      )
    }

    // The settings menu, opened under this reply by its gear; one reply's at a time.
    const isMenuOpen = (await read($, menuFor)) === e.requestId
    const toggleMenu = () => void update($, menuFor, open => (open === e.requestId ? null : e.requestId))
    const { highlight, color, follow } = now
    // Two groups side by side where the reply is wide enough, one above the other where not.
    const rows = isMenuOpen ? settingsRows(ui, e.surface, now, picksFor($, s, now), false) : null
    const menu =
      rows === null ? null : (
        <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1} marginTop={1} rowGap={1}>
          <Box flexDirection="row" flexWrap="wrap" columnGap={4} rowGap={1}>
            <Box flexDirection="column" rowGap={1} minWidth={26}>
              {rows.reading}
            </Box>
            <Box flexDirection="column" rowGap={1} flexGrow={1} flexShrink={1}>
              {rows.looks}
            </Box>
          </Box>
          {e.surface === 'terminal' ? <Text dimColor>/readalong: the same by keyboard, and a colour of your own</Text> : null}
        </Box>
      )

    const notice = await read($, noticeState)
    const noticePanel =
      notice !== null && owns(notice.id) ? (
        <Box flexDirection="column" rowGap={1} borderStyle="round" borderDimColor paddingX={1} marginTop={1}>
          <Text>{`This reply looks ${notice.language}, and ${await whyUnread($, s)}.${notice.hasRest ? (await hasOwnServer($, s)) ? '' : ' The sentences in a language it reads can be read.' : ''}`}</Text>
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            {notice.hasRest ? <Button key="notice:read" label={(await hasOwnServer($, s)) ? 'Read it anyway' : 'Read the rest'} onPress={() => void begin(true)} /> : null}
            <Button key="notice:close" label="Close" dimColor onPress={() => void update($, noticeState, () => null)} />
          </Box>
        </Box>
      ) : null

    const setup = await read($, setupState)
    const setupPanel = setup !== null && owns(setup.id) ? drawSetup(ui, setup, () => void runInstall($, () => begin()), () => void dismissInstall($)) : null

    // A drawing only draws: reading starts from a press, or from turn.complete for auto-read.
    if (playing === null || !owns(playing.id) || playing.mark !== mark) {
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" alignItems="center" columnGap={1}>
            {control('read', 'read', () => void begin())}
            {control('settings', 'settings', toggleMenu)}
          </Box>
          {noticePanel}
          {setupPanel}
          {menu}
          {drawn}
        </Box>
      )
    }

    const index = Math.min(playing.index, reading.sentences.length - 1)
    const isBusy = playing.phase === 'loading' || playing.phase === 'starting'
    const speed = now.speed
    const playOrPause = () => void (isReading(ids, mark) ? toggle($) : begin())
    const nudgeSpeed = async (by: number) => {
      const current = await speedNow()
      const speeds = speedsWith(current)
      const wanted = speeds[speeds.indexOf(current) + by]
      if (wanted !== undefined) await setSpeed($, s, wanted)
    }
    const spinnerFrame = isBusy && Svg === undefined ? SPINNER[(await read($, frame)) % SPINNER.length] : undefined
    // A reply too tall to read without scrolling is drawn in a window that slides down it with the
    // reading (window.ts), unless the person switched to the whole reply; a shorter one is drawn
    // whole either way, and has no switch, which would change nothing.
    const isTerminal = e.surface === 'terminal'
    const width = e.viewport?.columns ?? 80
    const isLong = linesOfReply(reading, width, isTerminal).length > WINDOW_LINES
    const switchView = () => void pickView($, now.view === 'window' ? 'whole' : 'window')
    // Gaps in cells: the editor reads a number as `ch` and ignores the named steps.
    const gap = 1

    const controls = (
      <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={3}>
        <Box flexDirection="row" alignItems="center" columnGap={gap}>
          {control('previous', 'previous', () => void step($, -1))}
          {control('read', isBusy ? 'loading' : playing.phase === 'paused' ? 'resume' : 'pause', playOrPause, spinnerFrame)}
          {control('next', 'next', () => void step($, 1))}
          {control('stop', 'stop', () => void stop($))}
          {isLong ? control('view', now.view === 'window' ? 'whole' : 'window', switchView) : null}
          {control('settings', 'settings', toggleMenu)}
        </Box>
        <Box flexDirection="row" alignItems="center" columnGap={gap}>
          {control('slower', 'slower', () => void nudgeSpeed(-1))}
          <Text dimColor tabular>
            {speedLabel(speed)}
          </Text>
          {control('faster', 'faster', () => void nudgeSpeed(1))}
        </Box>
        {/* The terminal passes clicks only in its fullscreen layout: the letters work the player
            from the prompt, typed alone then Enter, in the order of the words they stand for. */}
        {isTerminal ? <Text dimColor>{`type b p n s${isLong ? ' w' : ''} + Enter`}</Text> : null}
        <Text dimColor tabular>
          {`${index + 1} / ${playing.count}`}
        </Text>
        {playing.phase === 'starting' ? <Text dimColor>Starting the speech server…</Text> : null}
      </Box>
    )

    const sentence = reading.sentences[index]
    const block = sentence === undefined ? undefined : reading.blocks[sentence.block]
    if (sentence === undefined || block === undefined) {
      return (
        <Box flexDirection="column">
          {controls}
          {setupPanel}
          {menu}
          {drawn}
        </Box>
      )
    }
    // With the highlight off the reply is still drawn here, only unmarked: drawn one way while it is
    // read, it keeps its height whatever the highlight. The player sits above the reply in every
    // state, so it never moves as reading starts, stops or the highlight changes.
    const lit = highlight === 'off' ? {} : litBy(highlight, color)
    // Following words: the word being said; before the sentence plays, its first word, where it
    // starts, once the server is known to time words. Until then, or with a server that times
    // none, the sentence, as without.
    const words = follow === 'word' ? wordsOf(block, sentence) : []
    const wordAt = playing.word ?? (playing.phase !== 'playing' && playing.isTimed ? 0 : undefined)
    const [litFrom, litTo] = (wordAt === undefined ? undefined : words[Math.min(wordAt, words.length - 1)]) ?? [sentence.start, sentence.end]

    // What has been read and what is being read stand out; the text after it, not read yet, is dim
    // unless the setting says plain.
    const ahead = now.unread === 'dim' ? { dimColor: true } : {}
    /** A block's pieces as drawn: styled, the lit one marked, and those not read yet dim where `isAhead` says. */
    const drawPieces = (pieces: readonly Piece[], isAhead: (piece: Piece) => boolean) =>
      pieces.map(piece => {
        const props = { ...styleOf(piece), ...(piece.isLit ? lit : {}), ...(isAhead(piece) ? ahead : {}) }
        return Object.keys(props).length === 0 ? piece.text : <Text {...props}>{piece.text}</Text>
      })
    /**
     * A block of text drawn as a row: its indent, quote bar and marker, then its text. The
     * terminal's Markdown marks a list item `- `, a task `- [ ] `: the row wears the same.
     */
    const row = (b: Block, text: ReturnType<typeof drawPieces>, gaps: { marginTop?: number; marginBottom?: number } = {}, isAhead = false) => {
      const marker = isTerminal ? terminalMarker(b.marker) : b.marker
      return (
        <Box flexDirection="row" flexShrink={0} {...gaps} paddingLeft={b.indent + (b.marker !== '' && !isTerminal ? 2 : 0)}>
          {b.isQuote ? <Text dimColor>{'▎ '}</Text> : null}
          {/* A list item not read yet has its marker dim with its text, as Markdown draws it. */}
          {marker !== '' ? <Text {...(isAhead ? ahead : {})}>{marker}</Text> : null}
          <Box flexGrow={1} flexShrink={1}>
            {b.isHeading ? <Text weight="bold">{text}</Text> : <Text>{text}</Text>}
          </Box>
        </Box>
      )
    }
    const current = drawPieces(piecesOf(block, litFrom, litTo), piece => piece.isAhead)

    // A long reply in the window: the blocks the window spans, each drawn from its start so its
    // lines break where they always do, the last cut after the window's last line.
    const view = isLong && now.view === 'window' ? windowOf(reading, sentence.block, litFrom, width, isTerminal) : ({ kind: 'whole' } as const)
    if (view.kind === 'window') {
      const shown: RenderElement[] = []
      for (let i = view.from; i <= view.to; i += 1) {
        const b = reading.blocks[i]
        if (b === undefined) continue
        const marginTop = i > view.from && isGapBefore(reading, i) ? 1 : 0
        const lines = i === view.to ? view.toLines : null
        // The window's last line is the blank row before this block: that row alone.
        if (lines === 0) {
          shown.push(<Box flexShrink={0} height={marginTop} />)
        } else if (b.kind === 'text') {
          const end = lines === null ? undefined : breaksOf(textOf(b), roomOf(b, width, isTerminal))[lines]
          const pieces = i === sentence.block ? piecesOf(block, litFrom, litTo) : piecesOf(b, 0, 0)
          const kept = end === undefined ? pieces : piecesTo(pieces, end)
          const text = i === sentence.block ? drawPieces(kept, piece => piece.isAhead) : drawPieces(kept, () => i > sentence.block)
          shown.push(row(b, text, { marginTop }, i > sentence.block))
        } else {
          // Code, a table, maths: drawn by Markdown, whole, its lines below the window cut away.
          const source = reading.lines.slice(b.from, b.to).join('\n')
          shown.push(
            <Box flexDirection="column" flexShrink={0} marginTop={marginTop} {...(lines === null ? {} : { height: lines, overflow: 'hidden' as const })}>
              <Markdown text={source} {...(i > sentence.block ? ahead : {})} />
            </Box>,
          )
        }
      }
      /** The line above or below the text: an arrow, dim and centred, where more of the reply is hidden; blank, so the text never moves, where none is. */
      const edge = (glyph: string, isShown: boolean) => (
        <Box flexDirection="row" flexShrink={0} height={1} justifyContent="center">
          {isShown ? <Text dimColor>{glyph}</Text> : null}
        </Box>
      )
      return (
        <Box flexDirection="column">
          {controls}
          {setupPanel}
          {menu}
          {/* The window: a fixed height, so the reply never grows or shrinks as it is read. Its text
              is drawn from the top at the reply's start; further on, down to the window's last line
              and aligned to the bottom, so the lines above that do not fit are cut away. */}
          <Box flexDirection="column" flexShrink={0} height={WINDOW_LINES}>
            {edge('▲', view.isMoreAbove)}
            <Box flexDirection="column" flexShrink={0} height={TEXT_LINES} overflow="hidden" justifyContent={view.isAtTop ? 'flex-start' : 'flex-end'}>
              {shown}
            </Box>
            {edge('▼', view.isMoreBelow)}
          </Box>
        </Box>
      )
    }

    // The whole reply around the sentence being read: the Markdown before its paragraph, the
    // paragraph itself with the sentence lit, then the Markdown after it.
    const before = reading.lines.slice(0, block.from).join('\n').replace(/\s+$/, '')
    const after = reading.lines
      .slice(block.to)
      .join('\n')
      .replace(/^(\s*\n)+/, '')
      .replace(/\s+$/, '')
    // The terminal leaves a blank row between paragraphs; the editor's own spacing is tighter.
    const gapAbove = isTerminal && before !== '' && reading.lines[block.from - 1]?.trim() === '' ? 1 : 0
    const gapBelow = isTerminal && after !== '' && reading.lines[block.to]?.trim() === '' ? 1 : 0
    // Items nested under the one read keep their indent, which Markdown drawn alone would lose.
    const below = splitNested(after)
    return (
      <Box flexDirection="column">
        {controls}
        {setupPanel}
        {menu}
        {before !== '' ? <Markdown text={before} /> : null}
        {row(block, current, { marginTop: gapAbove, marginBottom: gapBelow })}
        {below.nested !== '' ? (
          <Box flexDirection="column" paddingLeft={below.indent}>
            <Markdown text={below.nested} {...ahead} />
          </Box>
        ) : null}
        {below.rest === '' ? null : isTerminal && below.nested !== '' && below.isGap ? (
          <Box flexDirection="column" marginTop={1}>
            <Markdown text={below.rest} {...ahead} />
          </Box>
        ) : (
          <Markdown text={below.rest} {...ahead} />
        )}
      </Box>
    )
  })
}

/**
 * The install of the voice under the reply that offered it: what it is and a button to start it,
 * its progress while it runs, or why it stopped and a button to try again.
 */
function drawSetup(
  ui: ReturnType<EngineInterface['ui']['resolve']>,
  setup: NonNullable<Setup>,
  install: () => void,
  dismiss: () => void,
): RenderElement {
  const { Box, Button, Text } = ui
  const frame = (children: RenderElement[]) => (
    <Box flexDirection="column" rowGap={1} borderStyle="round" borderDimColor paddingX={1} marginTop={1}>
      {children}
    </Box>
  )
  if (setup.phase === 'installing') {
    const clock = `${Math.floor(setup.seconds / 60)}:${String(setup.seconds % 60).padStart(2, '0')}`
    const counted =
      setup.mb !== null ? `: ${setup.mb.done} of ${setup.mb.total} MB, ${setup.percent ?? 0}%` : setup.percent === null ? '' : `: ${setup.percent}%`
    return frame([
      <Text key="progress-step" weight="bold">
        {`Installing the voice, step ${setup.step} of ${setup.steps} (${clock})`}
      </Text>,
      <Text key="progress">{`${setup.text}${counted}…`}</Text>,
      <Text key="progress-note" dimColor>
        Keep working meanwhile: this reply is read once the voice is ready.
      </Text>,
    ])
  }
  const isFailed = setup.phase === 'failed'
  const about = setup.withModel
    ? 'Reading aloud needs the readalong voice, which runs on this computer: nothing is sent anywhere. Installing it downloads about 400 MB, once, and takes a minute or two.'
    : 'Playing the speech of your own server needs the readalong service, which runs on this computer. Installing it downloads about 80 MB, once.'
  return frame([
    <Text key="about">{isFailed ? `The install stopped: ${setup.text}` : about}</Text>,
    <Box key="buttons" flexDirection="row" flexWrap="wrap" columnGap={1}>
      <Button key="install" label={isFailed ? 'Try again' : 'Install the voice'} onPress={install} />
      <Button key="dismiss" label={isFailed ? 'Close' : 'Not now'} dimColor onPress={dismiss} />
    </Box>,
  ])
}

/** How a run of the active paragraph is drawn: bold, italic, struck, code, a link. */
function styleOf(run: Run): TextProps {
  const props: TextProps = {}
  if (run.style.isBold) props.weight = 'bold'
  if (run.style.isItalic) props.italic = true
  if (run.style.isStruck) props.strikethrough = true
  if (run.style.isCode) Object.assign(props, { color: 'permission', mono: true })
  if (run.style.isLink) Object.assign(props, { color: 'suggestion', underline: true })
  if (run.isSilent) props.dimColor = true
  return props
}

/** Empties the prompt box after a letter it took: a dropped prompt is left in it, to be typed again. */
function clearPrompt($: EngineInterface) {
  $.clock.after(150, () => void $.prompt.fill({ text: '' }).catch(() => undefined))
}

/** The player's letters, typed alone at the prompt while a reply is read, and what each says it did. */
const KEYS: Record<string, string> = {
  p: 'paused, or resumed',
  b: 'back a sentence',
  n: 'on to the next sentence',
  s: 'stopped',
  w: 'switched between the window and the whole reply',
}

/**
 * Reads the answer that finished last, from the panel or a lone r at the prompt. One not in
 * English asks first (the panel says so), unless `isAsked`.
 */
async function readLastAnswer($: EngineInterface, s: Settings, isAsked = false) {
  const last = await lastAnswer($)
  if (last === null) return
  const now = await settingsNow($, s)
  const speech = parse(last.text, await voiceOf($, s)).sentences
  const language = isAsked ? null : await unreadLanguage($, s, last.text)
  if (language !== null) {
    await update($, noticeState, () => ({ id: last.id, language: language.name, hasRest: speech.length > 0 }))
    return void $.ui.toast(`Not read: the last answer looks ${language.name}, and ${await whyUnread($, s)}.`)
  }
  await update($, noticeState, () => null)
  if (speech.length === 0) return void $.ui.toast('The last answer has nothing to read aloud: only code or tables')
  await start($, s, last.id, markOf(last.text), speech, now.speed, now.voice)
}

/** Asks the voice what it is doing, for the panel. */
async function refreshService($: EngineInterface) {
  const now = await voiceStatus($)
  const since = now.state === 'running' ? now.since : 0
  const sessions = now.state === 'running' ? now.sessions : 0
  await update($, serviceState, () => ({ state: now.state, since, sessions, port: now.port, home: now.home }))
}

/**
 * The /readalong panel: the reading, by keyboard; the settings, with a sample of the highlight
 * and a field for a colour's hex code; and what the voice is doing on this computer, with a way to
 * stop it. Tab and the arrows walk its buttons, Enter presses one, a letter presses its own.
 */
async function drawPanel(
  $: EngineInterface,
  s: Settings,
  ui: ReturnType<EngineInterface['ui']['resolve']>,
  surface: Parameters<typeof settingsRows>[1],
  /** Whether a click reaches the panel: true, false in the terminal's classic layout, undefined unknown. */
  isClickable: boolean | undefined,
): Promise<RenderElement> {
  const { Box, Button, Text } = ui
  const now = await settingsNow($, s)
  const rows = settingsRows(ui, surface, now, picksFor($, s, now), true, text => $.ui.toast(text))
  const playing = await read($, player)
  const last = await lastAnswer($)
  const notice = await read($, noticeState)
  const service = await read($, serviceState)
  const said = sentenceNow()
  const isReadingNow = playing !== null && said !== undefined

  const readLast = (isAsked = false) => readLastAnswer($, s, isAsked)
  const nudgeSpeed = async (by: number) => {
    const speeds = speedsWith(now.speed)
    const wanted = speeds[speeds.indexOf(now.speed) + by]
    if (wanted !== undefined) await setSpeed($, s, wanted)
  }
  const name = (text: string) => (
    <Box width={10} flexShrink={0}>
      <Text dimColor>{text}</Text>
    </Box>
  )

  const reading = isReadingNow ? (
    <Box key="reading" flexDirection="column">
      <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={1}>
        {name('Reading')}
        <Button key="panel:toggle" plain hotkey="p" label={playing.phase === 'paused' ? 'Resume' : 'Pause'} onPress={() => void toggle($)} />
        <Button key="panel:back" plain hotkey="b" label="Back" onPress={() => void step($, -1)} />
        <Button key="panel:next" plain hotkey="n" label="Next" onPress={() => void step($, 1)} />
        <Button key="panel:stop" plain hotkey="s" label="Stop" onPress={() => void stop($)} />
        <Text dimColor tabular>{`sentence ${playing.index + 1} of ${playing.count}`}</Text>
      </Box>
      <Box paddingLeft={11}>
        <Text italic>{said?.speech}</Text>
      </Box>
    </Box>
  ) : (
    <Box key="reading" flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={1}>
      {name('Reading')}
      {last === null ? (
        <Text dimColor>No answer to read yet in this session. Auto-read reads each one as it finishes.</Text>
      ) : (
        <Button key="panel:read" plain hotkey="r" label="Read the last answer" onPress={() => void readLast()} />
      )}
    </Box>
  )
  const isNoticed = notice !== null && last !== null && notice.id === last.id && !isReadingNow
  const noticeRow = isNoticed ? (
    <Box key="notice" flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={1} paddingLeft={11}>
      <Text>{`It looks ${notice.language}, and ${await whyUnread($, s)}.`}</Text>
      {notice.hasRest ? <Button key="panel:anyway" label={(await hasOwnServer($, s)) ? 'Read it anyway' : 'Read the rest'} onPress={() => void readLast(true)} /> : null}
    </Box>
  ) : null
  const speedRow = (
    <Box key="speed" flexDirection="row" alignItems="center" columnGap={1}>
      {name('Speed')}
      <Button key="panel:slower" label="−" onPress={() => void nudgeSpeed(-1)} />
      <Text tabular>{speedLabel(now.speed)}</Text>
      <Button key="panel:faster" label="+" onPress={() => void nudgeSpeed(1)} />
    </Box>
  )

  const clockNow = Math.floor((await $.clock.now()) / 1000)
  const where = service === null ? '' : `127.0.0.1:${service.port}`
  const minutes = service === null ? 0 : Math.max(0, Math.round((clockNow - service.since) / 60))
  const status =
    service === null
      ? 'Looking…'
      : service.state === 'running'
        ? `Running on ${where} for ${minutes < 1 ? 'less than a minute' : `${minutes} min`}, used by ${service.sessions === 1 ? 'one Claude Code session' : `${service.sessions} Claude Code sessions`}.`
        : service.state === 'stopped'
          ? 'Not running. It starts when you press play, with the next Claude Code session, or, with auto-read on, when Claude begins an answer.'
          : service.state === 'not-installed'
            ? 'Not installed yet. Read an answer and it offers to install it: about 400 MB, once.'
            : `Another program answers on ${where}; set READALONG_PORT to give the voice another port.`
  const voiceSection = (
    <Box key="service" flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        <Text weight="bold">The voice on this computer</Text>
        <Text>{status}</Text>
      </Box>
      <Text dimColor>
        It starts with a Claude Code session, in a terminal or an editor alike, and, with auto-read on, when Claude begins an answer. It stops a minute after the last session closes, or after 30 minutes with nothing read. It is all readalong runs, and it sends nothing anywhere.
      </Text>
      {service === null ? null : <Text dimColor>{`Its folder, removed with the plugin: ${service.home}`}</Text>}
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        {service?.state === 'running' ? (
          <Button
            key="panel:quit"
            plain
            hotkey="x"
            label="Stop the voice now, for every session"
            onPress={() => void stopVoice($).then(() => refreshService($))}
          />
        ) : null}
        <Button key="panel:look" dimColor label="Look again" onPress={() => void refreshService($)} />
      </Box>
    </Box>
  )

  // One row a setting, with no blank rows between them, so the panel fits above the prompt whole.
  return (
    <Box flexDirection="column" rowGap={1}>
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        <Text weight="bold" color="claude">readalong</Text>
        <Text dimColor>reads replies aloud, each sentence in its own language, with a voice that runs on this computer</Text>
      </Box>
      <Box flexDirection="column">
        {reading}
        {noticeRow}
      </Box>
      <Box flexDirection="column">
        {speedRow}
        {rows.reading}
        {rows.looks}
      </Box>
      {voiceSection}
      <Text dimColor>{`${isClickable === true ? 'Click a button, or use the keys: ' : ''}Tab or the arrows move · Enter presses · the letter before a colon presses its button · Esc closes`}</Text>
      {isClickable === false ? (
        <Text dimColor>
          Clicks do not work in Claude Code's classic layout. Type /tui fullscreen to switch: clicks then work, and from 110 columns this panel sits beside the conversation. This session restarts with its conversation, and later sessions keep the layout.
        </Text>
      ) : null}
    </Box>
  )
}
