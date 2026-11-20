// What the listening rules say in each language: the words they put in place of a mark.
//
// The rules themselves (speech.ts) are the same in every language. "reader.ts:42" is "reader dot
// ts, line 42" in an English sentence, "reader point ts, ligne 42" in a French one, "reader Punkt
// ts, Zeile 42" in a German one. Equations and code names have no words here: they are said in
// English in every sentence. Numbers are left to the voice, which says them in the sentence's
// language.

import type { Spoken } from './language'

/**
 * "vs" or "vs.", lowercase, or capitalised at a sentence's start: "versus" in the sentence's
 * language. "VS" in capitals is an initialism, as in VS Code, and is left for the voice to spell.
 */
const VERSUS = /\b[Vv]s\b\.?(?=\s)/g

/** A unit's spoken name: for one, and for several. */
type Unit = readonly [string, string]

export type Words = {
  /** A date, from its day, its month's number and its year, after the text `before` it. */
  date: (day: number, month: number, year: string, before: string) => string | undefined
  line: string
  lines: string
  /** Between two numbers: "2 to 3". */
  to: string
  dot: string
  /** Before a number written "#42". */
  number: string
  /** Between two sizes: "1920 by 1080". */
  by: string
  /** After a factor: "2 times". */
  times: string
  /** Units after a number, by how they are written. */
  units: Readonly<Record<string, Unit>>
  dollar: Unit
  isPlural: (count: string) => boolean
  /** Whether "the 1990s" is written, so a round number before an s is a decade, not seconds. */
  hasDecades: boolean
  /** Abbreviations, said in full. */
  short: ReadonlyArray<readonly [RegExp, string | ((whole: string, ...rest: any[]) => string)]>
  arrow: string
  and: string
  about: string
  /** What a lone "a" that is a letter is written as, where the voice would say the article. */
  letterA?: string
  /** How a person calls a file of each kind, where it is not the name every language uses. */
  kinds: Readonly<Record<string, string>>
  /**
   * What a person says for a name too long to read, a file's or a folder's, between the text
   * `before` it and `after` it; undefined where the name is better read as it is.
   */
  standIn: (noun: 'file' | 'folder', kind: string, before: string, after: string) => string | undefined
}

/** Units that add an s for several, and those in `same` that do not change. */
function units(named: Record<string, string>, same: readonly string[] = ['hertz', 'kilohertz', 'megahertz', 'gigahertz']): Record<string, Unit> {
  return Object.fromEntries(Object.entries(named).map(([unit, name]) => [unit, [name, same.includes(name.toLowerCase()) ? name : `${name}s`] as const]))
}

/** A month's name in a date, from a year's twelve. */
const month = (names: string, number: number) => names.split(' ')[number - 1]

/**
 * The stand-in of a language that says "the file TypeScript" or "the TypeScript-file": after
 * the noun itself ("le fichier <name>") the kind alone; after another determiner no second
 * article, as the writer's own agrees with the noun they had in mind; after a word cut short
 * ("l'", "dell'") the name is read, since no article would fit.
 */
