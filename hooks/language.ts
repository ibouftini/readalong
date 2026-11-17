// Which language a reply is written in, and each of its sentences.
//
// readalong reads English, its main language, and seven others. A voice made for one language
// reads another with the wrong sounds, which is hard to follow and sounds absurd, so each
// sentence is read in the language it is written in, by that language's rules:
//
//   1. A reply has a language (`languageOf`): English unless another is clearly ahead. A reply
//      in a language with no voice (Japanese, Arabic, Russian) is not read without asking.
//   2. Its first sentence is read in the reply's language. Each sentence after keeps the
//      language of the one before it, unless it is clearly in another (`spokenIn`): so one too
//      short to tell ("Parfait.", "Done.") keeps the language around it. A sentence that changes
//      language at a comma is read clause by clause, each in its own (`clausesIn`).
//   3. Words a sentence sets apart (in quotation marks, brackets, bold or italics), three at
//      least and clearly in another language, are read in that language's voice: an English
//      sentence that quotes a French error message. English set apart in a sentence of another
//      language is said in that sentence's voice, by English rules, as code is (text.ts).
//   4. A label that names a language ("French: Fichier introuvable", "### German") says what
//      the words after it are in, unless they read as English ("French: done") (`labelIn`).
//   5. A sentence written in another script is told by its letters: Devanagari is Hindi. Letters
//      of a script no voice reads are left out of what is said (`UNREAD`); a sentence that is
//      mostly such letters is not read.
//   6. A language Kokoro has a voice for is read in that voice; German and Dutch, which it has
//      none for, by the English voice picked, with German or Dutch sounds (state.ts).
//   7. Equations and code names are said in English in every sentence, in the sentence's voice
//      (speech.ts).
//
// Both tests are meant to be careful rather than clever: the worst mistake is to leave English
// for a language the text is not in.

import { LEXICON } from './lexicon'

/** A language a reply may be in, by its code and its name. */
export type Language = { code: string; name: string }

export const ENGLISH: Language = { code: 'en', name: 'English' }

/** The languages readalong reads. */
export const SPOKEN = ['en', 'fr', 'es', 'it', 'pt', 'hi', 'de', 'nl'] as const
export type Spoken = (typeof SPOKEN)[number]

export function isSpoken(code: unknown): code is Spoken {
  return (SPOKEN as readonly unknown[]).includes(code)
}

const HINDI: Language = { code: 'hi', name: 'Hindi' }

/** Scripts that are never English, by the letters they are written in. */
const SCRIPTS: ReadonlyArray<readonly [RegExp, Language]> = [
  [/[぀-ヿ]/g, { code: 'ja', name: 'Japanese' }],
  [/[가-힯ᄀ-ᇿ]/g, { code: 'ko', name: 'Korean' }],
  [/[一-鿿㐀-䶿]/g, { code: 'zh', name: 'Chinese' }],
  [/[؀-ۿݐ-ݿ]/g, { code: 'ar', name: 'Arabic' }],
  [/[֐-׿]/g, { code: 'he', name: 'Hebrew' }],
  [/[Ѐ-ӿ]/g, { code: 'ru', name: 'Russian' }],
  [/[Ͱ-Ͽ]/g, { code: 'el', name: 'Greek' }],
  [/[ऀ-ॿ]/g, HINDI],
  [/[฀-๿]/g, { code: 'th', name: 'Thai' }],
]

/** A letter of a script no voice reads: the voice would spell it, "Chinese letter, Chinese letter". */
export const UNREAD = /[぀-ヿ가-힯ᄀ-ᇿ一-鿿㐀-䶿؀-ۿݐ-ݿ֐-׿Ѐ-ӿͰ-Ͽ฀-๿]/g

const DEVANAGARI = /[ऀ-ॿ]/g
const LATIN = /[A-Za-zÀ-ɏ]/g

/** A language's common words: those given, and its lexicon's. */
function common(code: string, words: string): ReadonlySet<string> {
  return new Set([...words.split(' '), ...(LEXICON[code] ?? '').split(/\s+/).filter(word => word !== '')])
}

