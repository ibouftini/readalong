import { expect, test } from 'claude-code/testing'

import { inline, markOf, parse, piecesOf, sayable, splitNested, splitSentences, terminalMarker, wordsOf } from '../hooks/text'

const said = (markdown: string) => parse(markdown).sentences.map(s => s.speech)

test('a paragraph is read sentence by sentence', () => {
  expect(said('It works. Does it? Yes! Fine…\nAnother line here.')).toEqual([
    'It works.',
    'Does it?',
    'Yes!',
    'Fine…',
    'Another line here.',
  ])
})

test('abbreviations, decimals, file names and lowercase do not end a sentence', () => {
  expect(said('See e.g. Python 3.12 in register.tsx. Dr. Smith said no. it goes on.')).toEqual([
    'See for example Python 3.12 in register dot tsx.',
    'Dr. Smith said no. it goes on.',
  ])
})

test('code blocks, tables, rules and display maths are drawn but never read', () => {
  const reading = parse(['Before.', '', '```ts', 'const x = 1. Not read.', '```', '', '| a | b |', '|---|---|', '| 1 | 2 |', '', '---', '', '$$', 'x = 1', '$$', '', 'After.'].join('\n'))
  expect(reading.sentences.map(s => s.speech)).toEqual(['Before.', 'After.'])
  expect(reading.blocks.map(b => b.kind)).toEqual(['text', 'silent', 'silent', 'silent', 'silent', 'text'])
})

test('headings, list items and quotes are blocks of their own, with their markers', () => {
  const reading = parse('## Title\n\n- one\n- two **bold**\n  3. nested\n- [x] done\n\n> quoted')
  expect(reading.blocks.map(b => [b.marker, b.indent, b.isHeading, b.isQuote])).toEqual([
    ['', 0, true, false],
    ['• ', 0, false, false],
    ['• ', 0, false, false],
    ['3. ', 2, false, false],
    ['• ☑ ', 0, false, false],
    ['', 0, false, true],
  ])
  expect(reading.sentences.map(s => s.speech)).toEqual(['Title', 'one', 'two bold', 'nested', 'done', 'quoted'])
})

test('inline marks become styles; link texts are read, URLs and images are not', () => {
  const runs = inline('A **bold** `code` [link](https://x.org) https://y.org ![alt](i.png) snake_case end')
  expect(runs.map(r => [r.text, Object.keys(r.style).join(','), r.isSilent === true])).toEqual([
    ['A ', '', false],
    ['bold', 'isBold', false],
    [' ', '', false],
    ['code', 'isCode', false],
    [' ', '', false],
    ['link', 'isLink', false],
    [' ', '', false],
    ['https://y.org', 'isLink', true],
    [' ', '', false],
    ['alt', '', true],
    [' snake_case end', '', false],
  ])
  expect(said('Read [the guide](https://x.org) at https://y.org now.')).toEqual(['Read the guide at now.'])
})

test('a long sentence is cut at the clause nearest its middle', () => {
  const long =
    'This sentence is long enough to be split because it keeps going for quite a while, and then it goes on further still with more and more words until it is too long to wait for.'
  const parts = splitSentences(long).map(([a, b]) => long.slice(a, b))
  expect(parts).toEqual([
    'This sentence is long enough to be split because it keeps going for quite a while,',
    'and then it goes on further still with more and more words until it is too long to wait for.',
  ])
})

test('text is made easier to say', () => {
  expect(sayable('A → B & C, ~3 s, 2× faster 🎉')).toBe('A to B and C, about 3 seconds, 2 times faster')
})

test('a sentence is lit across the runs it spans, and nothing else', () => {
  const reading = parse('One **two. Three** four.')
  const [, second] = reading.sentences
  const block = reading.blocks[0]
  if (second === undefined || block === undefined) throw new Error('no second sentence')
  expect(piecesOf(block, second.start, second.end).map(p => [p.text, p.isLit])).toEqual([
    ['One ', false],
    ['two. ', false],
    ['Three', true],
    [' four.', true],
  ])
  // What comes before the lit sentence has been read; what comes after it is ahead.
  const [first] = reading.sentences
  if (first === undefined) throw new Error('no first sentence')
  expect(piecesOf(block, first.start, first.end).map(p => [p.text, p.isLit, p.isAhead])).toEqual([
    ['One ', true, false],
    ['two.', true, false],
    [' Three', false, true],
    [' four.', false, true],
  ])
})

