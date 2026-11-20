// The reading window: which lines of a long reply show while it is read, so the line being read
// stays in view without scrolling. Claude Code lets no plugin scroll a reply, so a reply taller
// than the window is drawn in a box of fixed height that slides down it, a line at a time.
//
// The text never moves sideways: every block is drawn from its start, so each line breaks where
// it breaks in the whole reply, and the window hides whole lines above and below. Hiding lines
// above takes no negative margin (the surfaces allow none): the text is drawn from a block well
// above the window down to the window's last line, aligned to the box's bottom, so the box cuts
// the lines above away.
//
// One rule decides where the window is: the line being read is held on the window's third line,
// once the reading is past it; the window starts at the reply's first line before that, and stops
// at its last. So the window moves only when the reading moves to another line, one line for each,
// and one place in the reply always gives the same window.
//
// Line breaks are estimated, as the surfaces do not say where a line wraps: the terminal's width
// is known in cells, and its font is fixed; the editor gives one in `ch` and draws a proportional
// font, narrower on average, so there the estimate counts more lines than it draws. A wrong guess
// moves the line read a line or so from the third, never out of the window, and never sideways.

import type { Block, Reading } from './text'

/** The window's height in lines: in the terminal rows, in the editor line heights (`lh`). */
export const WINDOW_LINES = 10

/** The lines of text in the window: the window less a line above for ▲ and a line below for ▼, kept whether shown or not. */
export const TEXT_LINES = WINDOW_LINES - 2

/** Which of the window's text lines the line being read is held on, from 0: the third. */
export const HOLD = 2

/**
 * What a reply being read shows: all of it, or a window over its lines from `first` on, drawn from
 * blocks `from` to `to`. The last of them is cut after `toLines` of its lines (its blank row before
 * it counts none), or drawn whole when that is null. `isAtTop` draws the
 * text from the window's top (the reply's start shows); otherwise it is drawn down to the window's
 * last line, and the lines above that do not fit are cut away.
 */
export type Window =
  | { kind: 'whole' }
  | { kind: 'window'; first: number; from: number; to: number; toLines: number | null; isAtTop: boolean; isMoreAbove: boolean; isMoreBelow: boolean }

/**
 * Where each line of `text` starts when wrapped at spaces to `width` cells, as the surfaces wrap
 * it: character offsets, the first 0. A word longer than a line is broken across lines.
 */
export function breaksOf(text: string, width: number): number[] {
  const room = Math.max(8, Math.floor(width))
  const starts = [0]
  let used = 0
  for (const m of text.matchAll(/\S+/g)) {
    const word = m[0]
    const at = m.index ?? 0
    if (used > 0 && used + 1 + word.length <= room) {
      used += 1 + word.length
      continue
    }
    if (used > 0) starts.push(at)
    // The word starts a line; one longer than a line runs on over the next ones.
    let rest = word.length
    let from = at
    while (rest > room) {
      from += room
      starts.push(from)
      rest -= room
    }
    used = rest
  }
  return starts
}

/** How many lines `text` takes at `width` cells. */
export function linesOf(text: string, width: number): number {
  return breaksOf(text, width).length
}

/** A block's text as drawn, without its marks: what wraps. */
export function textOf(block: Block): string {
  return block.runs.map(run => run.text).join('')
}

/** The cells a block's text has across: the width, less its indent, marker and quote bar. */
export function roomOf(block: Block, width: number, isTerminal: boolean): number {
  const listIndent = block.marker !== '' && !isTerminal ? 2 : 0
  return width - block.indent - listIndent - block.marker.length - (block.isQuote ? 2 : 0)
}

/**
 * How many lines a block of code, a table, maths or a rule takes, drawn by Markdown. Code is its
 * lines, each wrapped; a table its rows as the terminal boxes them (a rule above, between and below
 * each row); the editor frames code, one line more.
 */