/**
 * The commonest short words of each language written in Latin letters: articles, pronouns,
 * prepositions, conjunctions, auxiliaries, and a few words of greeting and thanks. A word two
 * of them share ("que", "la", "de") counts for each, and tells neither from the other. A word
 * that is also a common English one ("die", "was", "as", "do", "come", "per") is left out of
 * the other languages' lists, and so are French words English prose uses ("plus", "son",
 * "sans"): they would take an English sentence for another language's.
 */
const WORDS: ReadonlyArray<readonly [Language, ReadonlySet<string>]> = [
  [ENGLISH, common('en', "the and of to is that it for you with this are was be not have as but they which or what can will there your their if would has from at an we by all one when about so i'll i'm i've it's that's let's don't doesn't can't won't isn't didn't you're we're there's here's does did had were been my its his she he our them these those then than how why who where here now just into out up yes should could may must only more some any each both after before again do no on in me us am also very still while because without done complete completed missing pending ready translated untranslated updated fixed added removed needed strings string finished reviewed approved failing passing broken works working left")],
  [{ code: 'fr', name: 'French' }, common('fr', "le la les des est et un une du que qui dans pour pas sur au avec ce cette sont il elle nous vous mais ou aux ces sa ses leur être fait comme très aussi je tu à où ça été déjà voici voilà par bref enfin ensuite parce pourquoi beaucoup jamais trop moins bien mieux tous tout toute cela bonjour merci oui leurs donc alors puis quand chez sous vers après avant depuis encore toujours suis sommes êtes ont avons avez peut faut doit vais vont ils elles quelle même autre autres deux cet mon notre votre ici voir faire avoir ainsi chaque rien de se si en c'est n'est j'ai qu'il qu'elle d'un d'une")],
  [{ code: 'es', name: 'Spanish' }, common('es', "el los las es y un una del que en por para con no se lo su al como más pero sus este esta estos estas son está están hay muy también yo tú él ella nosotros ellos usted ustedes aquí ahora ya solo bien tiene tienen puede pueden fue cuando donde porque sin hasta desde mucho otro otra mismo siempre nunca gracias hola sí eso esto todo todos nada algo he ha han hemos ser hacer así después antes entre sobre mi tu le les qué cómo voy vamos de la si")],
  [{ code: 'it', name: 'Italian' }, common('it', "il lo gli della dello degli delle del che è e di un una non con sono nel nella alla alle si più anche questo questa queste questi ma ci sul sulla dei ho hai ha abbiamo hanno sei siamo era essere fare fatto tutto tutti niente qui ora adesso già bene può possono vuoi quando dove perché senza fino dal dalla molto altro stesso sempre mai grazie ciao sì io lui lei noi voi loro mio tuo suo ecco poi quindi allora ancora cosa se la le su il")],
  [{ code: 'pt', name: 'Portuguese' }, common('pt', "o os da um uma em para com não se dos das na nas ao aos seu sua também é está estão são isso isto você vocês aqui agora já só bem tem têm pode podem foi quando onde porque sem até desde muito outro outra mesmo sempre nunca obrigado obrigada olá sim ele ela eles elas nós eu meu minha que e mas mais pela pelo à às tudo esse essa aquele ainda depois então nada ser fazer como por entre sobre vou de há no na")],
  [{ code: 'de', name: 'German' }, common('de', "der das und ist nicht ein eine einen einem einer zu den mit von sich auf für dem des auch es sind wir ich sie er werden wird oder aber wie bei nach noch nur schon sehr hier jetzt dann wenn weil dass kann können muss müssen soll sollte haben habe wurde wurden sein ihr du dir dich mir mich uns kein keine alle alles nichts etwas mehr über unter aus durch um zum zur im vom beim diese dieser dieses danke bitte ja nein gibt immer nie vielleicht gerne hast bist mein dein unser machen gehen sehen gut")],
  [{ code: 'nl', name: 'Dutch' }, common('nl', "de het een en van dat niet te op voor met zijn er maar ook als bij nog wordt worden kan dit deze naar wij ik jij je hij zij ze dan nu al wel geen heb heeft hebben zou moet moeten kunnen om aan uit dus hoe waar omdat alle veel meer goed hier daar dank ja nee wat niets iets verder alleen mijn jouw toch misschien altijd nooit graag hebt bent ben wil gaat gaan doen doet maken zien heel")],
]

