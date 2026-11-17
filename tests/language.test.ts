import { expect, test } from 'claude-code/testing'

import { clausesIn, labelIn, labelledIn, languageOf, spokenIn } from '../hooks/language'

test('an English reply is English, code, paths and a French quote in it or not', () => {
  expect(languageOf('The test passes now. I changed the loop in `hooks/reader.ts` so that it waits for the clip before it plays the next one.').code).toBe('en')
  expect(languageOf('The error says "le fichier est introuvable", which means the file was not found, so the path is wrong.').code).toBe('en')
  expect(languageOf('```python\nprint("bonjour le monde et la vie")\n```\nThat prints a greeting.').code).toBe('en')
  // Too short to tell: read, as before.
  expect(languageOf('Oui, merci.').code).toBe('en')
})

test('a reply in French, Spanish or German is told apart from English', () => {
  expect(languageOf("J'ai modifié la boucle pour qu'elle attende le clip avant de jouer le suivant. Les tests passent et le lecteur est plus stable avec cette version.").name).toBe('French')
  expect(languageOf('He cambiado el bucle para que espere el clip antes de reproducir el siguiente. Las pruebas pasan y el lector es más estable con esta versión.').name).toBe('Spanish')
  expect(languageOf('Ich habe die Schleife geändert, damit sie auf den Clip wartet. Die Tests sind jetzt grün und der Player ist mit dieser Version auch stabiler.').name).toBe('German')
})

test('a reply in another script is told by its letters', () => {
  expect(languageOf('ループを変更して、次のクリップを再生する前に待つようにしました。テストは通ります。').name).toBe('Japanese')
  expect(languageOf('我修改了循环，让它在播放下一个片段之前先等待。测试现在通过了。').name).toBe('Chinese')
  expect(languageOf('لقد غيرت الحلقة لتنتظر المقطع قبل تشغيل التالي. الاختبارات تنجح الآن.').name).toBe('Arabic')
})

test('a sentence keeps the language before it unless it is clearly in another one read', () => {
  // Clearly French, after English: two signs of French at least, twice English's.
  expect(spokenIn("Oui, c'est fait.", 'en')).toBe('fr')
  expect(spokenIn('Voilà, tout est prêt pour la suite.', 'en')).toBe('fr')
  expect(spokenIn('Merci beaucoup pour votre aide.', 'en')).toBe('fr')
  // Clearly English, after French.
  expect(spokenIn('Let me know if you want changes.', 'fr')).toBe('en')
  expect(spokenIn("I'll run it again.", 'fr')).toBe('en')
  // Too short to tell: the language around it.
  expect(spokenIn('Parfait !', 'en')).toBe('en')
  expect(spokenIn('Done.', 'fr')).toBe('fr')
  expect(spokenIn('OK.', 'fr')).toBe('fr')
  // A quote of a few words of the other language keeps the sentence's own.
  expect(spokenIn('The error says "le fichier est introuvable", which means the file was not found.', 'en')).toBe('en')
  expect(spokenIn('Le message "the file was not found" est affiché.', 'fr')).toBe('fr')
  // English that looks French, and words of code a French sentence borrows.
  expect(spokenIn('The café serves a naïve résumé.', 'en')).toBe('en')
  expect(spokenIn("C's type system and n's value.", 'en')).toBe('en')
  expect(spokenIn('Runtime est. 5 minutes.', 'en')).toBe('en')
  // Each language is told from the others.
  expect(spokenIn('La casa que es de un amigo está en el centro.', 'en')).toBe('es')
  expect(spokenIn('Il file è nella cartella che hai scelto per il progetto.', 'en')).toBe('it')
  expect(spokenIn('O arquivo não foi encontrado, então o caminho está errado.', 'en')).toBe('pt')
  expect(spokenIn('Die Datei wurde nicht gefunden, also ist der Pfad falsch.', 'en')).toBe('de')
  expect(spokenIn('Het bestand is niet gevonden, dus het pad klopt niet.', 'en')).toBe('nl')
  expect(spokenIn('Le fichier est introuvable, donc le chemin est faux.', 'es')).toBe('fr')
})

test('English is left only for a sentence clearly in another language', () => {
  // Names in another language: "La Liga", "Der Spiegel", "Il Principe".
  expect(spokenIn('Use La Liga data as a demo, e.g. El Clásico.', 'en')).toBe('en')
  expect(spokenIn('Der Spiegel reported it, and De Telegraaf did too.', 'en')).toBe('en')
  expect(spokenIn('Das Kapital is a book, and so is Il Principe.', 'en')).toBe('en')
  // Words English shares with another: "die", "was", "per", "no", "hall".
  expect(spokenIn('I do not see a problem in the die-cast model.', 'en')).toBe('en')
  expect(spokenIn('Per the spec, one session per user.', 'en')).toBe('en')
  expect(spokenIn('We met in the hall, and no one was there.', 'en')).toBe('en')
  // A few words of another language in an English sentence.
  expect(spokenIn('Entre nous, the vis-à-vis of the deus ex machina was a faux pas.', 'en')).toBe('en')
  expect(spokenIn('Add the mi casa es su casa example to the docs.', 'en')).toBe('en')
  expect(spokenIn('Voilà, it works!', 'en')).toBe('en')
  // A name or a loanword with a letter of another language: the letter backs words, never alone.
  expect(spokenIn('I flew to São Paulo yesterday.', 'en')).toBe('en')
  expect(spokenIn('Thanks, Matthias Weiß!', 'en')).toBe('en')
  expect(spokenIn('Add a piñata emoji.', 'en')).toBe('en')
  // Spanish's opening marks are a sign by themselves.
  expect(spokenIn('¿Qué tal?', 'en')).toBe('es')
  expect(spokenIn('¡Hecho!', 'en')).toBe('es')
})