function standInOf(o: {
  file: string
  folder: string
  the: Record<'file' | 'folder', string>
  determiners: string
  /** German and Dutch say the kind first, joined to the noun: "TypeScript-Datei". */
  joined?: true
}): Words['standIn'] {
  return (noun, kind, before) => {
    const word = o[noun]
    if (new RegExp(`(?<!\\p{L})${word}\\p{L}{0,2}\\s+$`, 'iu').test(before)) return kind
    if (/['’]$/.test(before)) return undefined
    const named = kind === '' ? word : o.joined ? `${kind}-${word}` : `${word} ${kind}`
    return new RegExp(`(?<!\\p{L})(?:${o.determiners})\\s+$`, 'iu').test(before) ? named : `${o.the[noun]} ${named}`
  }
}

const ENGLISH: Words = {
  date: (day, number, year) => {
    const name = month('January February March April May June July August September October November December', number)
    return name === undefined ? undefined : `${name} ${day}, ${year}`
  },
  line: 'line',
  lines: 'lines',
  to: 'to',
  dot: 'dot',
  number: 'number',
  by: 'by',
  times: 'times',
  units: {
    ...units({
      ms: 'millisecond', s: 'second', sec: 'second', min: 'minute', h: 'hour', hr: 'hour',
      KB: 'kilobyte', kB: 'kilobyte', MB: 'megabyte', GB: 'gigabyte', TB: 'terabyte',
      Hz: 'hertz', kHz: 'kilohertz', MHz: 'megahertz', GHz: 'gigahertz', px: 'pixel',
      km: 'kilometer',
    }),
    'km/h': ['kilometer per hour', 'kilometers per hour'], 'm/s': ['meter per second', 'meters per second'],
  },
  dollar: ['dollar', 'dollars'],
  isPlural: count => count !== '1',
  hasDecades: true,
  short: [
    [/\be\.g\.,?/gi, 'for example'],
    [/\bi\.e\.,?/gi, 'that is'],
    [/\bw\.r\.t\.?/gi, 'with respect to'],
    [VERSUS, 'versus'],
    [/\bapprox\.(?=\s)/gi, 'approximately'],
    [/\bet al\./gi, 'and colleagues'],
    [/\bcf\.(?=\s)/gi, 'compare'],
  ],
  arrow: 'to',
  and: 'and',
  about: 'about',
  // "eh" is read as the letter.
  letterA: 'eh',
  kinds: {},
  // "the TypeScript file", "the folder"; without a second "the" when one comes before it, or a
  // second "file" when one comes after.
  standIn: (noun, kind, before, after) => {
    const hasDeterminer = /\b(?:the|a|an|this|that|these|those|its|your|my|our|their|his|her)\s+$/i.test(before)
    const hasNoun = new RegExp(`^\\s+${noun}s?\\b`, 'i').test(after)
    return [hasDeterminer ? '' : 'the', kind, hasNoun ? '' : noun].filter(word => word !== '').join(' ')
  },
}

const FRENCH: Words = {
  date: (day, number, year) => {
    const name = month('janvier février mars avril mai juin juillet août septembre octobre novembre décembre', number)
    return name === undefined ? undefined : `${day === 1 ? '1er' : day} ${name} ${year}`
  },
  line: 'ligne',
  lines: 'lignes',
  to: 'à',
  dot: 'point',
  number: 'numéro',
  by: 'par',
  times: 'fois',
  // French also writes bytes as octets: Ko, Mo, Go, To.
  units: {
    ...units({
      ms: 'milliseconde', s: 'seconde', sec: 'seconde', min: 'minute', h: 'heure', hr: 'heure',
      KB: 'kilo-octet', kB: 'kilo-octet', Ko: 'kilo-octet', MB: 'méga-octet', Mo: 'méga-octet',
      GB: 'giga-octet', Go: 'giga-octet', TB: 'téra-octet', To: 'téra-octet',
      Hz: 'hertz', kHz: 'kilohertz', MHz: 'mégahertz', GHz: 'gigahertz', px: 'pixel',
      km: 'kilomètre',
    }, ['hertz', 'kilohertz', 'mégahertz', 'gigahertz']),
    'km/h': ['kilomètre par heure', 'kilomètres par heure'], 'm/s': ['mètre par seconde', 'mètres par seconde'],
  },
  dollar: ['dollar', 'dollars'],
  isPlural: count => Number(count) >= 2,
  hasDecades: false,
  short: [
    [/\be\.g\.,?/gi, 'par exemple'],
    [/\bp\.\s?ex\.,?/gi, 'par exemple'],
    [/\bi\.e\.,?/gi, "c'est-à-dire"],
    [/\bc\.?-?à\.?-?d\.?(?!\p{L})/giu, "c'est-à-dire"],
    [VERSUS, 'contre'],
    [/\bet al\./gi, 'et collègues'],
    [/\bcf\.(?=\s)/gi, 'voir'],
    [/\benv\.(?=\s)/gi, 'environ'],
  ],
  arrow: 'vers',
  and: 'et',
  about: 'environ',
  kinds: { txt: 'texte', mp4: 'vidéo', onnx: 'modèle' },
  standIn: standInOf({
    file: 'fichier',
    folder: 'dossier',
    the: { file: 'le', folder: 'le' },
    determiners: 'le|la|les|un|une|ce|cet|cette|ces|du|des|au|aux|mon|ton|son|notre|votre|leur|chaque',
  }),
}

const SPANISH: Words = {
  date: (day, number, year) => {
    const name = month('enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre', number)
    return name === undefined ? undefined : `${day} de ${name} de ${year}`
  },
  line: 'línea',
  lines: 'líneas',
  to: 'a',
  dot: 'punto',
  number: 'número',
  by: 'por',
  times: 'veces',
  units: {
    ...units({
      ms: 'milisegundo', s: 'segundo', sec: 'segundo', min: 'minuto', h: 'hora', hr: 'hora',
      KB: 'kilobyte', kB: 'kilobyte', MB: 'megabyte', GB: 'gigabyte', TB: 'terabyte',
      Hz: 'hercio', kHz: 'kilohercio', MHz: 'megahercio', GHz: 'gigahercio',
    }),
    px: ['píxel', 'píxeles'],
    km: ['kilómetro', 'kilómetros'], 'km/h': ['kilómetro por hora', 'kilómetros por hora'], 'm/s': ['metro por segundo', 'metros por segundo'],
  },
  dollar: ['dólar', 'dólares'],
  isPlural: count => count !== '1',
  hasDecades: false,
  short: [
    [/\be\.g\.,?/gi, 'por ejemplo'],
    [/\bp\.\s?ej\.,?/gi, 'por ejemplo'],
    [/\bi\.e\.,?/gi, 'es decir'],
    [VERSUS, 'contra'],
    [/\baprox\.(?=\s)/gi, 'aproximadamente'],
    [/\bet al\./gi, 'y colegas'],
    [/\bcf\.(?=\s)/gi, 'véase'],
  ],
  arrow: 'hacia',
  and: 'y',
  about: 'aproximadamente',
  kinds: { txt: 'de texto', png: 'de imagen', jpg: 'de imagen', jpeg: 'de imagen', gif: 'de imagen', webp: 'de imagen', wav: 'de audio', mp3: 'de audio', mp4: 'de vídeo', onnx: 'de modelo', log: 'de registro' },
  standIn: standInOf({
    file: 'archivo',
    folder: 'carpeta',
    the: { file: 'el', folder: 'la' },
    determiners: 'el|la|los|las|un|una|este|esta|ese|esa|del|al|su|mi|tu|nuestro|nuestra|cada',
  }),
}

const ITALIAN: Words = {
  date: (day, number, year) => {
    const name = month('gennaio febbraio marzo aprile maggio giugno luglio agosto settembre ottobre novembre dicembre', number)
    return name === undefined ? undefined : `${day === 1 ? 'primo' : day} ${name} ${year}`
  },
  line: 'riga',
  lines: 'righe',
  to: 'a',
  dot: 'punto',
  number: 'numero',
  by: 'per',
  times: 'volte',
  units: {
    ms: ['millisecondo', 'millisecondi'], s: ['secondo', 'secondi'], sec: ['secondo', 'secondi'], min: ['minuto', 'minuti'],
    h: ['ora', 'ore'], hr: ['ora', 'ore'],
    KB: ['kilobyte', 'kilobyte'], kB: ['kilobyte', 'kilobyte'], MB: ['megabyte', 'megabyte'], GB: ['gigabyte', 'gigabyte'], TB: ['terabyte', 'terabyte'],
    Hz: ['hertz', 'hertz'], kHz: ['kilohertz', 'kilohertz'], MHz: ['megahertz', 'megahertz'], GHz: ['gigahertz', 'gigahertz'], px: ['pixel', 'pixel'],
    km: ['chilometro', 'chilometri'], 'km/h': ['chilometro orario', 'chilometri orari'], 'm/s': ['metro al secondo', 'metri al secondo'],
  },
  dollar: ['dollaro', 'dollari'],
  isPlural: count => count !== '1',
  hasDecades: false,
  short: [
    [/\be\.g\.,?/gi, 'per esempio'],
    [/\b(?:ad|p\.|per)\s?es\.,?/gi, 'per esempio'],
    [/\bi\.e\.,?/gi, 'cioè'],
    [/\becc\./gi, 'eccetera'],
    [VERSUS, 'contro'],
    [/\bca\.(?=\s)/gi, 'circa'],
    [/\bet al\./gi, 'e colleghi'],
    [/\bcf\.(?=\s)/gi, 'vedi'],
  ],
  arrow: 'verso',
  and: 'e',
  about: 'circa',
  kinds: { txt: 'di testo', png: 'immagine', jpg: 'immagine', jpeg: 'immagine', gif: 'immagine', webp: 'immagine', onnx: 'del modello', log: 'di log' },
  standIn: standInOf({
    file: 'file',
    folder: 'cartella',
    the: { file: 'il', folder: 'la' },
    determiners: 'il|lo|la|i|gli|le|un|uno|una|questo|questa|quel|quella|nel|nella|del|della|al|alla|dal|dalla|sul|sulla|mio|tuo|suo|ogni',
  }),
}

const PORTUGUESE: Words = {
  date: (day, number, year) => {
    const name = month('janeiro fevereiro março abril maio junho julho agosto setembro outubro novembro dezembro', number)
    return name === undefined ? undefined : `${day === 1 ? 'primeiro' : day} de ${name} de ${year}`
  },
  line: 'linha',
  lines: 'linhas',
  to: 'a',
  dot: 'ponto',
  number: 'número',
  by: 'por',
  times: 'vezes',
  units: {
    ...units({
      ms: 'milissegundo', s: 'segundo', sec: 'segundo', min: 'minuto', h: 'hora', hr: 'hora',
      KB: 'kilobyte', kB: 'kilobyte', MB: 'megabyte', GB: 'gigabyte', TB: 'terabyte',
      Hz: 'hertz', kHz: 'kilohertz', MHz: 'megahertz', GHz: 'gigahertz', px: 'pixel',
      km: 'quilômetro',
    }),
    'km/h': ['quilômetro por hora', 'quilômetros por hora'], 'm/s': ['metro por segundo', 'metros por segundo'],
  },
  dollar: ['dólar', 'dólares'],
  isPlural: count => count !== '1',
  hasDecades: false,
  short: [
    [/\be\.g\.,?/gi, 'por exemplo'],
    [/\bp\.\s?ex\.,?/gi, 'por exemplo'],
    [/\bi\.e\.,?/gi, 'isto é'],
    [VERSUS, 'contra'],
    [/\baprox\.(?=\s)/gi, 'aproximadamente'],
    [/\bet al\./gi, 'e colegas'],
    [/\bcf\.(?=\s)/gi, 'veja'],
  ],
  arrow: 'para',
  and: 'e',
  about: 'cerca de',
  kinds: { txt: 'de texto', png: 'de imagem', jpg: 'de imagem', jpeg: 'de imagem', gif: 'de imagem', webp: 'de imagem', wav: 'de áudio', mp3: 'de áudio', mp4: 'de vídeo', onnx: 'de modelo', log: 'de log' },
  standIn: standInOf({
    file: 'arquivo',
    folder: 'pasta',
    the: { file: 'o', folder: 'a' },
    determiners: 'o|a|os|as|um|uma|este|esta|esse|essa|no|na|do|da|ao|à|pelo|pela|neste|nesta|deste|desta|seu|sua|meu|minha|cada',
  }),
}

const GERMAN_MONTHS = 'Januar Februar März April Mai Juni Juli August September Oktober November Dezember'
const GERMAN_ONES = ['', 'ein', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun']

/**
 * A day of the month as German says it, "15." as "fünfzehnter": the voice reads the figure and
 * its dot as "fünfzehn", then stops. With the ending the words `before` it ask for: "am
 * fünfzehnten", "der fünfzehnte", "fünfzehnter November".
 */
function germanDay(day: number, before: string): string {
  const early = ['', 'erst', 'zweit', 'dritt', 'viert', 'fünft', 'sechst', 'siebt', 'acht', 'neunt', 'zehnt', 'elft', 'zwölft']
  const teen = day === 16 ? 'sech' : day === 17 ? 'sieb' : GERMAN_ONES[day - 10]
  const stem =
    day <= 12
      ? early[day]
      : day < 20
        ? `${teen}zehnt`
        : `${day % 10 === 0 ? '' : `${GERMAN_ONES[day % 10]}und`}${day < 30 ? 'zwanzig' : 'dreißig'}st`
  const ending = /(?:^|\s)(?:am|vom|zum|dem|den|beim)\s+$/i.test(before) ? 'en' : /(?:^|\s)(?:der|die|das)\s+$/i.test(before) ? 'e' : 'er'
  return `${stem}${ending}`
}

const GERMAN: Words = {
  date: (day, number, year, before) => {
    const name = month(GERMAN_MONTHS, number)
    return name === undefined ? undefined : `${germanDay(day, before)} ${name} ${year}`
  },
  line: 'Zeile',
  lines: 'Zeilen',
  to: 'bis',
  dot: 'Punkt',
  number: 'Nummer',
  by: 'mal',
  times: 'mal',
  units: {
    ms: ['Millisekunde', 'Millisekunden'], s: ['Sekunde', 'Sekunden'], sec: ['Sekunde', 'Sekunden'], min: ['Minute', 'Minuten'],
    h: ['Stunde', 'Stunden'], hr: ['Stunde', 'Stunden'],
    KB: ['Kilobyte', 'Kilobyte'], kB: ['Kilobyte', 'Kilobyte'], MB: ['Megabyte', 'Megabyte'], GB: ['Gigabyte', 'Gigabyte'], TB: ['Terabyte', 'Terabyte'],
    Hz: ['Hertz', 'Hertz'], kHz: ['Kilohertz', 'Kilohertz'], MHz: ['Megahertz', 'Megahertz'], GHz: ['Gigahertz', 'Gigahertz'], px: ['Pixel', 'Pixel'],
    km: ['Kilometer', 'Kilometer'], 'km/h': ['Kilometer pro Stunde', 'Kilometer pro Stunde'], 'm/s': ['Meter pro Sekunde', 'Meter pro Sekunde'],
  },
  dollar: ['Dollar', 'Dollar'],
  isPlural: count => count !== '1',
  hasDecades: false,
  short: [
    // A date as German writes it, "15. November": its day said as it is, not as a figure and a stop.
    [new RegExp(`(?<![\\d.])(\\d{1,2})\\.(?=\\s+(?:${GERMAN_MONTHS.replace(/ /g, '|')})(?!\\p{L}))`, 'gu'), (_, day: string, at: number, text: string) => germanDay(Number(day), text.slice(0, at))],
    [/\bz\.\s?B\.,?/g, 'zum Beispiel'],
    [/\be\.g\.,?/gi, 'zum Beispiel'],
    [/\bd\.\s?h\.,?/g, 'das heißt'],
    [/\bi\.e\.,?/gi, 'das heißt'],
    [/\bbzw\./g, 'beziehungsweise'],
    [/\busw\./g, 'und so weiter'],
    [/\bggf\./g, 'gegebenenfalls'],
    [/\bu\.\s?a\.(?=\s)/g, 'unter anderem'],
    [/\bca\.(?=\s)/gi, 'circa'],
    [VERSUS, 'gegen'],
    [/\bvgl\.(?=\s)/gi, 'vergleiche'],
  ],
  arrow: 'nach',
  and: 'und',
  about: 'etwa',
  kinds: { txt: 'Text', png: 'Bild', jpg: 'Bild', jpeg: 'Bild', gif: 'Bild', webp: 'Bild', wav: 'Audio', mp3: 'Audio', mp4: 'Video', onnx: 'Modell', log: 'Log', sh: 'Shell', bash: 'Shell', zsh: 'Shell' },
  standIn: standInOf({
    file: 'Datei',
    folder: 'Ordner',
    the: { file: 'die', folder: 'der' },
    determiners: 'der|die|das|den|dem|des|ein|eine|einen|einem|einer|im|vom|zum|zur|beim|ins|diese|dieser|diesem|diesen|dieses|jede|jeder',
    joined: true,
  }),
}

const DUTCH: Words = {
  date: (day, number, year) => {
    const name = month('januari februari maart april mei juni juli augustus september oktober november december', number)
    return name === undefined ? undefined : `${day} ${name} ${year}`
  },
  line: 'regel',
  lines: 'regels',
  to: 'tot',
  dot: 'punt',
  number: 'nummer',
  by: 'bij',
  times: 'keer',
  units: {
    ms: ['milliseconde', 'milliseconden'], s: ['seconde', 'seconden'], sec: ['seconde', 'seconden'], min: ['minuut', 'minuten'],
    h: ['uur', 'uur'], hr: ['uur', 'uur'],
    KB: ['kilobyte', 'kilobyte'], kB: ['kilobyte', 'kilobyte'], MB: ['megabyte', 'megabyte'], GB: ['gigabyte', 'gigabyte'], TB: ['terabyte', 'terabyte'],
    Hz: ['hertz', 'hertz'], kHz: ['kilohertz', 'kilohertz'], MHz: ['megahertz', 'megahertz'], GHz: ['gigahertz', 'gigahertz'], px: ['pixel', 'pixels'],
    km: ['kilometer', 'kilometer'], 'km/h': ['kilometer per uur', 'kilometer per uur'], 'm/s': ['meter per seconde', 'meter per seconde'],
  },
  dollar: ['dollar', 'dollar'],
  isPlural: count => count !== '1',
  hasDecades: false,
  short: [
    [/\b(?:bijv|bv)\.,?/gi, 'bijvoorbeeld'],
    [/\be\.g\.,?/gi, 'bijvoorbeeld'],
    [/\bd\.w\.z\.,?/gi, 'dat wil zeggen'],
    [/\bi\.e\.,?/gi, 'dat wil zeggen'],
    [/\benz\./gi, 'enzovoort'],
    [/\bo\.a\.(?=\s)/gi, 'onder andere'],
    [/\bca\.(?=\s)/gi, 'circa'],
    [VERSUS, 'tegen'],
  ],
  arrow: 'naar',
  and: 'en',
  about: 'ongeveer',
  kinds: { txt: 'tekst', png: 'afbeeldings', jpg: 'afbeeldings', jpeg: 'afbeeldings', gif: 'afbeeldings', webp: 'afbeeldings', onnx: 'model' },
  standIn: standInOf({
    file: 'bestand',
    folder: 'map',
    the: { file: 'het', folder: 'de' },
    determiners: 'de|het|een|dit|dat|deze|die|mijn|je|jouw|zijn|haar|ons|onze|hun|elk|elke',
    joined: true,
  }),
}

const { letterA: _english, ...PLAIN } = ENGLISH
const HINDI: Words = { ...PLAIN, hasDecades: false }

export const WORDS: Record<Spoken, Words> = {
  en: ENGLISH,
  fr: FRENCH,
  es: SPANISH,
  it: ITALIAN,
  pt: PORTUGUESE,
  // Hindi says these marks in English words, as its speakers do when they talk about code:
  // "reader dot ts, line 42". Without the "eh" that stands for a letter a in an English sentence.
  hi: HINDI,
  de: GERMAN,
  nl: DUTCH,
}

/** The months German writes after a day's figure and dot, "15. November": that dot ends no sentence. */
export const MONTH_AFTER_DAY = new RegExp(`^(?:${GERMAN_MONTHS.replace(/ /g, '|')})(?!\\p{L})`, 'u')
