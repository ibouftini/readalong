// What is sent to the voice: a sentence's text, made easy to say.
//
// Each rule fixes something the bundled voice (Kokoro-82M, whose words go through espeak-ng)
// was heard to get wrong in Claude Code replies, checked with the voice's own phonemizer: paths
// read "slash" by "slash", ranges read "two dash three", "2x" read "two ex", inline maths read
// "dollar x two dollar". The wording follows the scientific-reader conventions where they apply
// ("x squared", "x i" for a subscript, "big O of n"). The rules are mechanical and careful: one
// that cannot tell what a mark means leaves it alone, since the voice already reads most symbols
// (≤, ±, %, °C), acronyms, camelCase and snake_case well.
//
// The rules are the same in every language readalong reads; the words they put in place of a
// mark are that language's (words.ts): "reader.ts:42" is "reader dot ts, line 42" in an English
// sentence and "reader point ts, ligne 42" in a French one.
//
// Equations and code names are English in every sentence: "x squared plus y squared", "settings
// now", "git push". In a sentence of another language they are held aside while its rules run,
// then put back, and the sentence says which of its words they are (`Said.english`), so the
// voice says those by English rules.

import type { Spoken } from './language'
import { WORDS } from './words'
import type { Words } from './words'

/** File extensions read as "name dot extension". */
const EXTENSIONS =
  'ts|tsx|js|jsx|mjs|cjs|json|jsonl|md|mdx|py|ipynb|sh|bash|zsh|ps1|yaml|yml|toml|lock|txt|csv|tsv|' +
  'css|scss|html|xml|svg|png|jpg|jpeg|gif|webp|pdf|wav|mp3|mp4|onnx|npz|bin|log|env|ini|cfg|conf|' +
  'rs|go|java|kt|c|h|cpp|hpp|cs|rb|php|swift|sql|vue|svelte|lua|r|tex|bib'

/** How a person calls a file of each kind, to stand in for a name too long to say. */
const KINDS: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript',
  cjs: 'JavaScript', json: 'JSON', jsonl: 'JSON', md: 'Markdown', mdx: 'Markdown', py: 'Python',
  ipynb: 'notebook', sh: 'shell', bash: 'shell', zsh: 'shell', yaml: 'YAML', yml: 'YAML',
  toml: 'TOML', txt: 'text', csv: 'CSV', tsv: 'TSV', css: 'CSS', scss: 'CSS', html: 'HTML',
  xml: 'XML', svg: 'SVG', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image',
  pdf: 'PDF', wav: 'audio', mp3: 'audio', mp4: 'video', log: 'log', lock: 'lock', rs: 'Rust',
  go: 'Go', java: 'Java', rb: 'Ruby', php: 'PHP', sql: 'SQL', tex: 'LaTeX', onnx: 'model',
}

const GREEK = [
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'vartheta',
  'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi', 'rho', 'sigma', 'tau', 'upsilon', 'phi',
  'varphi', 'chi', 'psi', 'omega',
]

/** LaTeX commands read as words; the Greek letters are added below. */
const TEX_WORDS: Record<string, string> = {
  le: 'is at most', leq: 'is at most', ge: 'is at least', geq: 'is at least', ne: 'is not equal to',
  neq: 'is not equal to', approx: 'is approximately', sim: 'is distributed as', equiv: 'is equivalent to',
  in: 'in', notin: 'not in', subset: 'a subset of', subseteq: 'a subset of', to: 'to', rightarrow: 'to',
  mapsto: 'maps to', infty: 'infinity', pm: 'plus or minus', cdot: 'times', times: 'times', div: 'divided by',
  log: 'log', ln: 'natural log', exp: 'exp', sin: 'sine', cos: 'cosine', tan: 'tangent', max: 'max',
  min: 'min', arg: 'arg', lim: 'the limit of', partial: 'partial', nabla: 'the gradient of',
  ldots: 'and so on', cdots: 'and so on', dots: 'and so on', forall: 'for all', exists: 'there exists',
  cup: 'union', cap: 'intersected with', emptyset: 'the empty set', mid: 'given',
}
for (const letter of GREEK) TEX_WORDS[letter] = letter.replace(/^var/, '')
for (const letter of GREEK) TEX_WORDS[letter[0]!.toUpperCase() + letter.slice(1)] = `capital ${letter}`