test('a short English sentence goes back to English, and a word other languages share does not', () => {
  expect(spokenIn('All tests pass.', 'fr')).toBe('en')
  expect(spokenIn('Tests are green.', 'de')).toBe('en')
  expect(spokenIn('Want me to continue?', 'nl')).toBe('en')
  // "an", "in", "do", "of" are words of German, Portuguese and Dutch too.
  expect(spokenIn('Legt die maximale Anzahl an Wiederholungen fest.', 'de')).toBe('de')
  expect(spokenIn('Mostra a ajuda do programa.', 'pt')).toBe('pt')})

test('a sentence in Devanagari is Hindi; one in Latin letters after it is English unless clearly another', () => {
  expect(spokenIn('मैंने लूप बदल दिया है।', 'en')).toBe('hi')
  expect(spokenIn('The tests pass now.', 'hi')).toBe('en')
  expect(spokenIn('Le fichier est introuvable, donc le chemin est faux.', 'hi')).toBe('fr')
  // A few English words in a Hindi sentence leave it Hindi.
  expect(spokenIn('क्या आप चाहते हैं कि मैं ये बदलाव commit कर दूँ?', 'en')).toBe('hi')
})

test('a clause is told on its own only when two at least are long enough to tell', () => {
  expect(clausesIn(['My friend from Lyon leaned over and whispered,', "c'est plus facile que tu ne le crois."], 'en')).toEqual(['en', 'fr'])
  expect(clausesIn(['Oui,', 'bien sûr,', 'je comprends.'], 'fr')).toEqual(['fr', 'fr', 'fr'])
  expect(clausesIn(['Later,', 'our classmate joined us and added,', 'la práctica hace al maestro,'], 'es')).toEqual(['en', 'en', 'es'])
  expect(spokenIn('Bref, on a fini par tout comprendre ensemble.', 'en')).toBe('fr')
})

test('a sentence of a few words is told by the words its language writes most', () => {
  // Words of software, as in a reply about code.
  expect(spokenIn('Fichier introuvable dans le dossier.', 'en')).toBe('fr')
  expect(spokenIn('Archivo no encontrado en la carpeta.', 'en')).toBe('es')
  expect(spokenIn('Datei konnte nicht gespeichert werden.', 'en')).toBe('de')
  expect(spokenIn('Het bestand kan niet worden geopend.', 'en')).toBe('nl')
  expect(spokenIn('Impossibile aprire il file selezionato.', 'en')).toBe('it')
  expect(spokenIn('Não foi possível abrir o arquivo.', 'en')).toBe('pt')
  // And English by its own, back from another language.
  expect(spokenIn('Cannot read properties of undefined.', 'fr')).toBe('en')
  expect(spokenIn('The maître d\' brought hors d\'oeuvres yesterday.', 'en')).toBe('en')
})

test('a label names a language, in English, in the language itself, or by its code', () => {
  expect(labelIn('French: Fichier introuvable')).toEqual({ at: 0, end: 7, language: 'fr', said: 'en' })
  expect(labelIn('Español: Archivo no encontrado')).toMatchObject({ language: 'es', said: 'es' })
  expect(labelIn('Anglais : File not found')).toMatchObject({ language: 'en', said: 'fr' })
  expect(labelIn('Portuguese (Brazil): Arquivo não encontrado')).toMatchObject({ language: 'pt', said: 'en' })
  expect(labelIn('Here is the German version: Datei nicht gefunden')).toMatchObject({ at: 12, language: 'de' })
  expect(labelIn('pt-BR: Arquivo não encontrado')).toMatchObject({ language: 'pt', said: 'en' })
  expect(labelIn('German')).toMatchObject({ at: 0, end: 6, language: 'de' })
  // A name without a colon is a word like any other; "it:" inside a sentence is English.
  expect(labelIn('The French catalog is complete.')).toBeUndefined()
  expect(labelIn('Let me fix it: the loop waits now.')).toBeUndefined()
  // What follows a label is in the language it names, unless it reads as English.
  expect(labelledIn('Fichier introuvable', 'fr')).toBe('fr')
  expect(labelledIn('done', 'fr')).toBe('en')
  expect(labelledIn('12 strings missing', 'de')).toBe('en')
})
