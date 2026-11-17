import { expect, test } from 'claude-code/testing'

import { COLORS, colorHex, hexColor, inkOn, settingsFrom, voiceFor, voiceName } from '../hooks/state'

test('a colour is read as #RGB or #RRGGBB, the # optional, and given as #RRGGBB', () => {
  expect(hexColor('#c8f7c5')).toBe('#C8F7C5')
  expect(hexColor(' C8F7C5 ')).toBe('#C8F7C5')
  expect(hexColor('#f0c')).toBe('#FF00CC')
  expect(hexColor('green')).toBeUndefined()
  expect(hexColor('#12345')).toBeUndefined()
  expect(hexColor('')).toBeUndefined()
})

test('a colour named is its swatch\'s #RRGGBB, and one given as #RRGGBB stays as it is', () => {
  expect(colorHex('teal')).toBe('#43AA8B')
  expect(colorHex('#FF00CC')).toBe('#FF00CC')
  // Every swatch is a whole #RRGGBB, so a marker can work out its ink.
  for (const hex of Object.values(COLORS)) expect(hexColor(hex)).toBe(hex)
})

test('text on a marker is near-black on a light one, white on a dark one', () => {
  expect(inkOn('#F9C74F')).toBe('#1B1B1B')
  expect(inkOn('#C8F7C5')).toBe('#1B1B1B')
  expect(inkOn('#333366')).toBe('#FFFFFF')
  expect(inkOn('#000000')).toBe('#FFFFFF')
})

test('/config names a voice by its picker option, or another by its id with "other"', () => {
  const voice = (options: Record<string, string>) => settingsFrom(options).voice
  expect(voice({})).toBe('af_heart')
  expect(voice({ voice: 'emma' })).toBe('bf_emma')
  expect(voice({ voice: 'michael' })).toBe('am_michael')
  expect(voice({ voice: 'other', otherVoice: 'bm_george' })).toBe('bm_george')
  // "other" with nothing named reads with the default voice.
  expect(voice({ voice: 'other', otherVoice: ' ' })).toBe('af_heart')
})

test('/config picks a colour by name, or a hex code of its own with "custom"', () => {
  const color = (options: Record<string, string>) => settingsFrom(options).highlightColor
  expect(color({})).toBe('yellow')
  expect(color({ highlightColor: 'teal' })).toBe('teal')
  expect(color({ highlightColor: 'custom', customColor: '#ffb3c7' })).toBe('#FFB3C7')
  // A custom colour that is not one falls back to yellow.
  expect(color({ highlightColor: 'custom', customColor: 'pink' })).toBe('yellow')
})

test('each language has its voice, of the kind picked for English, or the voice picked where Kokoro has none', () => {
  expect(voiceFor('en', 'bf_emma')).toBe('bf_emma')
  expect(voiceFor('fr', 'bf_emma')).toBe('ff_siwis')
  expect(voiceFor('fr', 'am_michael')).toBe('ff_siwis')
  expect(voiceFor('es', 'af_heart')).toBe('ef_dora')
  expect(voiceFor('es', 'am_michael')).toBe('em_alex')
  expect(voiceFor('it', 'am_michael')).toBe('im_nicola')
  expect(voiceFor('pt', 'af_heart')).toBe('pf_dora')
  expect(voiceFor('hi', 'am_michael')).toBe('hm_omega')
  // No German or Dutch voice: the one picked, which says German or Dutch sounds.
  expect(voiceFor('de', 'bf_emma')).toBe('bf_emma')
  expect(voiceFor('nl', 'am_michael')).toBe('am_michael')
  expect(voiceName('ff_siwis')).toBe('Siwis')
  expect(voiceName('em_alex')).toBe('Alex')
})