test('the mark tells two texts apart and stays the same for one text', () => {
  expect(markOf('Hello there.')).toBe(markOf('Hello there.'))
  expect(markOf('Hello there.')).not.toBe(markOf('Hello here.'))
})

/** The shown word each spoken word of a sentence lights. */
function lights(markdown: string, index = 0): string[] {
  const reading = parse(markdown)
  const sentence = reading.sentences[index]!
  const block = reading.blocks[sentence.block]!
  const text = block.runs.map(r => r.text).join('')
  return wordsOf(block, sentence).map(([from, to]) => text.slice(from, to))
}

test('each spoken word lights the word it is shown as, without the marks around it', () => {
  expect(lights('It works, **really** well.')).toEqual(['It', 'works', 'really', 'well'])
  // Said "register dot tsx": the three words light the one file name.
  expect(lights('Open register.tsx, then read 42 lines (see e.g. [the docs](https://x.io/a)).')).toEqual([
    'Open', 'register.tsx', 'register.tsx', 'register.tsx', 'then', 'read', '42', 'lines', 'see', 'e.g', 'e.g', 'the', 'docs',
  ])
  // A URL is not read, so it is never lit.
  expect(lights('Read https://example.com/page now.')).toEqual(['Read', 'now'])
  expect(lights('Ranges like 1-3 work.')).toEqual(['Ranges', 'like', '1-3', '1-3', '1-3', 'work'])
  // The second sentence of a paragraph: offsets in the paragraph, not the sentence.
  expect(lights('One here. Two there.', 1)).toEqual(['Two', 'there'])
})

test('each sentence is read in its own language, the reply\'s to begin with', () => {
  const languages = (markdown: string, voice?: 'own') => parse(markdown, voice).sentences.map(s => `${s.language}: ${s.speech}`)
  const mixed = 'Here is the translation you asked for.\n\n> Bonjour à tous. Nous avons corrigé le problème et les tests passent.\n\n- Parfait.\n- Les fichiers sont prêts.\n\nLet me know if you want anything changed.'
  expect(languages(mixed)).toEqual([
    'en: Here is the translation you asked for.',
    'fr: Bonjour à tous.',
    'fr: Nous avons corrigé le problème et les tests passent.',
    // Too short to tell: the language before it.
    'fr: Parfait.',
    'fr: Les fichiers sont prêts.',
    'en: Let me know if you want anything changed.',
  ])
  // A French reply starts in French, short as its first sentence is.
  expect(languages("J'ai corrigé. Le lecteur attend maintenant la fin du clip avant de jouer le suivant, et les tests passent.")[0]).toBe("fr: J'ai corrigé.")
  // Code is said in English, and does not decide the language; a file's name is said in the sentence's.
  const coded = parse('Le test `a != b` passe maintenant dans `reader.ts:42` pour tous les cas.').sentences[0]
  expect(coded?.speech).toBe('Le test eh is not b passe maintenant dans reader point ts, ligne 42 pour tous les cas.')
  expect(coded?.english).toEqual([[2, 6]])
  // A speech server of the user's own: every sentence English, as it is.
  expect(languages(mixed, 'own').every(line => line.startsWith('en: '))).toBe(true)
})

test('a reply that changes between several languages is followed sentence by sentence', () => {
  const languages = (markdown: string) => parse(markdown).sentences.map(s => s.language)
  const reply = [
    'Here are the three translations you asked for.',
    '',
    '- French: Le fichier a été enregistré et les tests passent.',
    '- Spanish: El archivo se ha guardado y las pruebas pasan.',
    '- German: Die Datei wurde gespeichert und die Tests sind grün.',
    '- Italian: Il file è stato salvato e i test passano.',
    '',
    'Let me know if you need another language.',
  ].join('\n')
  // Each label is said in English, the words it names the language of in their own voice.
  expect(languages(reply)).toEqual(['en', 'en', 'fr', 'en', 'es', 'en', 'de', 'en', 'it', 'en'])
  // A sentence in Devanagari is Hindi, and English comes back after it.
  expect(languages('मैंने लूप बदल दिया है। The tests pass now.')).toEqual(['hi', 'en'])
  // Spanish and Portuguese, which share most short words: a level sentence keeps the one heard.
  expect(languages('Aquí está la versión que pediste para el proyecto. Todo está listo para continuar con la prueba.')).toEqual(['es', 'es'])
})

