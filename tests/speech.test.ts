import { expect, test } from 'claude-code/testing'

import { parse } from '../hooks/text'
import { say, sayable, sayCode, sayMath } from '../hooks/speech'

const said = (markdown: string) => parse(markdown).sentences.map(s => s.speech)

test('paths are read as their file name, and file names with "dot"', () => {
  expect(said('Open `hooks/reader.ts` and setup.sh, not `.gitignore`.')).toEqual(['Open reader dot ts and setup dot sh, not dot gitignore.'])
  expect(sayable('Look in ~/.local/share/readalong today.')).toBe('Look in readalong today.')
  expect(sayable('It needs read/write access and/or both, 50/50.')).toBe('It needs read write access and or both, 50/50.')
})

test('a name too long to say becomes what a person would say: the file, the folder', () => {
  expect(said('Open `2026-11-12-session-export-final.json` now.')).toEqual(['Open the JSON file now.'])
  expect(sayable('I edited the read-button-player-controls.tsx file and text.ts.')).toBe('I edited the TypeScript file and text dot ts.')
  expect(sayable('It is in ~/.vscode/extensions/anthropic.claude-code-2.1.322-linux-x64/ today.')).toBe('It is in the folder today.')
  expect(sayable('Keep read-button.test.tsx as is.')).toBe('Keep read-button dot test dot tsx as is.')
  expect(sayable('Session 9db4eb03-5c5e-4f8f-93bb-04381d594df2 ended.')).toBe('Session ended.')
})

test('a file reference says its line', () => {
  expect(sayable('See reader.ts:307 for the wait.')).toBe('See reader dot ts, line 307 for the wait.')
  expect(sayable('Edit register.tsx:70-80 next.')).toBe('Edit register dot tsx, lines 70 to 80 next.')
})

test('numbers: ranges, dates, units, speed-ups, money, powers of ten', () => {
  expect(sayable('Use 2-3 minutes, about 10–20 ms.')).toBe('Use 2 to 3 minutes, about 10 to 20 milliseconds.')
  expect(sayable('The date is 2026-11-12.')).toBe('The date is November 12, 2026.')
  expect(sayable('It takes 1 s and 830 MB.')).toBe('It takes 1 second and 830 megabytes.')
  expect(sayable('From 0.5x to 2x on a 1920x1080 screen.')).toBe('From 0.5 times to 2 times on a 1920 by 1080 screen.')
  expect(sayable('It costs $5, or $1.')).toBe('It costs 5 dollars, or 1 dollar.')
  expect(sayable('The rate is 1e-4.')).toBe('The rate is 1 times 10 to the minus 4.')
})

test('a capital A after the first word is the letter, not the article', () => {
  expect(said('Let A be the matrix. Pick option A. A new file was added.')).toEqual([
    'Let eh be the matrix.',
    'Pick option eh.',
    'A new file was added.',
  ])
})

test('abbreviations, complexity, issue numbers and commit hashes', () => {
  expect(sayable('Compare A vs. B, w.r.t. speed.')).toBe('Compare eh versus B, with respect to speed.')
  expect(sayable('It runs in O(n log n), not O(n^2).')).toBe('It runs in big O of n log n, not big O of n squared.')
  expect(sayable('See issue #42; commit 637ce7e is pushed.')).toBe('See issue number 42; commit is pushed.')
})

test('an aside in parentheses is said between commas', () => {
  expect(sayable('The voice (Kokoro) runs locally.')).toBe('The voice, Kokoro, runs locally.')
  expect(sayable('It is local (see below).')).toBe('It is local, see below.')
})

test('code spans: operators as words, calls by name, a variable a as the letter', () => {
  expect(sayCode('a == b')).toBe('eh equals b')
  expect(sayCode('a != b && c || d')).toBe('eh is not b and c or d')
  expect(sayCode('warmUp()')).toBe('warmUp')
  expect(sayCode('x -> y')).toBe('x to y')
  expect(sayCode('claude plugin test .')).toBe('claude plugin test dot')
  expect(sayable('In the 1990s it took 10s.')).toBe('In the 1990s it took 10s.')
})