/** A code span: its operators as words, `run()` as "run", a variable `a` as the letter. In English, in every sentence. */
export function sayCode(code: string): string {
  return code
    .trim()
    .replace(/(?<![\w'-])a(?![\w'])/g, 'eh')
    .replace(/^([\w.$]+)\(\)$/, '$1')
    // `claude plugin test .`: a lone dot is "this folder", not a full stop.
    .replace(/(^|\s)\.(?=\s|$)/g, '$1dot')
    .replace(/\s*(?:===|==)\s*/g, ' equals ')
    .replace(/\s*(?:!==|!=)\s*/g, ' is not ')
    .replace(/\s*&&\s*/g, ' and ')
    .replace(/\s*\|\|\s*/g, ' or ')
    .replace(/\s*(?:=>|->)\s*/g, ' to ')
}

/**
 * Inline maths, `$...$`, as a lecturer would say it: simple formulas well, others plainly. In
 * English, in every sentence.
 */
export function sayMath(tex: string): string {
  let text = tex.replace(/\\(?:left|right|displaystyle|[,;:! ]|quad|qquad)/g, ' ')
  // Text-like wrappers keep their content: \mathrm{x}, \mathbf{x}, \text{x}, \operatorname{x}.
  text = text.replace(/\\(?:text|mathrm|mathbf|mathcal|mathbb|mathit|mathsf|boldsymbol|operatorname)\{([^{}]*)\}/g, ' $1 ')
  // Innermost first, so a fraction in a root or a root in a fraction is read whole.
  for (let before = ''; before !== text; ) {
    before = text
    text = text
      .replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, ' $1 over $2 ')
      .replace(/\\sqrt\{([^{}]*)\}/g, ' the square root of $1 ')
  }
  text = text
    .replace(/\\(sum|prod|int)_\{?([^{}^]*?)\}?\^\{?([^{}\s]*)\}?/g, (_, op: string, from: string, to: string) => ` the ${bigName(op)} from ${from} to ${to} of `)
    .replace(/\\(sum|prod|int)\b/g, (_, op: string) => ` the ${bigName(op)} of `)
    .replace(/\^\{?2\}?(?![\w{])/g, ' squared ')
    .replace(/\^\{?3\}?(?![\w{])/g, ' cubed ')
    .replace(/\^\{?\\top\}?/g, ' transpose ')
    .replace(/\^\{([^{}]*)\}|\^(\\?\w)/g, (_, group?: string, one?: string) => ` to the ${group ?? one} `)
    .replace(/_\{([^{}]*)\}|_(\\?\w)/g, (_, group?: string, one?: string) => ` ${group ?? one} `)
    .replace(/\\([A-Za-z]+)/g, (_, name: string) => ` ${TEX_WORDS[name] ?? name} `)
    .replace(/([A-Za-z])\s*\(([^()]*)\)/g, '$1 of $2 ')
    .replace(/<=|≤/g, ' is at most ')
    .replace(/>=|≥/g, ' is at least ')
    .replace(/!=|≠/g, ' is not equal to ')
    .replace(/≈/g, ' is approximately ')
    .replace(/×/g, ' times ')
    .replace(/÷/g, ' divided by ')
    .replace(/=/g, ' equals ')
    .replace(/</g, ' is less than ')
    .replace(/>/g, ' is greater than ')
    .replace(/\+/g, ' plus ')
    .replace(/(^|[^\w])-|(?<=\w\s*)-/g, '$1 minus ')
    .replace(/\*/g, ' times ')
    .replace(/\//g, ' over ')
    .replace(/[{}()[\]|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // A lone "a" is read as the article; "eh" is read as the letter.
  return text.replace(/(?<![\w'])a(?![\w'])/g, 'eh')
}

function bigName(op: string): string {
  return op === 'sum' ? 'sum' : op === 'prod' ? 'product' : 'integral'
}

/** A name of more than three spoken parts, or too long to hold in mind: "session-export-final-v3". */
function isLong(name: string): boolean {
  const parts = name
    .split(/[-_.\s]+|(?<=[a-z])(?=[A-Z])|(?<=[A-Za-z])(?=\d)|(?<=\d)(?=[A-Za-z])/)
    .filter(part => part !== '')
  return parts.length > 3 || name.length > 24
}

/**
 * A token with a slash: a path read as its last name (a file name is then read by the file rule;
 * a long folder name becomes "the folder"), or two words said together ("read/write").
 */
function sayPath(token: string, at: number, whole: string, w: Words): string {
  const segments = token.split('/').filter(s => s !== '')
  const last = segments[segments.length - 1] ?? ''
  // "km/h" is a unit, said with the number before it.
  if (/^\d+\/\d+$/.test(token) || w.units[token] !== undefined) return token
  const isFile = new RegExp(`\\.(?:${EXTENSIONS})$`, 'i').test(last)
  const isPath =
    /^(?:~|\.{1,2}|@)?\//.test(token) ||
    token.startsWith('~') ||
    token.startsWith('@') ||
    token.endsWith('/') ||
    segments.length > 2 ||
    isFile
  if (!isPath) return segments.join(' ')
  const stood = !isFile && isLong(last) ? w.standIn('folder', '', whole.slice(0, at), whole.slice(at + token.length)) : undefined
  return stood ?? last
}

/**
 * Whether a code span is a path or a file's name, with or without a line: said by the
 * sentence's own rules ("reader point ts, ligne 42"), where any other code is said in English.
 */
export function isFileLike(code: string): boolean {
  return /[\\/]/.test(code) || new RegExp(`\\.(?:${EXTENSIONS})(?::\\d+(?:[-–]\\d+)?(?::\\d+)?)?$`, 'i').test(code.trim())
}

// English words held aside in a sentence of another language: each stands in the text as one
// character of Unicode's private use, which no rule reads as a letter, a digit, a space or a mark.
const FIRST_HELD = 0xe000
const HELD = /[\ue000-\uf8ff]/g

/** Holds `words`, English, aside in `held`, and gives the character that stands for them. */
export function hold(held: string[], words: string): string {
  held.push(words)
  return String.fromCharCode(FIRST_HELD + held.length - 1)
}

/**
 * What a sentence says, and which of its words are English in a sentence of another language:
 * [from, to) pairs among the words of `speech`, cut at its spaces.
 */
export type Said = { speech: string; english: Array<[number, number]> }

/** Puts the English held aside back in `text`, and says where its words are. */
function release(text: string, held: readonly string[]): Said {
  const words: string[] = []
  const english: Array<[number, number]> = []
  for (const token of text.split(' ')) {
    const from = words.length
    // A mark beside what was held stays with its first or last word: "(x squared)," is two words.
    const full = token.replace(HELD, mark => held[mark.charCodeAt(0) - FIRST_HELD] ?? '')
    words.push(...full.split(/\s+/).filter(word => word !== ''))
    if (full === token || words.length === from) continue
    const last = english[english.length - 1]
    if (last !== undefined && last[1] === from) last[1] = words.length
    else english.push([from, words.length])
  }
  return { speech: words.join(' '), english }
}

/**
 * An equation written without $: terms joined by operators, each operator with a space on both
 * sides ("v = d / t", "x + y > 2"), so "120/2", "a->b", "x=>y" and "Array<string>" are not. A
 * term is a number or a name, either with a power ("x^2"), a minus before it allowed.
 */
const TERM = String.raw`(?:[-−]\s?)?(?:\d+(?:\.\d+)?|[A-Za-z][A-Za-z0-9]*)(?:\^\d+)?`
const OPERATOR = String.raw`\s+(?:==|!=|<=|>=|[=≠≤≥<>≈+\-−*×÷/])\s+`
const EQUATION = new RegExp(String.raw`(?<![\w.^$\\/-])${TERM}(?:${OPERATOR}${TERM})+(?![\w^/])`, 'g')
/** What makes terms an equation: a relation between them. */
const RELATION = /\s(?:==|!=|<=|>=|[=≠≤≥<>≈])\s/
/** The last term, a number, and the operator before it. */
const LAST_NUMBER = new RegExp(String.raw`(${OPERATOR})(\d+(?:\.\d+)?)$`)

/**
 * Whether `terms` read as maths: every name in them one letter, with digits or not (x, x1).
 * "Settings > Privacy" is a path through menus, "Python >= 3.12" a requirement, "count != 0"
 * code: a longer name may be any of these, so it is left as written.
 */
function isMaths(terms: string): boolean {
  return (terms.match(/[A-Za-z][A-Za-z0-9]*/g) ?? []).every(name => /^[A-Za-z]\d*$/.test(name))
}

const UNIT_RULES = new Map<Spoken, RegExp>()
const UNIT_AFTER = new Map<Spoken, RegExp>()

/** Whether `rest` begins with one of a language's units: "km/h" in " km/h.". */
function startsWithUnit(rest: string, language: Spoken): boolean {
  let rule = UNIT_AFTER.get(language)
  if (rule === undefined) {
    const names = Object.keys(WORDS[language].units)
      .sort((a, b) => b.length - a.length)
      .map(name => name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'))
      .join('|')
    rule = new RegExp(`^\\s?(?:${names})(?![\\w])`)
    UNIT_AFTER.set(language, rule)
  }
  return rule.test(rest)
}

/** A number, then one of a language's units: "830 MB", "1.5s". */
function unitRule(language: Spoken): RegExp {
  let rule = UNIT_RULES.get(language)
  if (rule === undefined) {
    const names = Object.keys(WORDS[language].units).sort((a, b) => b.length - a.length).join('|')
    rule = new RegExp(`(?<![\\w.])(\\d+(?:\\.\\d+)?)(\\s?)(${names})\\b`, 'g')
    UNIT_RULES.set(language, rule)
  }
  return rule
}

/**
 * A sentence's text, made easy to say in the language it is read in. `held` is the English
 * already held aside in `text`, by `hold`: code names, by text.ts.
 */
export function say(text: string, language: Spoken = 'en', held: string[] = []): Said {
  const w = WORDS[language]
  const several = (count: string, unit: readonly [string, string]) => unit[w.isPlural(count) ? 1 : 0]
  // An equation is English: said as it is in an English sentence, held aside in another.
  const equation = (words: string) => (language === 'en' ? words : hold(held, words))
  let said = text
    .replace(/\p{Extended_Pictographic}️?/gu, ' ')
    // Inline maths, before anything else reads its marks: $ then no space ... no space then $.
    .replace(/\$(?=\S)([^$\n]*?\S)\$(?!\d)/g, (_, tex: string) => ` ${equation(sayMath(tex))} `)
    // An equation written without $, before the path rule reads its slashes. A last number with
    // a unit after it stays in the sentence, said with its unit in the sentence's language.
    .replace(EQUATION, (terms: string, at: number, whole: string) => {
      if (!RELATION.test(terms) || !isMaths(terms)) return terms
      const last = LAST_NUMBER.exec(terms)
      const isUnitAfter = last !== null && startsWithUnit(whole.slice(at + terms.length), language)
      const maths = isUnitAfter ? terms.slice(0, last.index) + last[1] : terms
      const kept = isUnitAfter ? last[2] : ''
      return `${equation(sayMath(maths.replace(/−/g, '-')))}${kept === '' ? '' : ` ${kept}`}`
    })
    // Identifiers and commit hashes say nothing to a listener.
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '')
    .replace(/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/g, '')
    // reader.ts:42, reader.ts:42-48: the file, then its line.
    .replace(new RegExp(`(\\S*\\.(?:${EXTENSIONS})):(\\d+)(?:[-–](\\d+))?(?::\\d+)?\\b`, 'g'), (_, file: string, from: string, to?: string) =>
      to === undefined ? `${file}, ${w.line} ${from}` : `${file}, ${w.lines} ${from} ${w.to} ${to}`,
    )
    .replace(/(?<![\w:/])[~.@\w-]*\/(?:[\w.@~+/-]*[\w@~+/-])?/g, (token: string, at: number, whole: string) => sayPath(token, at, whole, w))
    // A file name: "register dot tsx"; one too long to say: "the TypeScript file".
    .replace(
      new RegExp(`(?<![\\w.])(\\.?)([\\w-]+(?:\\.[\\w-]+)*)\\.(${EXTENSIONS})\\b(?!\\.\\w)`, 'gi'),
      (file: string, dot: string, name: string, ext: string, at: number, whole: string) => {
        const kind = w.kinds[ext.toLowerCase()] ?? KINDS[ext.toLowerCase()] ?? ext
        const stood = isLong(name) ? w.standIn('file', kind, whole.slice(0, at), whole.slice(at + file.length)) : undefined
        return stood ?? `${dot === '.' ? `${w.dot} ` : ''}${name.replace(/\./g, ` ${w.dot} `)} ${w.dot} ${ext}`
      },
    )
    .replace(/(?<![\w.])\.([A-Za-z][\w-]{2,})\b/g, `${w.dot} $1`)
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (date: string, year: string, month: string, day: string, at: number, whole: string) =>
      Number(day) >= 1 && Number(day) <= 31 ? (w.date(Number(day), Number(month), year, whole.slice(0, at)) ?? date) : date,
    )
    .replace(/(^|[\s(])#(\d+)\b/g, `$1${w.number} $2`)
    .replace(/\b(\d+(?:\.\d+)?)e([-+]?)(\d+)\b/g, (_, base: string, sign: string, power: string) =>
      equation(`${base} times 10 to the ${sign === '-' ? 'minus ' : ''}${power}`),
    )
    .replace(/\bO\(([^()]{1,30})\)/g, (_, inside: string) => equation(`big O of ${inside.replace(/\^2\b/, ' squared')}`))
    .replace(/(\w+)\^2\b/g, (_, base: string) => equation(`${base} squared`))
    .replace(/(\w+)\^3\b/g, (_, base: string) => equation(`${base} cubed`))
    .replace(/(?<![\w.])(\d+(?:\.\d+)?)(?:\s*[–—]\s*|-)(\d+(?:\.\d+)?)(?![\w.-])/g, `$1 ${w.to} $2`)
    .replace(/(\d)\s*[x×]\s*(\d)/g, `$1 ${w.by} $2`)
    .replace(/(\d(?:\.\d+)?)\s*[x×](?!\w)/g, `$1 ${w.times}`)
    .replace(unitRule(language), (whole: string, count: string, space: string, unit: string) => {
      // "the 1990s", "the 80s": a decade, not seconds.
      if (w.hasDecades && unit === 's' && space === '' && /0$/.test(count) && !count.includes('.')) return whole
      const named = w.units[unit]
      return named === undefined ? whole : `${count} ${several(count, named)}`
    })
    .replace(/\$(\d+(?:[.,]\d+)?)\b/g, (_, amount: string) => `${amount} ${several(amount, w.dollar)}`)
  // A replacement that is a string holds no "$1" of its own: a function gives it as it is.
  for (const [short, full] of w.short) said = said.replace(short, typeof full === 'string' ? () => full : full)
  said = said
    .replace(/\s*(?:->|=>|[→⟶⇒])\s*/g, ` ${w.arrow} `)
    .replace(/\s+&\s+/g, ` ${w.and} `)
    .replace(/~(?=\d)/g, `${w.about} `)
    // An aside in parentheses is said between commas: the voice pauses at a comma, not a bracket.
    .replace(/(^|\s)\(([^()]{1,100})\)/g, '$1, $2,')
  return release(
    // A capital A after the first word is a letter, not the article: "Let A be".
    (w.letterA === undefined ? said : said.replace(/(?<=[^\s.?!:]\s+)A(?=$|[\s,;:.?!)])/g, w.letterA))
      // A mark goes back against its word; one that begins an operator (!=) does not.
      .replace(/\s+([,.;:!?])(?!=)/g, '$1')
      .replace(/([,;:])(?:\s*[,;:])+/g, '$1')
      .replace(/,(?=[.!?])/g, '')
      .replace(/^[\s,;:]+/, '')
      .replace(/\s+/g, ' ')
      .trim(),
    held,
  )
}

/** What a sentence says, without which of its words are English. */
export function sayable(text: string, language: Spoken = 'en'): string {
  return say(text, language).speech
}