test('a script no voice reads is left out, and a sentence mostly in it is not read', () => {
  const said = (markdown: string) => parse(markdown).sentences.map(s => s.speech)
  expect(said('The word 日本 means Japan.')).toEqual(['The word means Japan.'])
  expect(said('ループを変更しました。 It works now.')).toEqual(['It works now.'])
  // German writes a date "15. November": its dot ends no sentence.
  expect(said('Wir haben das am 15. November behoben, und es läuft.')).toEqual(['Wir haben das am fünfzehnten November behoben, und es läuft.'])
  // Hindi ends a sentence with a danda.
  expect(said('यह ठीक है। यह भी ठीक है।')).toEqual(['यह ठीक है।', 'यह भी ठीक है।'])
})

test('a sentence that changes language at a comma is read in two parts, each in its own', () => {
  const units = (markdown: string) => parse(markdown).sentences.map(s => `${s.language}: ${s.speech}`)
  expect(units("My friend from Lyon leaned over and whispered, c'est plus facile que tu ne le crois. I laughed.")).toEqual([
    'en: My friend from Lyon leaned over and whispered,',
    "fr: c'est plus facile que tu ne le crois.",
    'en: I laughed.',
  ])
  // Short clauses go with the clause beside them: "Later, during lunch," with the English one.
  expect(units('Later, during lunch, our classmate joined us and added, la práctica hace al maestro, y nunca hay que rendirse.')).toEqual([
    'en: Later, during lunch, our classmate joined us and added,',
    'es: la práctica hace al maestro, y nunca hay que rendirse.',
  ])
  // Too few words to tell leave a sentence whole.
  expect(units('Entre nous, the vis-à-vis of the deus ex machina was a faux pas.')).toEqual(['en: Entre nous, the vis-à-vis of the deus ex machina was a faux pas.'])
})

test('words a sentence sets apart in another language are read in that language\'s voice', () => {
  const units = (markdown: string) => parse(markdown).sentences.map(s => `${s.language}: ${s.speech}`)
  // In quotation marks of any kind, parentheses, brackets, bold, italics.
  expect(units('The error says "le fichier est introuvable", which means the file was not found.')).toEqual([
    'en: The error says',
    'fr: "le fichier est introuvable"',
    'en: which means the file was not found.',
  ])
  expect(units('The placeholder reads „Bitte geben Sie Ihr Passwort ein“ on the login page.').map(u => u.slice(0, 2))).toEqual(['en', 'de', 'en'])
  expect(units('I kept the wording (el usuario no tiene permisos para ver esta página) as it was.').map(u => u.slice(0, 2))).toEqual(['en', 'es', 'en'])
  expect(units('The French message [Le mot de passe est incorrect, veuillez réessayer] is old.').map(u => u.slice(0, 2))).toEqual(['en', 'fr', 'en'])
  expect(units('The banner shows **No hay conexión a internet** when the probe fails.').map(u => u.slice(0, 2))).toEqual(['en', 'es', 'en'])
  expect(units("As the comment puts it, *C'est la vie, on ne peut rien y faire*, and the bug stayed.").map(u => u.slice(0, 2))).toEqual(['en', 'fr', 'en'])
  // A quotation alone in its sentence, a few words of comment after it.
  expect(units('1. "Je suis crevé." — familiar.')).toEqual(['fr: "Je suis crevé."', 'en: — familiar.'])
  // Two words set apart are a loanword or a name, said as the sentence is.
  expect(units('That felt like *déjà vu*, a real *tour de force*.')).toEqual(['en: That felt like déjà vu, a real tour de force.'])
  expect(units('He said "merci beaucoup" and left; she played "La Vie en rose".').map(u => u.slice(0, 2))).toEqual(['en'])
  expect(units('Click "Save all changes", then close the "Privacy and security" window.').map(u => u.slice(0, 2))).toEqual(['en'])
})