test('inline maths is read as a lecturer would', () => {
  expect(said('Then $x^2 + 1$ appears.')).toEqual(['Then x squared plus 1 appears.'])
  expect(sayMath('\\frac{1}{n}\\sum_{i=1}^{n} x_i \\le \\alpha')).toBe('1 over n the sum from i equals 1 to n of x i is at most alpha')
  expect(sayMath('\\sqrt{a+b}')).toBe('the square root of eh plus b')
  expect(sayMath('f(x) = e^{-x}')).toBe('f of x equals e to the minus x')
  expect(sayable('It costs $5 and $10 today.')).toBe('It costs 5 dollars and 10 dollars today.')
})

test('in a French sentence, the marks are said in French words', () => {
  const fr = (text: string) => sayable(text, 'fr')
  expect(fr('Voir reader.ts:42 et register.tsx:70-80 dans hooks/reader.ts.')).toBe('Voir reader point ts, ligne 42 et register point tsx, lignes 70 à 80 dans reader point ts.')
  expect(fr("J'ai modifié le read-button-player-controls.tsx et le fichier session-export-final-v3.json.")).toBe("J'ai modifié le fichier TypeScript et le fichier JSON.")
  expect(fr("C'est dans ~/.vscode/extensions/anthropic.claude-code-2.1.322-linux-x64/ aujourd'hui.")).toBe("C'est dans le dossier aujourd'hui.")
  expect(fr('Le 2026-11-15, il faut 2-3 minutes, environ 10–20 ms et 830 MB.')).toBe('Le 15 novembre 2026, il faut 2 à 3 minutes, environ 10 à 20 millisecondes et 830 méga-octets.')
  expect(fr('Le 2025-03-01, 1 s et 1,5 Go.')).toBe('Le 1er mars 2025, 1 seconde et 1,5 giga-octets.')
  expect(fr('De 0.5x à 2x sur un écran 1920x1080, soit ~3 s (voir ci-dessous).')).toBe('De 0.5 fois à 2 fois sur un écran 1920 par 1080, soit environ 3 secondes, voir ci-dessous.')
  // An equation is English in every sentence: "big O of n squared".
  expect(fr('Comparer A vs. B, p. ex. en O(n^2), c.-à-d. lent ; ticket #42, cf. le README.')).toBe("Comparer A contre B, par exemple en big O of n squared, c'est-à-dire lent; ticket numéro 42, voir le README.")
  expect(fr('Le taux est 1e-4, et A → B & C.')).toBe('Le taux est 1 times 10 to the minus 4, et A vers B et C.')
  // French writes no decades as "the 1990s": 10s is ten seconds.
  expect(fr('Cela a pris 10s.')).toBe('Cela a pris 10 secondes.')
})

test('equations are said in English in every sentence, and the sentence says which words they are', () => {
  expect(say('Si $x^2 + y^2 = r^2$, alors c\'est un cercle.', 'fr')).toEqual({
    speech: "Si x squared plus y squared equals r squared, alors c'est un cercle.",
    english: [[1, 9]],
  })
  expect(say('Le coût est en O(n^2) et 1e-4 par appel.', 'fr')).toEqual({
    speech: 'Le coût est en big O of n squared et 1 times 10 to the minus 4 par appel.',
    english: [[4, 9], [10, 17]],
  })
  // In an English sentence nothing is held aside: all of it is English.
  expect(say('If $x^2 = 4$, then x is 2.')).toEqual({ speech: 'If x squared equals 4, then x is 2.', english: [] })
  expect(sayMath('\\frac{a}{b}')).toBe('eh over b')
})