const ENGLISH_WORDS = WORDS[0]![1]

/** English common words other languages write too, as words of their own: "in", "an", "of", "do". */
const SHARED = new Set('in an is of do no as am me so on we op had'.split(' '))

/** The letters each language writes and English does not: one of them is a sign of it, once. */
const LETTERS: Readonly<Record<string, RegExp>> = {
  fr: /[àâçèéêëîïôùûœ]/i,
  es: /[áéíóúñ¿¡]/i,
  it: /[àèéìòù]/i,
  pt: /[áâãàçéêíóôõú]/i,
  de: /[äöüß]/i,
}

/** The letters and marks only one of these languages writes: a sure sign of it, worth two. */
const OWN_LETTERS: Readonly<Record<string, RegExp>> = {
  fr: /œ/i,
  es: /[ñ¿¡]/i,
  it: /[ìò]/i,
  pt: /[ãõ]/i,
  de: /ß/,
}

/**
 * A word cut short before a vowel: French "j'ai", "qu'elle", Italian "dell'errore", "un'altra";
 * as common as the short words, and never English. An English "'s" after a letter's name
 * ("C's") is not one.
 */
const ELISIONS: Readonly<Record<string, RegExp>> = {
  fr: /(?<!\p{L})(?:j|l|d|n|c|s|m|t|qu|jusqu|lorsqu|puisqu)['’](?!s(?!\p{L}))(?=\p{L})/giu,
  it: /(?<!\p{L})(?:l|d|un|dell|nell|all|sull|dall|quest|nient|com|dov)['’](?!s(?!\p{L}))(?=\p{L})/giu,
}

/**
 * How words of each language end, and English ones of six letters or more do not: "traducción",
 * "possibilità", "Einstellungen", "mogelijkheid". A sentence of few short words is told by these.
 */
const ENDINGS: Readonly<Record<string, RegExp>> = {
  fr: /(?:eux|euse|aient|ée|ées|és|ité|ités|ère|ères|ième)$/,
  es: /(?:ción|ciones|dad|dades|ador|adores|iendo|mente|ando)$/,
  it: /(?:zione|zioni|ità|mente|aggio|ezza|ando|endo|tore|tori)$/,
  pt: /(?:ção|ções|dade|dades|ador|adores|mente|ando|endo|indo|agem|ável|ível)$/,
  de: /(?:ungen|keit|heit|lich|isch|schaft|ieren|iert|[^aeiou]ung)$/,
  nl: /(?:heid|lijk|lijke|atie|aties|eerd|baar)$/,
}

/**
 * Fewer words than this, and the reply is taken as English: there is too little to tell. Six
 * are enough with five signs: "Klaar! De tests slagen nu en de build is groen." is Dutch from
 * its first word.
 */
const FEWEST_WORDS = 6

const count = (text: string, letters: RegExp) => (text.match(letters) ?? []).length

/**
 * How many of each language's common words a text uses, and how many words it has. With
 * `isOnce`, a word said twice counts once: in a sentence, "is" twice is no more English than once.
 */
function signs(prose: string, isOnce = false): { words: number; kept: string[]; hits: Array<{ language: Language; hits: number }> } {
  // An acronym is no one's common word: "UN", "EST", "LA", "DES". Nor is a word with a capital
  // inside a clause: a name, as in "La Liga", "El Clásico", "Der Spiegel". A clause starts the
  // text, and after a colon, a dash, an opening quote or bracket: "Dutch: Het bestand".
  const all = [...prose.matchAll(/\p{L}+(?:['’]\p{L}+)?/gu)]
    .filter(m => {
      const word = m[0]
      if (word.length >= 2 && word === word.toUpperCase()) return false
      const isStart = /(?:^|[:;—–"“«(\[¿¡]|\s[-–—])\s*$/u.test(prose.slice(0, m.index))
      return isStart || !/^\p{Lu}\p{Ll}/u.test(word)
    })
    .map(m => m[0].toLowerCase().replace('’', "'"))
  const words = isOnce ? [...new Set(all)] : all
  return {
    words: all.length,
    kept: all,
    hits: WORDS.map(([language, common]) => {
      const elisions = ELISIONS[language.code]
      const ending = ENDINGS[language.code]
      const endings = ending === undefined ? 0 : words.filter(word => word.length >= 6 && !common.has(word) && ending.test(word)).length
      return { language, hits: words.filter(word => common.has(word)).length + endings + (elisions === undefined ? 0 : count(prose, elisions)) }
    }),
  }
}

/**
 * The language a reply is written in, by its prose: code blocks, inline code, links' addresses
 * and paths are left out first. English unless another language is clearly ahead.
 */
export function languageOf(markdown: string): Language {
  const prose = markdown
    .replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\S*[\\/]\S*/g, ' ')

  // Another script: a third of the letters in it is enough, as English rarely borrows one.
  const letters = count(prose, /\p{L}/gu)
  if (letters === 0) return ENGLISH
  for (const [script, language] of SCRIPTS) {
    const found = count(prose, script)
    if (found >= 4 && found / letters > 0.3) return language
  }

  // Latin letters: whose common words it uses most.
  const { words, hits } = signs(prose)
  if (words < FEWEST_WORDS) return ENGLISH
  const english = hits[0]?.hits ?? 0
  const best = hits.slice(1).reduce((a, b) => (b.hits > a.hits ? b : a))
  // Clearly ahead: at least five common words, twice English's count.
  return best.hits >= 5 && best.hits >= 2 * english ? best.language : ENGLISH
}

/** Words in quotation marks, of any language's kind: "…", “…”, „…“, «…», ‘…’. */
export const QUOTED = /"[^"]*"|“[^”]*”|„[^“”]*[“”]|«[^»]*»|‘(?:[^’]|’(?=\p{L}))*’(?!\p{L})/gu

/**
 * How many signs of each language `told` has, from its `hits` and the words `kept`: a common
 * word, an ending, a word cut short, and the letters it writes and English does not.
 */
function signsOf(told: string, hits: ReadonlyArray<{ language: Language; hits: number }>, kept: readonly string[]): (code: string) => number {
  // Letters are told from the words kept, names left out: "São Paulo", "Weiß" are no one's
  // sentence. And they back a language's words, never stand alone: "a piñata emoji" is English.
  const plain = kept.join(' ')
  return code => {
    const words = hits.find(h => h.language.code === code)?.hits ?? 0
    // Spanish's opening marks are no one's name: "¡Hecho!".
    if (words === 0) return code === 'es' && /[¿¡]/.test(told) ? 2 : 0
    return words + (LETTERS[code]?.test(plain) === true ? 1 : 0) + (OWN_LETTERS[code]?.test(plain) === true ? 2 : 0)
  }
}

/**
 * The language a sentence is read in: `before`, that of the sentence read before it, unless its
 * words (`prose`, without its code) are clearly in another language readalong reads.
 *
 * By its script first: a sentence in Devanagari is Hindi, and one in Latin letters is not.
 * Then by its signs, those of the words it quotes left out: what is around a quotation tells
 * the sentence's language, as for code. A sign of a language is one of its common words, a word
 * that ends as its words do, a word cut short before a vowel, a letter it writes and English
 * does not (once), and a letter or mark only it writes (once, worth two).
 *
 * Clearly in another: two signs of it at least, twice as many as the sentence has of the
 * language before, and more than it has of any other. Leaving English, or passing it over for
 * a third language, takes more than twice English's signs: the worst mistake is to read English
 * as something else. Two languages level at the top (Spanish and Portuguese share half their
 * short words) are told apart by `seen`, the languages this reply has been read in so far: the
 * one already heard is the likelier. Still level, the sentence keeps the language before.
 */
export function spokenIn(prose: string, before: Spoken, seen: ReadonlySet<Spoken> = new Set(), least = 2): Spoken {
  const hindi = count(prose, DEVANAGARI)
  const latin = count(prose, LATIN)
  if (hindi > latin) return hindi >= 2 ? 'hi' : before
  // Nothing to tell from: a number, a mark.
  if (latin === 0) return before
  // Latin letters after Hindi: English, the main language, unless it is clearly another.
  const from = before === 'hi' ? 'en' : before
  const around = prose.replace(QUOTED, ' ')
  const told = (around.match(/\p{L}{2,}/gu) ?? []).length >= 2 ? around : prose
  const { hits, kept } = signs(told, true)
  const of = signsOf(told, hits, kept)
  // Back to English, the main language, on less: three words at least, one English word no other
  // language writes, no sign of the language before, and no more of any other ("All tests pass.",
  // "Tests are green.").
  const english = of('en')
  const isSure = kept.some(word => ENGLISH_WORDS.has(word) && !SHARED.has(word))
  if (from !== 'en' && kept.length >= 3 && isSure && of(from) === 0 && SPOKEN.every(code => code === 'en' || of(code) <= english)) return 'en'
  const others = SPOKEN.filter(code => code !== from && code !== 'hi')
  const top = Math.max(...others.map(of))
  if (top < least || top < 2 * of(from)) return from
  const level = others.filter(code => of(code) === top)
  const heard = level.filter(code => seen.has(code))
  const next = level.length === 1 ? level[0] : heard.length === 1 ? heard[0] : undefined
  if (next === undefined) return from
  return next !== 'en' && top <= 2 * of('en') ? from : next
}

/** Fewest words a clause needs to be told on its own; a shorter one says too little. */
const CLAUSE_WORDS = 3

/**
 * The language each clause of a sentence is read in, with `language` the sentence's own: a
 * sentence may switch language at a comma, as when it quotes a line without quotation marks
 * ("She whispered, c'est plus facile que tu ne le crois.").
 *
 * Only when two clauses at least are long enough to tell is each told on its own, as a sentence
 * is, but with three signs at least; otherwise the whole sentence keeps `language`. A clause too
 * short to tell ("Later,", "Bref,") takes the language of the told clause before it, or else of
 * the one after it.
 */
export function clausesIn(clauses: readonly string[], language: Spoken, seen: ReadonlySet<Spoken> = new Set()): Spoken[] {
  const told = clauses.map(clause =>
    (clause.match(/\p{L}+/gu) ?? []).length >= CLAUSE_WORDS ? spokenIn(clause, language, seen, 3) : undefined,
  )
  if (told.filter(found => found !== undefined).length < 2) return clauses.map(() => language)
  return told.map((found, i) => found ?? told.slice(0, i).reverse().find(x => x !== undefined) ?? told.slice(i + 1).find(x => x !== undefined) ?? language)
}

/**
 * What each language is called, in each language readalong reads: by the language the name is
 * in, then the language it names.
 */
const NAMES: Readonly<Record<Spoken, Readonly<Record<Spoken, string>>>> = {
  en: { en: 'English', fr: 'French', es: 'Spanish', it: 'Italian', pt: 'Brazilian Portuguese|Portuguese', de: 'German', nl: 'Dutch', hi: 'Hindi' },
  fr: { en: 'anglais', fr: 'français', es: 'espagnol', it: 'italien', pt: 'portugais', de: 'allemand', nl: 'néerlandais', hi: 'hindi' },
  es: { en: 'inglés', fr: 'francés', es: 'español|castellano', it: 'italiano', pt: 'portugués', de: 'alemán', nl: 'neerlandés', hi: 'hindi' },
  it: { en: 'inglese', fr: 'francese', es: 'spagnolo', it: 'italiano', pt: 'portoghese', de: 'tedesco', nl: 'olandese', hi: 'hindi' },
  pt: { en: 'inglês', fr: 'francês', es: 'espanhol', it: 'italiano', pt: 'português', de: 'alemão', nl: 'holandês|neerlandês', hi: 'hindi' },
  de: { en: 'Englisch', fr: 'Französisch', es: 'Spanisch', it: 'Italienisch', pt: 'Portugiesisch', de: 'Deutsch', nl: 'Niederländisch', hi: 'Hindi' },
  nl: { en: 'Engels', fr: 'Frans', es: 'Spaans', it: 'Italiaans', pt: 'Portugees', de: 'Duits', nl: 'Nederlands', hi: 'Hindi' },
  hi: { en: 'अंग्रेज़ी|अंग्रेजी', fr: 'फ़्रेंच|फ्रेंच', es: 'स्पेनिश', it: 'इतालवी', pt: 'पुर्तगाली', de: 'जर्मन', nl: 'डच', hi: 'हिन्दी|हिंदी' },
}

/** Each name, lowercased: the language it names, and the language it is a word of. */
const NAMED = new Map<string, { language: Spoken; said: Spoken }>()
for (const said of SPOKEN) {
  for (const language of SPOKEN) {
    for (const name of NAMES[said][language].split('|')) {
      const known = NAMED.get(name.toLowerCase())
      // "italiano" is a word of Spanish, Italian and Portuguese: Italian's own, first.
      if (known === undefined || said === language) NAMED.set(name.toLowerCase(), { language, said })
    }
  }
}

const LABEL = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(${[...NAMED.keys()].sort((a, b) => b.length - a.length).join('|')})` +
    String.raw`(?:\s+(?:version|translation|text|wording))?(?:\s*\([^()]{1,30}\))?\)?\s*[:：](?=\s|$)`,
  'iu',
)
/** A label that is all there is, as a heading writes it: "### French", "German translation". */
const LABEL_ALONE = new RegExp(
  String.raw`^\s*(?:in\s+|the\s+)?(${[...NAMED.keys()].sort((a, b) => b.length - a.length).join('|')})` +
    String.raw`(?:\s+(?:version|translation|text|wording))?(?:\s*\([^()]{1,30}\))?\s*[:：.]?\s*$`,
  'iu',
)
/** A locale's code as a label, at the start only: "fr:", "pt-BR:", "de_DE:"; "it:" inside a sentence is English. */
const CODE_LABEL = /^["'“]?(en|fr|es|it|pt|de|nl|hi)(?:[-_][A-Z]{2})?["'”]?\s*[:：](?=\s|$)/u

/** A label naming the language of what follows it: where it starts and ends in `text`, the language named, and the language the label itself is a word of. */
export type Label = { at: number; end: number; language: Spoken; said: Spoken }

/**
 * The first label in `text` that names a language readalong reads, as a list of translations
 * writes it: "French: Fichier introuvable", "**Español:** …", "In German: …", "Portuguese
 * (Brazil): …", "fr-FR: …". A name with no colon after it is a word like any other.
 */
export function labelIn(text: string): Label | undefined {
  const alone = LABEL_ALONE.exec(text)
  const name = alone === null ? undefined : NAMED.get(alone[1]!.toLowerCase())
  if (name !== undefined) return { at: 0, end: text.length, ...name }
  const code = CODE_LABEL.exec(text)
  if (code !== null) return { at: 0, end: code[0].length, language: code[1] as Spoken, said: 'en' }
  const m = LABEL.exec(text)
  const named = m === null ? undefined : NAMED.get(m[1]!.toLowerCase())
  return m === null || named === undefined ? undefined : { at: m.index, end: m.index + m[0].length, ...named }
}

/**
 * The language of what a label names `named` is in: that one, unless it has more signs of
 * English ("French: done", "German: 12 strings missing") or is clearly in another.
 */
export function labelledIn(prose: string, named: Spoken, seen: ReadonlySet<Spoken> = new Set()): Spoken {
  const { hits, kept } = signs(prose, true)
  const of = signsOf(prose, hits, kept)
  if (named !== 'en' && of('en') > of(named)) return 'en'
  return spokenIn(prose, named, seen)
}
