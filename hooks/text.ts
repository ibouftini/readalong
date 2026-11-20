// A reply's Markdown, cut into the blocks it draws as and the sentences it is read in.
//
// Each sentence keeps where it lies (its block, and its offsets in that block's plain text), so
// the sentence being read can be highlighted where it stands. Code blocks, tables, rules and
// display maths are kept as blocks to draw but have no sentences, so they are never read.
// Each sentence also keeps the language it is read in, told in language.ts; what it says is
// made easy to say in that language in speech.ts, its equations and code names in English.

import { clausesIn, isSpoken, labelIn, labelledIn, languageOf, QUOTED, spokenIn, UNREAD } from './language'
import type { Spoken } from './language'
import { hold, isFileLike, say, sayable, sayCode } from './speech'
import { MONTH_AFTER_DAY } from './words'

export { sayable }

export type Style = {
  isBold?: true
  isItalic?: true
  isCode?: true
  isStruck?: true
  isLink?: true
}

/** A stretch of a block's plain text in one style; a silent run (a URL, an image) is drawn, not read. */
export type Run = { text: string; style: Style; isSilent?: true }

export type Block = {
  /** `text` blocks are read; `silent` ones (code, tables, rules, maths) are only drawn. */
  kind: 'text' | 'silent'
  /** The block's first line in the reply, and the line after its last. */
  from: number
  to: number
  /** Spaces before the block's first line: a nested list item's depth. */
  indent: number
  /** What the reply draws before the text: `• `, `2. `, `☐ `, or nothing. */
  marker: string
  isHeading: boolean
  isQuote: boolean
  runs: Run[]
}

/** One unit of reading: a sentence, or a clause of a long one. */
export type Sentence = {
  block: number
  /** Offsets in the block's plain text (its runs joined). */
  start: number
  end: number
  /** What is sent to the speech server. */
  speech: string
  /** The language it is read in, which picks the voice and how the words are pronounced. */
  language: Spoken
  /** The words of `speech` said in English in a sentence of another language: [from, to) pairs among them. */
  english: Array<[number, number]>
}

export type Reading = { lines: string[]; blocks: Block[]; sentences: Sentence[] }

/** Above this many characters a sentence is cut at a clause, so its audio comes sooner. */
const LONGEST = 160