export function silentHeight(block: Block, lines: readonly string[], width: number, isTerminal: boolean): number {
  const source = lines.slice(block.from, block.to)
  const first = source[0] ?? ''
  if (/^\s*(`{3,}|~{3,})/.test(first)) {
    const closed = source.length > 1 && /^\s*(`{3,}|~{3,})\s*$/.test(source[source.length - 1] ?? '')
    const code = source.slice(1, closed ? -1 : undefined)
    const height = code.reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / Math.max(8, width))), 0)
    return Math.max(1, height) + (isTerminal ? 0 : 1)
  }
  if (source.length > 1 && source.every(line => line.includes('|'))) {
    return 2 * source.filter(line => !/^\s*\|?\s*:?-{2,}/.test(line)).length + 1
  }
  return Math.max(1, source.length)
}

/** Whether a blank line comes between block `i - 1` and block `i`: a blank row drawn between them. */
export function isGapBefore(reading: Reading, i: number): boolean {
  const above = reading.blocks[i - 1]
  const block = reading.blocks[i]
  if (above === undefined || block === undefined) return false
  return reading.lines.slice(above.to, block.from).some(line => line.trim() === '')
}

/**
 * One line of a reply as the window draws it: a blank row before block `block`, a line of its text
 * starting at character `start`, or a line of a block Markdown draws (code, a table).
 */
export type Line = { block: number; kind: 'gap' | 'text' | 'drawn'; start: number }

/** Lines worked out, by reply (`parse` keeps one reading per reply) and width: a reply is drawn again at every word read. */
const laid = new WeakMap<Reading, Map<string, Line[]>>()

/** Every line of a reply, top to bottom, as the window draws it at `width` cells. */
export function linesOfReply(reading: Reading, width: number, isTerminal: boolean): Line[] {
  const key = `${width} ${isTerminal}`
  const known = laid.get(reading)?.get(key)
  if (known !== undefined) return known
  const all: Line[] = []
  reading.blocks.forEach((block, i) => {
    if (isGapBefore(reading, i)) all.push({ block: i, kind: 'gap', start: 0 })
    if (block.kind === 'text') {
      for (const start of breaksOf(textOf(block), roomOf(block, width, isTerminal))) all.push({ block: i, kind: 'text', start })
    } else {
      const height = silentHeight(block, reading.lines, width, isTerminal)
      for (let n = 0; n < height; n += 1) all.push({ block: i, kind: 'drawn', start: 0 })
    }
  })
  const byWidth = laid.get(reading) ?? new Map<string, Line[]>()
  byWidth.set(key, all)
  laid.set(reading, byWidth)
  return all
}

/** The line, from the reply's first, holding character `at` of block `block`: the place being read. */
export function lineAt(all: readonly Line[], block: number, at: number): number {
  let found = -1
  all.forEach((line, i) => {
    if (line.block === block && line.kind === 'text' && line.start <= at) found = i
  })
  return found === -1 ? all.findIndex(line => line.block === block) : found
}

/**
 * The window to draw while character `at` of block `block` is being read (the word, or the
 * sentence's start), at `width` cells. A reply that fits in the window is drawn whole.
 */
export function windowOf(reading: Reading, block: number, at: number, width: number, isTerminal: boolean): Window {
  const all = linesOfReply(reading, width, isTerminal)
  if (all.length <= WINDOW_LINES || reading.blocks[block] === undefined) return { kind: 'whole' }
  const read = lineAt(all, block, at)
  // The window's first line: the line read held third, from the reply's first line to its last.
  const first = Math.max(0, Math.min(read - HOLD, all.length - TEXT_LINES))
  const last = first + TEXT_LINES - 1
  const isMoreAbove = first > 0
  const isMoreBelow = last < all.length - 1
  const lastLine = all[last] ?? all[all.length - 1]
  if (lastLine === undefined) return { kind: 'whole' }
  // At the reply's start the text is drawn from the top, and the window cuts what does not fit.
  if (!isMoreAbove) return { kind: 'window', first, from: 0, to: lastLine.block, toLines: null, isAtTop: true, isMoreAbove, isMoreBelow }
  // Further on, it is drawn down to the window's last line, from a block far enough above to fill
  // the window whatever the estimate's error, and aligned to the window's bottom.
  const from = all[Math.max(0, first - TEXT_LINES)]?.block ?? 0
  const toLines = all.slice(0, last + 1).filter(line => line.block === lastLine.block && line.kind !== 'gap').length
  return { kind: 'window', first, from, to: lastLine.block, toLines, isAtTop: false, isMoreAbove, isMoreBelow }
}
