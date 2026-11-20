import { expect, test } from 'claude-code/testing'

import { parse } from '../hooks/text'
import { breaksOf, HOLD, lineAt, linesOf, linesOfReply, roomOf, silentHeight, TEXT_LINES, textOf, WINDOW_LINES, windowOf } from '../hooks/window'

/** A reply of `count` paragraphs, each one sentence of about `words` words. */
function paragraphs(count: number, words = 8): string {
  return Array.from({ length: count }, (_, i) => `Paragraph ${i + 1} ${'says a few words here '.repeat(words / 4).trim()}.`).join('\n\n')
}

/** A reply mixing every kind of block, long enough to need the window at any width tested. */
const MIXED = `# Steps\n\n${paragraphs(3, 24)}\n\n1. First item.\n   - Nested item.\n2. Second item.\n\n> A quote that is read.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n\`\`\`\ncode\nmore code\n\`\`\`\n\n${paragraphs(6, 24)}`

test('text is wrapped at spaces as the surfaces wrap it, and a word longer than a line is broken', () => {
  expect(breaksOf('', 20)).toEqual([0])
  expect(breaksOf('one two three', 20)).toEqual([0])
  expect(breaksOf('aaaa bbbb cccc', 9)).toEqual([0, 10])
  expect(breaksOf('aaaa bbbb cccc', 8)).toEqual([0, 5, 10])
  expect(breaksOf('x'.repeat(25), 10)).toEqual([0, 10, 20])
  expect(breaksOf(`ab ${'x'.repeat(25)}`, 10)).toEqual([0, 3, 13, 23])
  expect(linesOf('aaaa bbbb cccc', 8)).toBe(3)
})

test('code, tables, maths and rules are counted at the height they are drawn', () => {
  const reading = parse('```\none\ntwo\nthree\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\n---')
  expect(reading.blocks.map(block => silentHeight(block, reading.lines, 80, true))).toEqual([3, 7, 1])
  // The editor frames code: one line more, so its guess runs tall.
  expect(reading.blocks.map(block => silentHeight(block, reading.lines, 80, false))).toEqual([4, 7, 1])
})

test('a reply is laid out line by line: its text wrapped, a blank row where it has a blank line, none in a tight list', () => {
  const reading = parse('First paragraph.\n\n- One.\n- Two.')
  expect(linesOfReply(reading, 80, true).map(line => line.kind)).toEqual(['text', 'gap', 'text', 'text'])
  // A list item's text wraps in the room its marker leaves.
  const item = parse(`- ${'word '.repeat(12).trim()}`)
  const block = item.blocks[0]
  if (block === undefined) throw new Error('no item')
  expect(roomOf(block, 22, true)).toBe(20)
  expect(linesOfReply(item, 22, true)).toHaveLength(linesOf(textOf(block), 20))
})

test('a reply that fits in the window is drawn whole', () => {
  const reading = parse(paragraphs(5))
  // Five one-line paragraphs and the four blank rows between them: nine lines, under the window's ten.
  expect(linesOfReply(reading, 80, true)).toHaveLength(9)
  expect(9).toBeLessThan(WINDOW_LINES)
  reading.sentences.forEach(s => expect(windowOf(reading, s.block, s.start, 80, true)).toEqual({ kind: 'whole' }))
  const longer = parse(paragraphs(6))
  expect(longer.sentences.every(s => windowOf(longer, s.block, s.start, 80, true).kind === 'window')).toBe(true)
})

test('the line read is held on the window\'s third line, from the reply\'s start to its end', () => {
  for (const markdown of [paragraphs(12), paragraphs(30, 24), MIXED]) {
    for (const width of [40, 80, 120]) {
      const reading = parse(markdown)
      const all = linesOfReply(reading, width, true)
      let previous = 0
      for (const s of reading.sentences) {
        const w = windowOf(reading, s.block, s.start, width, true)
        if (w.kind === 'whole') continue
        const read = lineAt(all, s.block, s.start)
        // Inside the window, on its third line unless the window is at the reply's start or end.
        expect(read - w.first).toBeGreaterThanOrEqual(0)
        expect(read - w.first).toBeLessThan(TEXT_LINES)
        if (w.first > 0 && w.first < all.length - TEXT_LINES) expect(read - w.first).toBe(HOLD)
        // It only goes down, and arrows say what it hides.
        expect(w.first).toBeGreaterThanOrEqual(previous)
        previous = w.first
        expect(w.isMoreAbove).toBe(w.first > 0)
        expect(w.isMoreBelow).toBe(w.first + TEXT_LINES < all.length)
        // Drawn from a block's start, never past the line read; cut after whole lines of its last block.
        expect(w.from).toBeLessThanOrEqual(s.block)
        expect(w.to).toBeGreaterThanOrEqual(s.block)
        if (w.toLines !== null) expect(w.toLines).toBeLessThanOrEqual(all.filter(line => line.block === w.to && line.kind !== 'gap').length)
      }
    }
  }
})

test('following words, the window moves one line as the reading moves to the next line, and not within one', () => {
  const long = Array.from({ length: 30 }, (_, i) => `Sentence ${i + 1} of one long paragraph goes on.`).join(' ')
  const reading = parse(long)
  const all = linesOfReply(reading, 60, true)
  const text = reading.blocks[0] === undefined ? '' : textOf(reading.blocks[0])
  let previous = -1
  for (const m of text.matchAll(/\S+/g)) {
    const w = windowOf(reading, 0, m.index ?? 0, 60, true)
    if (w.kind !== 'window') throw new Error('no window')
    if (previous >= 0) expect(w.first - previous).toBeLessThanOrEqual(1)
    previous = w.first
  }
  // By the last word, the window shows the paragraph's last lines.
  expect(previous).toBe(all.length - TEXT_LINES)
})

test('one place in the reply always gives the same window, whatever was read before', () => {
  const reading = parse(MIXED)
  const forward = reading.sentences.map(s => windowOf(reading, s.block, s.start, 80, true))
  const backward = [...reading.sentences].reverse().map(s => windowOf(reading, s.block, s.start, 80, true)).reverse()
  expect(backward).toEqual(forward)
})

test('the window is worked out quickly enough to redraw at every word of a long reply', () => {
  const reading = parse(Array.from({ length: 60 }, (_, i) => `Paragraph ${i} ${'has words in it. '.repeat(6)}`).join('\n\n'))
  const started = Date.now()
  for (const s of reading.sentences) windowOf(reading, s.block, s.start, 80, true)
  expect(Date.now() - started).toBeLessThan(1000)
})