const FENCE = /^\s*(`{3,}|~{3,})/
const MATH = /^\s*\$\$/
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/
const QUOTE = /^\s{0,3}>\s?/
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

/** The replies cut last, by their text and language: a reply is drawn again at every word read. */
const cut = new Map<string, Reading>()
const CUT_KEPT = 40

/**
 * A reply cut into blocks and sentences. Each sentence is read in the language it is written
 * in: the reply's to begin with, where readalong reads it, then the language of the sentence
 * before, until a sentence is clearly in another.
 *
 * For a speech server of the user's `own`, which reads in the one voice they named, every
 * sentence is English and nothing is left out, as before readalong read other languages.
 */
export function parse(markdown: string, voice: 'readalong' | 'own' = 'readalong'): Reading {
  const key = `${voice}\n${markdown}`
  const kept = cut.get(key)
  if (kept !== undefined) return kept
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  parseLines(lines, 0, false, blocks)
  const sentences: Sentence[] = []
  const reply = languageOf(markdown).code
  const before: Spoken = isSpoken(reply) ? reply : 'en'
  // The languages read so far in this reply: of two a sentence could be in, the one already heard.
  const told: Told = { before, seen: new Set<Spoken>([before]) }
  blocks.forEach((block, index) => {
    if (block.kind === 'text') sentences.push(...sentencesOf(block, index, voice === 'own' ? undefined : told))
  })
  const reading = { lines, blocks, sentences }
  if (cut.size >= CUT_KEPT) cut.delete(cut.keys().next().value ?? '')
  cut.set(key, reading)
  return reading
}

function isTable(lines: readonly string[], i: number): boolean {
  const line = lines[i] ?? ''
  if (/^\s*\|/.test(line)) return true
  const below = lines[i + 1]
  return line.includes('|') && below !== undefined && below.includes('|') && TABLE_RULE.test(below)
}

function startsBlock(lines: readonly string[], i: number): boolean {
  const line = lines[i] ?? ''
  return (
    line.trim() === '' ||
    FENCE.test(line) ||
    MATH.test(line) ||
    HEADING.test(line) ||
    RULE.test(line) ||
    ITEM.test(line) ||
    QUOTE.test(line) ||
    isTable(lines, i)
  )
}

/** The line after the paragraph or list item that starts at `i`: its lazy continuation lines. */
function continued(lines: readonly string[], i: number): number {
  let j = i + 1
  while (j < lines.length && !startsBlock(lines, j)) j += 1
  return j
}

/** The first line at or after `from` that `test` accepts, or the end. */
function seek(lines: readonly string[], from: number, test: (line: string) => boolean): number {
  let j = from
  while (j < lines.length && !test(lines[j] ?? '')) j += 1
  return j
}

function parseLines(lines: readonly string[], offset: number, isQuote: boolean, out: Block[]) {
  const block = (kind: Block['kind'], from: number, to: number, text = '', extra: Partial<Block> = {}) =>
    out.push({
      kind,
      from: offset + from,
      to: offset + Math.min(to, lines.length),
      indent: 0,
      marker: '',
      isHeading: false,
      isQuote,
      runs: kind === 'text' ? inline(text) : [],
      ...extra,
    })
  const trimmed = (from: number, to: number) => lines.slice(from, to).map(l => l.trim())

  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    const fence = FENCE.exec(line)?.[1]
    const heading = HEADING.exec(line)
    const item = ITEM.exec(line)
    if (line.trim() === '') {
      i += 1
    } else if (fence !== undefined) {
      const close = new RegExp(`^\\s*${fence.startsWith('`') ? '`' : '~'}{${fence.length},}\\s*$`)
      const j = seek(lines, i + 1, l => close.test(l))
      block('silent', i, j + 1)
      i = j + 1
    } else if (MATH.test(line)) {
      // `$$ x $$` on one line, or a `$$` line, the formula, and a closing `$$`.
      const j = line.trim().slice(2).includes('$$') ? i : seek(lines, i + 1, l => l.includes('$$'))
      block('silent', i, j + 1)
      i = j + 1
    } else if (RULE.test(line)) {
      block('silent', i, i + 1)
      i += 1
    } else if (isTable(lines, i)) {
      const j = seek(lines, i, l => l.trim() === '' || !l.includes('|'))
      block('silent', i, j)
      i = j
    } else if (heading !== null) {
      block('text', i, i + 1, heading[1] ?? '', { isHeading: true })
      i += 1
    } else if (QUOTE.test(line)) {
      const j = seek(lines, i, l => !QUOTE.test(l))
      parseLines(lines.slice(i, j).map(l => l.replace(QUOTE, '')), offset + i, true, out)
      i = j
    } else if (item !== null) {
      const [, lead = '', bullet = '-', task, first = ''] = item
      const checkbox = task === undefined ? '' : task === ' ' ? '☐ ' : '☑ '
      const marker = (/\d/.test(bullet) ? `${bullet.slice(0, -1)}. ` : '• ') + checkbox
      const j = continued(lines, i)
      const text = [first, ...trimmed(i + 1, j)].join(' ')
      block('text', i, j, text, { marker, indent: lead.replace(/\t/g, '    ').length })
      i = j
    } else {
      const j = continued(lines, i)
      block('text', i, j, trimmed(i, j).join(' '), { indent: line.length - line.trimStart().length })
      i = j
    }
  }
}

// One alternation, tried left to right at each position; named groups say which matched.
const INLINE = new RegExp(
  [
    String.raw`\\(?<escaped>[\\\x60*_{}\[\]()#+\-.!|~<>$])`,
    String.raw`(?<ticks>\x60+)(?<code>[^\x60]|[^\x60][\s\S]*?[^\x60])\k<ticks>(?!\x60)`,
    String.raw`!\[(?<alt>[^\]]*)\]\([^)]*\)`,
    String.raw`\[(?<label>[^\]]+)\]\([^)]*\)`,
    String.raw`<(?<autolink>https?:\/\/[^>\s]+)>`,
    String.raw`(?<url>https?:\/\/[^\s<>]*[^\s<>.,;:!?'")\]])`,
    String.raw`(?<stars>\*\*|__)(?=\S)(?<bold>[\s\S]*?\S)\k<stars>`,
    String.raw`~~(?=\S)(?<struck>[\s\S]*?\S)~~`,
    String.raw`\*(?=[^\s*])(?<em>[\s\S]*?[^\s*])\*`,
    String.raw`(?<![\p{L}\p{N}_])_(?=\S)(?<under>[\s\S]*?\S)_(?![\p{L}\p{N}_])`,
    String.raw`<\/?[A-Za-z][^>]*>`,
  ].join('|'),
  'gu',
)

/** A block's inline Markdown as styled runs of plain text; whitespace collapsed outside code. */
export function inline(source: string, style: Style = {}): Run[] {
  const runs: Run[] = []
  const push = (text: string, runStyle: Style, isSilent = false) => {
    if (text === '') return
    runs.push(isSilent ? { text, style: runStyle, isSilent: true } : { text, style: runStyle })
  }
  const plain = (text: string) => push(text.replace(/\s+/g, ' '), style)
  let last = 0
  for (const m of source.matchAll(INLINE)) {
    const g = m.groups ?? {}
    const at = m.index ?? last
    plain(source.slice(last, at))
    last = at + m[0].length
    if (g.escaped !== undefined) push(g.escaped, style)
    else if (g.code !== undefined) push(g.code.replace(/^ (.*) $/s, '$1'), { ...style, isCode: true })
    else if (g.alt !== undefined) push(g.alt, style, true)
    else if (g.label !== undefined) runs.push(...inline(g.label, { ...style, isLink: true }))
    else if (g.autolink !== undefined) push(g.autolink, { ...style, isLink: true }, true)
    else if (g.url !== undefined) push(g.url, { ...style, isLink: true }, true)
    else if (g.bold !== undefined) runs.push(...inline(g.bold, { ...style, isBold: true }))
    else if (g.struck !== undefined) runs.push(...inline(g.struck, { ...style, isStruck: true }))
    else if (g.em !== undefined) runs.push(...inline(g.em, { ...style, isItalic: true }))
    else if (g.under !== undefined) runs.push(...inline(g.under, { ...style, isItalic: true }))
    // An HTML tag draws nothing and is not read.
  }
  plain(source.slice(last))
  return trimRuns(runs)
}

/** Drops the spaces the line joins and dropped tags leave at a block's two ends. */
function trimRuns(runs: Run[]): Run[] {
  const isBlank = (run: Run | undefined) => run !== undefined && !run.style.isCode && run.text.trim() === ''
  while (isBlank(runs[0])) runs.shift()
  while (isBlank(runs[runs.length - 1])) runs.pop()
  const first = runs[0]
  if (first !== undefined && !first.style.isCode) runs[0] = { ...first, text: first.text.trimStart() }
  const last = runs[runs.length - 1]
  if (last !== undefined && !last.style.isCode) runs[runs.length - 1] = { ...last, text: last.text.trimEnd() }
  return runs
}

/** Words a period follows without ending the sentence, lowercased and without their dots. */
const ABBREVIATIONS = new Set([
  'eg', 'ie', 'vs', 'cf', 'al', 'approx', 'fig', 'figs', 'eq', 'dr', 'mr', 'mrs', 'prof', 'jr', 'sr',
  'vol', 'pp', 'ca', 'resp', 'viz', 'ex', 'env', 'ej', 'aprox', 'bzw', 'ggf', 'zb', 'dh', 'vgl', 'ua', 'bijv', 'bv', 'dwz', 'oa',
])

/** Sentence ranges of a plain text: [start, end) pairs, trimmed of their spaces. */
export function splitSentences(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  let start = 0
  for (const m of text.matchAll(/[.!?…]+["'”’»)\]]*(?=\s|$)|[。！？।॥]+["'”’」』)]*/gu)) {
    const at = m.index ?? 0
    const end = at + m[0].length
    const next = /\S/u.exec(text.slice(end))?.[0]
    if (next !== undefined && /^[.!?…]/.test(m[0])) {
      // Not an end when lowercase follows, or when the period closes an abbreviation ("e.g.").
      if (/\p{Ll}/u.test(next)) continue
      const word = /([\p{L}.]+)\.$/u.exec(text.slice(start, at + 1))?.[1]
      if (m[0] === '.' && word !== undefined && ABBREVIATIONS.has(word.replace(/\./g, '').toLowerCase())) continue
      // Nor a day's dot in a date as German writes it: "am 15. November".
      if (m[0] === '.' && /(?<![\d.])\d{1,2}$/.test(text.slice(start, at)) && MONTH_AFTER_DAY.test(text.slice(end).trimStart())) continue
    }
    pushTrimmed(text, start, end, ranges)
    start = end
  }
  pushTrimmed(text, start, text.length, ranges)
  return ranges.flatMap(range => splitLong(text, range))
}

function pushTrimmed(text: string, start: number, end: number, out: Array<[number, number]>) {
  while (start < end && /\s/.test(text.charAt(start))) start += 1
  while (end > start && /\s/.test(text.charAt(end - 1))) end -= 1
  if (end > start) out.push([start, end])
}

/** Cuts a long sentence at the clause nearest its middle, then cuts the halves again if need be. */
function splitLong(text: string, [start, end]: [number, number]): Array<[number, number]> {
  if (end - start <= LONGEST) return [[start, end]]
  const middle = (start + end) / 2
  let best = -1
  for (const pattern of [/[;:—–](?=\s)/g, /,(?=\s)/g, /\s(?:and|but|so|which|because|while|where|then|et|mais|donc|puis|y|pero|porque|e|ma|perché|mas|und|aber|oder|weil|en|maar|omdat)\s/g]) {
    for (const m of text.slice(start, end).matchAll(pattern)) {
      // After the punctuation, or before the conjunction.
      const at = start + (m.index ?? 0) + (m[0].startsWith(' ') ? 0 : m[0].length)
      if (at - start < 40 || end - at < 40) continue
      if (best < 0 || Math.abs(at - middle) < Math.abs(best - middle)) best = at
    }
    if (best >= 0) break
  }
  if (best < 0) return [[start, end]]
  const parts: Array<[number, number]> = []
  pushTrimmed(text, start, best, parts)
  pushTrimmed(text, best, end, parts)
  return parts.flatMap(part => splitLong(text, part))
}

/** Characters that stand for English held aside (speech.ts): a reply's own are left out. */
const PRIVATE = /[\ue000-\uf8ff]/g

/** The clauses of [start, end): cut after a comma, semicolon or colon, and before a dash between spaces. */
function clausesOf(text: string, start: number, end: number): Array<[number, number]> {
  const clauses: Array<[number, number]> = []
  let from = start
  for (const m of text.slice(start, end).matchAll(/[,;:](?=\s)|\s(?=[—–]\s)/g)) {
    const at = start + (m.index ?? 0) + m[0].length
    pushTrimmed(text, from, at, clauses)
    from = at
  }
  pushTrimmed(text, from, end, clauses)
  return clauses
}

/** What is known while a reply is read: the language of the sentence before, and the languages heard so far. */
type Told = { before: Spoken; seen: Set<Spoken> }

/** A stretch of a block's text and the language it is read in. */
type Part = [from: number, to: number, language: Spoken]

/**
 * Fewest words a quotation, an aside or words in bold need to be told on their own: two are
 * a loanword or a name, as "déjà vu", "tour de force" and "La Liga" are in an English sentence.
 */
const SET_APART_WORDS = 3

const DEVANAGARI = /\p{Script=Devanagari}/gu

/** Words in single quotation marks, an apostrophe inside a word left alone: 'Impossible d'ouvrir le fichier'. */
const SINGLE_QUOTED = /(?<![\p{L}\p{N}])'(?=\p{L})(?:[^'\n]|'(?=\p{L}))*?[\p{L}\p{N}.!?…]'(?![\p{L}\p{N}])/gu

/**
 * Where a sentence of [start, end) sets words apart, as it does when it quotes another language:
 * in quotation marks of any kind, in parentheses or brackets, in bold or italics, as a link's
 * text. Each [from, to) with its marks, and [from, to) of the words inside them.
 */
function setApart(block: Block, text: string, start: number, end: number): Array<[number, number, number, number]> {
  const found: Array<[number, number, number, number]> = []
  const add = (from: number, to: number) => {
    let inFrom = from
    let inTo = to
    while (inFrom < inTo && /[\s"“”„«»‘’'()[\]]/u.test(text.charAt(inFrom))) inFrom += 1
    while (inTo > inFrom && /[\s"“”„«»‘’'()[\]]/u.test(text.charAt(inTo - 1))) inTo -= 1
    if (inTo > inFrom) found.push([from, to, inFrom, inTo])
  }
  const part = text.slice(start, end)
  for (const pattern of [QUOTED, SINGLE_QUOTED, /\([^()]+\)/g, /\[[^[\]]+\]/g]) {
    for (const m of part.matchAll(pattern)) add(start + (m.index ?? 0), start + (m.index ?? 0) + m[0].length)
  }
  // Runs in bold, in italics or of a link: one stretch from the first to the last.
  let at = 0
  let from: number | undefined
  const close = (to: number) => {
    if (from !== undefined && Math.min(to, end) > Math.max(from, start)) add(Math.max(from, start), Math.min(to, end))
    from = undefined
  }
  for (const run of block.runs) {
    const isApart = run.style.isBold === true || run.style.isItalic === true || run.style.isLink === true
    if (isApart && from === undefined) from = at
    if (!isApart) close(at)
    at += run.text.length
  }
  close(at)
  return found
}

/** [start, end) without `taken`: the stretches between them. */
function between(start: number, end: number, taken: ReadonlyArray<readonly [number, number, ...unknown[]]>): Array<[number, number]> {
  const out: Array<[number, number]> = []
  let from = start
  for (const [a, b] of [...taken].sort((x, y) => x[0] - y[0])) {
    if (a > from) out.push([from, Math.min(a, end)])
    from = Math.max(from, b)
  }
  if (end > from) out.push([from, end])
  return out
}

const overlaps = (a: readonly [number, number, ...unknown[]], b: readonly [number, number, ...unknown[]]) => a[0] < b[1] && b[0] < a[1]
/** Words and numbers: "3 archivos eliminados" is three. */
const wordCount = (prose: string) => (prose.match(/\p{L}+|\p{N}+/gu) ?? []).length

/**
 * The language each part of a sentence of [start, end) is read in, from `told`, which it then
 * brings up to date; and the stretches of English held in the voice of the part around them.
 *
 *   1. The sentence has a language, told from its words outside what it sets apart (`spokenIn`).
 *   2. A label that names a language ("French: Fichier introuvable", "Español: …") says what the
 *      words after it are in, unless they read as English or clearly as another (`labelledIn`);
 *      a label that ends the sentence ("### German", "The French version:") says it for the
 *      sentences after.
 *   3. Words set apart, three at least, clearly in another language than the sentence's, are
 *      read in that language's voice; English set apart in a sentence of another language is
 *      said in the sentence's voice, by English rules, as code is (`held`).
 *   4. The rest is read clause by clause (`clausesIn`).
 */
function partsOf(block: Block, text: string, start: number, end: number, proseOf: (from: number, to: number) => string, told: Told): { parts: Part[]; held: Array<[number, number]> } {
  const { seen } = told
  const proseBetween = (from: number, to: number, taken: ReadonlyArray<readonly [number, number, ...unknown[]]>) =>
    between(from, to, taken).map(([a, b]) => proseOf(a, b)).join(' ')
  const label = labelIn(text.slice(start, end))
  const labelAt = label === undefined ? end : start + label.at
  const labelEnd = label === undefined ? end : start + label.end
  const hasRest = label !== undefined && /\p{L}/u.test(proseOf(labelEnd, end))
  const apart = setApart(block, text, start, end).filter(([from, to]) => !hasRest || to <= labelAt)
  const unitMarks: Part[] = []
  const held: Array<[number, number]> = []

  // 1. The sentence's language, from the words around what it sets apart.
  // Too few words around what is set apart to tell: the language before, if a word is there to
  // say ("— familiar."); the whole sentence, if all of it is set apart ("« Fichier introuvable. »").
  const outside = proseBetween(start, end, [...apart, ...(hasRest ? [[labelEnd, end] as const] : [])])
  const around = (outside.match(/\p{L}{2,}/gu) ?? []).length
  const language = around >= 2 ? spokenIn(outside, told.before, seen) : around === 1 ? told.before : spokenIn(proseOf(start, end), told.before, seen)

  // 2. A label, and the words it names the language of.
  let after: Spoken | undefined
  if (label !== undefined) {
    const isAlone = !/\p{L}/u.test(proseOf(start, labelAt))
    if (isAlone) unitMarks.push([labelAt, labelEnd, label.said])
    if (hasRest) {
      after = labelledIn(proseOf(labelEnd, end), label.language, seen)
      if (isAlone || after !== language) unitMarks.push([labelEnd, end, after])
    } else after = label.language
  }

  // 3. Words set apart, the outermost first.
  for (const [from, to, inFrom, inTo] of [...apart].sort((a, b) => a[0] - b[0] || b[1] - a[1])) {
    if ([...unitMarks, ...held].some(mark => overlaps(mark, [from, to]))) continue
    const inside = proseOf(inFrom, inTo)
    // Devanagari is Hindi, one word of it as many: a script is a sure sign, as a word is not.
    const isHindi = language !== 'hi' && (inside.match(DEVANAGARI) ?? []).length > (inside.match(/\p{Script=Latin}/gu) ?? []).length
    if (!isHindi && wordCount(inside) < SET_APART_WORDS) continue
    const found = isHindi ? 'hi' : spokenIn(inside, language, seen, 2)
    if (found === language) continue
    if (found === 'en') held.push([inFrom, inTo])
    else unitMarks.push([from, to, found])
  }

  // 4. Clause by clause, what is not read on its own.
  const clauses = between(start, end, unitMarks).flatMap(([from, to]) => clausesOf(text, from, to))
  const languages = clausesIn(clauses.map(([from, to]) => proseBetween(from, to, held)), language, seen)
  const parts: Part[] = [...clauses.map(([from, to], i): Part => [from, to, languages[i]!]), ...unitMarks].sort((a, b) => a[0] - b[0])
  for (const [, , spoken] of parts) seen.add(spoken)
  // The sentence after keeps the language this one is in: what it quotes, or what follows its
  // comma ("she whispered, c'est facile"), is not the language the reply goes on in. A sentence
  // all set apart, in quotation marks or in bold, is a quotation: the one after it keeps the
  // language before it ('"Je suis crevé." — familiar.').
  const isQuotation = around === 0 && apart.length > 0 && label === undefined
  told.before = after ?? (isQuotation ? told.before : (languages[0] ?? language))
  seen.add(told.before)
  return { parts, held }
}

/**
 * A block's sentences, each in the language told from its words, its clauses', and those it sets
 * apart (`partsOf`); without `told`, each in English as it stands. A sentence in two languages
 * or more is read as one unit per language, in order.
 *
 * Letters of a script no voice reads are left out of what is said, and a sentence that is mostly
 * such letters is not read. In a sentence of another language than English, code and English set
 * apart are said in English, held aside from the sentence's rules, unless a path or a file's name.
 */
function sentencesOf(block: Block, index: number, told?: Told): Sentence[] {
  const text = block.runs.map(r => r.text).join('')
  // Code is in no one's language: the words around it tell.
  const proseOf = (start: number, end: number) =>
    readOf(block.runs, start, end)
      .map(([run, part]) => (run.style.isCode ? ' ' : part))
      .join('')
      .replace(UNREAD, ' ')
  return splitSentences(text).flatMap(([start, end]): Sentence[] => {
    if (told === undefined) {
      const speech = sayable(readOf(block.runs, start, end).map(([run, part]) => (run.style.isCode ? sayCode(part) : part)).join(''))
      return /[\p{L}\p{N}]/u.test(speech) ? [{ block: index, start, end, speech, language: 'en', english: [] }] : []
    }
    const prose = readOf(block.runs, start, end).map(([run, part]) => (run.style.isCode ? ' ' : part)).join('')
    const unread = (prose.match(UNREAD) ?? []).length
    if (unread > 0 && unread * 2 > (prose.match(/\p{L}/gu) ?? []).length) return []
    const { parts, held: heldEnglish } = partsOf(block, text, start, end, proseOf, told)
    // One unit for each run of parts in one language.
    const units: Part[] = []
    for (const [from, to, language] of parts) {
      const last = units[units.length - 1]
      if (last !== undefined && last[2] === language) last[1] = to
      else units.push([from, to, language])
    }
    return units.flatMap(([from, to, language]): Sentence[] => {
      const held: string[] = []
      const read = (a: number, b: number) =>
        readOf(block.runs, a, b)
          .map(([run, part]) => {
            const read = part.replace(PRIVATE, '').replace(UNREAD, ' ')
            if (!run.style.isCode) return read
            if (language === 'en') return sayCode(read)
            return isFileLike(read) ? read : hold(held, sayable(sayCode(read)))
          })
          .join('')
      // English set apart, in a unit of another language: held aside, said by English rules.
      const english = language === 'en' ? [] : heldEnglish.filter(([a, b]) => a >= from && b <= to)
      const whole = [
        ...between(from, to, english).map(([a, b]): [number, string] => [a, read(a, b)]),
        ...english.map(([a, b]): [number, string] => [
          a,
          hold(held, sayable(readOf(block.runs, a, b).map(([run, part]) => (run.style.isCode ? sayCode(part) : part.replace(PRIVATE, '').replace(UNREAD, ' '))).join(''))),
        ]),
      ]
        .sort((x, y) => x[0] - y[0])
        .map(([, said]) => said)
        .join('')
      const said = say(whole, language, held)
      return /[\p{L}\p{N}]/u.test(said.speech) ? [{ block: index, start: from, end: to, speech: said.speech, language, english: said.english }] : []
    })
  })
}

/** What is read of [start, end): each run's part in it, a silent run's as a space. */
function readOf(runs: readonly Run[], start: number, end: number): Array<[Run, string]> {
  let at = 0
  const parts: Array<[Run, string]> = []
  for (const run of runs) {
    const from = Math.max(start, at)
    const to = Math.min(end, at + run.text.length)
    if (to > from) parts.push([run, run.isSilent ? ' ' : run.text.slice(from - at, to - at)])
    at += run.text.length
  }
  return parts
}

/**
 * Where each spoken word of a sentence is shown: a [start, end) range in its block's plain text,
 * one per word of `sentence.speech` split at spaces, the words the server times. Empty when the
 * sentence shows no word to light.
 *
 * What is said is not always what is shown ("register.tsx" is said "register dot tsx", "e.g."
 * "for example"), so the two are lined up: words that read alike are paired, in order, as many
 * as can be; the spoken words between two pairs light the shown words between them, shared out
 * in order, or else the shown word of the pair before ("dot tsx" lights "register.tsx").
 */
export function wordsOf(block: Block, sentence: Sentence): Array<[number, number]> {
  const shown = shownWords(block, sentence.start, sentence.end)
  const said = sentence.speech.split(' ').filter(word => word !== '')
  if (shown.length === 0 || said.length === 0) return []
  const text = block.runs.map(r => r.text).join('')
  const plainShown = shown.map(([from, to]) => plainWord(text.slice(from, to)))
  const plainSaid = said.map(plainWord)

  // The pairing that matches the most: a weighted longest common subsequence.
  const n = said.length
  const m = shown.length
  const best = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      const score = likeness(plainSaid[i]!, plainShown[j]!)
      best[i]![j] = Math.max(best[i + 1]![j]!, best[i]![j + 1]!, score > 0 ? score + best[i + 1]![j + 1]! : 0)
    }
  }
  const pairs: Array<[number, number]> = []
  for (let i = 0, j = 0; i < n && j < m; ) {
    const score = likeness(plainSaid[i]!, plainShown[j]!)
    if (score > 0 && best[i]![j] === score + best[i + 1]![j + 1]!) pairs.push([i++, j++])
    else if (best[i]![j] === best[i + 1]![j]) i += 1
    else j += 1
  }

  const lit = new Array<number>(n).fill(-1)
  const bounds: Array<[number, number]> = [[-1, -1], ...pairs, [n, m]]
  for (let k = 0; k + 1 < bounds.length; k += 1) {
    const [i0, j0] = bounds[k]!
    const [i1, j1] = bounds[k + 1]!
    if (i1 < n) lit[i1] = j1
    const gap = i1 - i0 - 1
    const between = j1 - j0 - 1
    for (let g = 0; g < gap; g += 1) {
      lit[i0 + 1 + g] = between > 0 ? j0 + 1 + Math.floor((g * between) / gap) : j0 >= 0 ? j0 : Math.min(j1, m - 1)
    }
  }
  return lit.map(j => shown[j]!)
}

/** The shown words of [start, end): runs of non-space, without the marks around them; URLs left out. */
function shownWords(block: Block, start: number, end: number): Array<[number, number]> {
  const text = block.runs.map(r => r.text).join('')
  const silent: Array<[number, number]> = []
  let at = 0
  for (const run of block.runs) {
    if (run.isSilent) silent.push([at, at + run.text.length])
    at += run.text.length
  }
  const words: Array<[number, number]> = []
  for (const m of text.slice(start, end).matchAll(/\S+/gu)) {
    let from = start + (m.index ?? 0)
    let to = from + m[0].length
    const core = text.slice(from, to).search(/[\p{L}\p{N}]/u)
    if (core >= 0) {
      // "(see" lights "see", "carefully." lights "carefully".
      from += core
      while (!/[\p{L}\p{N}]/u.test(text.charAt(to - 1))) to -= 1
    }
    if (!silent.some(([a, b]) => from >= a && to <= b)) words.push([from, to])
  }
  return words
}

function plainWord(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

/** How alike a spoken and a shown word read: 3 the same, 1 one inside the other, else 0. */
function likeness(said: string, shown: string): number {
  if (said === '' || shown === '') return 0
  if (said === shown) return 3
  const shorter = said.length < shown.length ? said : shown
  return shorter.length >= 2 && (shown.includes(said) || said.includes(shown)) ? 1 : 0
}

/** A piece of a block to draw: lit (the sentence or word being read), or ahead of it (not read yet). */
export type Piece = Run & { isLit: boolean; isAhead: boolean }

/**
 * A block's runs cut where [start, end) begins and ends: the pieces to draw, the lit ones marked,
 * and those after `end`, not read yet, marked ahead.
 */
export function piecesOf(block: Block, start: number, end: number): Piece[] {
  const pieces: Piece[] = []
  let at = 0
  for (const run of block.runs) {
    const runEnd = at + run.text.length
    const litFrom = Math.min(Math.max(start, at), runEnd)
    const litTo = Math.min(Math.max(end, at), runEnd)
    const parts: Array<[number, number, boolean, boolean]> = [
      [at, litFrom, false, false],
      [litFrom, litTo, true, false],
      [litTo, runEnd, false, true],
    ]
    for (const [from, to, isLit, isAhead] of parts) {
      if (to > from) pieces.push({ ...run, text: run.text.slice(from - at, to - at), isLit, isAhead })
    }
    at = runEnd
  }
  return pieces
}

/** Pieces with the text from character `to` of their block on left out, as the window's last line cuts a block. */
export function piecesTo(pieces: readonly Piece[], to: number): Piece[] {
  const kept: Piece[] = []
  let at = 0
  for (const piece of pieces) {
    if (at >= to) break
    kept.push(at + piece.text.length <= to ? piece : { ...piece, text: piece.text.slice(0, to - at) })
    at += piece.text.length
  }
  return kept
}

/**
 * A list item's marker as the terminal's Markdown draws it: `- ` for a bullet, `[ ] ` and `[x] `
 * for a task's box, a number as it is. The editor keeps the marks `parse` gives (`• `, `☐ `).
 */
export function terminalMarker(marker: string): string {
  return marker.replace(/^• /, '- ').replace('☐ ', '[ ] ').replace('☑ ', '[x] ')
}

/** A line that opens a list item nested in another: indented, then a bullet or a number. */
const NESTED_ITEM = /^[ \t]+([-*+]|\d+[.)])[ \t]/

/**
 * The Markdown after the block being read, cut where a list nested under that block ends.
 *
 * Drawn alone, Markdown reads the first item of `after` as a list of its own, at the left
 * margin, so items nested under the one being read would jump left while it is read. The head
 * that is nested (the lines up to the first one back at the margin) comes back dedented, with
 * the indent to draw it at; `rest` is the remainder, and `isGap` says a blank line came
 * between the two. With no nested head, `nested` is empty and `rest` is `after`.
 */
export function splitNested(after: string): { nested: string; indent: number; rest: string; isGap: boolean } {
  const lines = after.split('\n')
  if (!NESTED_ITEM.test(lines[0] ?? '')) return { nested: '', indent: 0, rest: after, isGap: false }
  const end = lines.findIndex(line => line.trim() !== '' && !/^[ \t]/.test(line))
  const head = end === -1 ? lines : lines.slice(0, end)
  const rest = end === -1 ? [] : lines.slice(end)
  const widthOf = (line: string) => (line.match(/^[ \t]*/)?.[0] ?? '').replace(/\t/g, '    ').length
  const indent = Math.min(...head.filter(line => line.trim() !== '').map(widthOf))
  const nested = head
    .map(line => line.replace(/\t/g, '    ').slice(Math.min(indent, widthOf(line))))
    .join('\n')
    .replace(/\s+$/, '')
  const isGap = rest.length > 0 && head[head.length - 1]?.trim() === ''
  return { nested, indent, rest: rest.join('\n'), isGap }
}

/** A short mark of a reply's opening, so two blocks that share a message id are told apart. */
export function markOf(text: string): string {
  let hash = 5381
  const head = text.slice(0, 160)
  for (let i = 0; i < head.length; i += 1) hash = ((hash * 33) ^ head.charCodeAt(i)) >>> 0
  return hash.toString(36)
}