test('in a Spanish, Italian, Portuguese, German or Dutch sentence, the marks are said in its words', () => {
  expect(sayable('Mira reader.ts:42 y el 2026-11-15, unos 830 MB en 2-3 s.', 'es')).toBe('Mira reader punto ts, línea 42 y el 15 de noviembre de 2026, unos 830 megabytes en 2 a 3 segundos.')
  expect(sayable('Vedi reader.ts:42 e il 2026-11-01, circa 1 s, p.es. 10 px.', 'it')).toBe('Vedi reader punto ts, riga 42 e il primo novembre 2026, circa 1 secondo, per esempio 10 pixel.')
  expect(sayable('Veja reader.ts:42 em 2026-11-15, uns $5.', 'pt')).toBe('Veja reader ponto ts, linha 42 em 15 de novembro de 2026, uns 5 dólares.')
  expect(sayable('Siehe reader.ts:42-48, z.B. am 2026-11-15, 1920x1080 und 3 s.', 'de')).toBe('Siehe reader Punkt ts, Zeilen 42 bis 48, zum Beispiel am fünfzehnten November 2026, 1920 mal 1080 und 3 Sekunden.')
  // German writes a date "15. November": its day said as German says it, after "am" or not.
  expect(sayable('Am 15. November und am 1. März.', 'de')).toBe('Am fünfzehnten November und am ersten März.')
  expect(sayable('Zie reader.ts:42, bijv. 10 ms of 2 uur.', 'nl')).toBe('Zie reader punt ts, regel 42, bijvoorbeeld 10 milliseconden of 2 uur.')
  // A name too long to say: the file of its kind, in the sentence's words.
  expect(sayable('Ich habe read-button-player-controls.tsx geändert.', 'de')).toBe('Ich habe die TypeScript-Datei geändert.')
  expect(sayable('He cambiado el read-button-player-controls.tsx hoy.', 'es')).toBe('He cambiado el archivo TypeScript hoy.')
})

test('code is said in English words, whatever the sentence', () => {
  expect(sayCode('a != b && c || d')).toBe('eh is not b and c or d')
  expect(sayCode('claude plugin test .')).toBe('claude plugin test dot')
})

test('an equation written without $ is read as maths, in English, and its unit in the sentence language', () => {
  expect(sayable('Then v = d / t = 120 / 2 = 60 km/h.')).toBe('Then v equals d over t equals 120 over 2 equals 60 kilometers per hour.')
  expect(sayable('If x > 0 and y >= 2, then x + y > 2.')).toBe('If x is greater than 0 and y is at least 2, then x plus y is greater than 2.')
  expect(say('Alors v = 120 / 4 = 30 km/h.', 'fr')).toEqual({ speech: 'Alors v equals 120 over 4 equals 30 kilomètres par heure.', english: [[1, 7]] })
  // Without an equals sign or a comparison, it is not one: a range, a date, a ratio.
  expect(sayable('It takes 2-3 days, from 2026-11-15, at 120/2 or so.')).toBe('It takes 2 to 3 days, from November 15, 2026, at 120/2 or so.')
})

test('marks between words that are not maths are left as they are', () => {
  // Menus, arrows, types, code names and a slash between numbers.
  expect(sayable('Open Settings > Privacy > Microphone.')).toBe('Open Settings > Privacy > Microphone.')
  expect(sayable('It returns Array<string> here.')).toBe('It returns Array<string> here.')
  expect(sayable('Set n_items = 5 first.')).toBe('Set n_items = 5 first.')
  expect(sayable('Two words - like this - are an aside.')).toBe('Two words - like this - are an aside.')
  // A longer name may be a requirement or code: left as written. Names of one letter are maths.
  expect(sayable('It needs Python >= 3.12 to run.')).toBe('It needs Python >= 3.12 to run.')
  expect(sayable('Check that count != 0 first.')).toBe('Check that count != 0 first.')
  expect(sayable('So a^2 + b^2 = c^2, always.')).toBe('So eh squared plus b squared equals c squared, always.')
  expect(sayable('Here x1 = 2 * x0 - 1.')).toBe('Here x1 equals 2 times x0 minus 1.')
})