test('English set apart in a sentence of another language is said in its voice, by English rules', () => {
  const quoted = parse("L'erreur « Cannot read properties of undefined » vient de la ligne 42.").sentences
  expect(quoted.map(s => s.language)).toEqual(['fr'])
  expect(quoted[0]?.speech).toBe("L'erreur « Cannot read properties of undefined » vient de la ligne 42.")
  expect(quoted[0]?.english).toEqual([[2, 7]])
  const bold = parse('Cliquez sur **Save all changes**, puis fermez la fenêtre.').sentences
  expect(bold.map(s => [s.language, s.english])).toEqual([['fr', [[2, 5]]]])
})

test('a label naming a language says what the words after it are in', () => {
  const units = (markdown: string) => parse(markdown).sentences.map(s => `${s.language}: ${s.speech}`)
  expect(units('- **French:** Fichier introuvable\n- **Spanish:** Archivo no encontrado\n- `nl`: Bestand niet gevonden')).toEqual([
    'en: French:',
    'fr: Fichier introuvable',
    'en: Spanish:',
    'es: Archivo no encontrado',
    'en: nl:',
    'nl: Bestand niet gevonden',
  ])
  // A label in the reply's own language, before English.
  expect(units('Voici les traductions :\n\n- Anglais : File not found\n- Espagnol : Archivo no encontrado').map(u => u.slice(0, 2))).toEqual(['fr', 'fr', 'en', 'fr', 'es'])
  // A label that ends its sentence, or a heading, names the language of what comes after it.
  expect(units('### French\n\n- Fichier introuvable\n\n### German\n\n- Datei nicht gefunden\n\nBoth files are ready to commit.')).toEqual([
    'en: French',
    'fr: Fichier introuvable',
    'en: German',
    'de: Datei nicht gefunden',
    'en: Both files are ready to commit.',
  ])
  expect(units('Here is the Spanish version:\n\n> Tu pedido ha sido enviado.').map(u => u.slice(0, 2))).toEqual(['en', 'es'])
  // What reads as English after a label stays English: a status, not a translation.
  expect(units('- **French:** done\n- **German:** 12 strings missing').map(u => u.slice(0, 2))).toEqual(['en', 'en'])
  expect(units('French: the catalog is complete and all 240 strings are translated.').map(u => u.slice(0, 2))).toEqual(['en'])
})

test('the terminal marks list items as its Markdown does', () => {
  expect(terminalMarker('• ')).toBe('- ')
  expect(terminalMarker('• ☐ ')).toBe('- [ ] ')
  expect(terminalMarker('• ☑ ')).toBe('- [x] ')
  expect(terminalMarker('2. ')).toBe('2. ')
  expect(terminalMarker('3. ☐ ')).toBe('3. [ ] ')
  expect(terminalMarker('')).toBe('')
})

test('items nested under the one being read are cut off the rest, dedented, with their indent', () => {
  expect(splitNested('   - Heart\n     - Emma\n- [ ] Try it.\n\nDone.')).toEqual({
    nested: '- Heart\n  - Emma',
    indent: 3,
    rest: '- [ ] Try it.\n\nDone.',
    isGap: false,
  })
  // A blank line before the rest is kept, for the terminal's blank row.
  expect(splitNested('  - One\n\nAfter.')).toEqual({ nested: '- One', indent: 2, rest: 'After.', isGap: true })
  // Nested to the end of the reply: no rest.
  expect(splitNested('\t- Deep')).toEqual({ nested: '- Deep', indent: 4, rest: '', isGap: false })
  // Anything that does not open with a nested item is left whole: a paragraph, a top-level item,
  // a quote, a table, a paragraph indented a little.
  for (const after of ['Next paragraph.', '- Top item', '> Quote', '| a | b |', '  Indented text.']) {
    expect(splitNested(after)).toEqual({ nested: '', indent: 0, rest: after, isGap: false })
  }
})
