import type { PluginOptions } from 'claude-code'

import type { Spoken } from './language'

export const HIGHLIGHTS = ['marker', 'underline', 'off'] as const

/**
 * The voices offered, by name, in the menu, the `/readalong` panel and `/config`: Kokoro's
 * best-graded English voice of each kind, told apart by accent or by voice (the grades are in
 * Kokoro-82M's VOICES.md). Each says hello by its name when picked. `/config` names each by its
 * `option`; `other` there takes any voice the server has, named in `otherVoice`.
 */
export const VOICES = [
  { id: 'af_heart', option: 'heart', name: 'Heart', kind: 'American' },
  { id: 'bf_emma', option: 'emma', name: 'Emma', kind: 'British' },
  { id: 'am_michael', option: 'michael', name: 'Michael', kind: 'American, male' },
] as const

/**
 * The voice each language Kokoro has voices for is read in: one made for that language, as an
 * English voice reads it with English sounds. A woman's and a man's where Kokoro has both, so
 * the voice of another language is of the kind picked for English; French has one, Siwis.
 */
export const LANGUAGE_VOICES: Partial<Record<Spoken, { female: string; male: string }>> = {
  fr: { female: 'ff_siwis', male: 'ff_siwis' },
  es: { female: 'ef_dora', male: 'em_alex' },
  it: { female: 'if_sara', male: 'im_nicola' },
  pt: { female: 'pf_dora', male: 'pm_alex' },
  hi: { female: 'hf_alpha', male: 'hm_omega' },
}

/** The names of Kokoro's voices of other languages, as Kokoro gives them. */
const VOICE_NAMES: Record<string, string> = {
  ff_siwis: 'Siwis', ef_dora: 'Dora', em_alex: 'Alex', if_sara: 'Sara', im_nicola: 'Nicola',
  pf_dora: 'Dora', pm_alex: 'Alex', hf_alpha: 'Alpha', hm_omega: 'Omega',
}

/**
 * The voice a sentence in `language` is read in, with `picked` the voice picked for English:
 * that one for English; the language's own, of the same kind (Kokoro names a man's voice with an
 * m second, `am_michael`), where Kokoro has one; and where it has none, as for German and Dutch,
 * the voice picked again, which the service then has say that language's sounds.
 */
export function voiceFor(language: Spoken, picked: string): string {
  const own = LANGUAGE_VOICES[language]
  if (own === undefined) return picked
  return picked.charAt(1) === 'm' ? own.male : own.female
}

/** A voice's name to show: Heart for af_heart; a voice of the user's own server by its own id. */
export function voiceName(id: string): string {
  return VOICES.find(v => v.id === id)?.name ?? VOICE_NAMES[id] ?? id
}

/** What the highlight follows: the sentence being read, or each word as it is said. */
export const FOLLOWS = ['sentence', 'word'] as const
export type Follow = (typeof FOLLOWS)[number]

export function isFollow(value: unknown): value is Follow {
  return (FOLLOWS as readonly unknown[]).includes(value)
}

/** The colours the menu offers as swatches, round the colour wheel; each can be named in `/config` too. */
export const COLORS = {
  red: '#F94144',
  orange: '#F8961E',
  yellow: '#F9C74F',
  green: '#90BE6D',
  teal: '#43AA8B',
  blue: '#277DA1',
} as const
export type ColorName = keyof typeof COLORS

export function isColorName(value: unknown): value is ColorName {
  return typeof value === 'string' && Object.hasOwn(COLORS, value)
}

/** A highlight colour, a name or `#RRGGBB`, as `#RRGGBB`. */
export function colorHex(color: string): string {
  return isColorName(color) ? COLORS[color] : color
}

/** A highlight colour as the settings hold it, a name or `#RRGGBB`; undefined if it is neither. */
export function colorSetting(value: unknown): string | undefined {
  if (isColorName(value)) return value
  return typeof value === 'string' ? hexColor(value) : undefined
}
/** What plays the sound: `auto` picks this system's own (winsound on Windows, afplay on macOS, the first of the rest that works on Linux). */
export const PLAYERS = ['auto', 'pw-play', 'paplay', 'aplay', 'afplay', 'ffplay'] as const

export type Highlight = (typeof HIGHLIGHTS)[number]

export function isHighlight(value: unknown): value is Highlight {
  return (HIGHLIGHTS as readonly unknown[]).includes(value)
}

export type Settings = {
  server: string
  voice: string
  speed: number
  startCommand: string
  highlight: Highlight
  highlightColor: string
  follow: Follow
  player: (typeof PLAYERS)[number]
  autoRead: boolean
  chime: boolean
}

/** The speeds the player offers, with the configured one added when it is not among them. */
export const SPEEDS = [0.5, 0.75, 0.9, 1, 1.1, 1.2, 1.3, 1.5, 1.75, 2]

/** The range the bundled voice accepts, and the player offers. */
export function clampSpeed(speed: number): number {
  return Math.min(2, Math.max(0.5, speed))
}

export function speedsWith(speed: number): number[] {
  return [...new Set([...SPEEDS, speed])].sort((a, b) => a - b)
}

export function speedLabel(speed: number): string {
  return `${Number(speed.toFixed(2))}×`
}

export function settingsFrom(options: PluginOptions): Settings {
  const text = (key: string, fallback: string) => {
    const value = options[key]
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
  }
  const pick = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const value = text(key, fallback)
    return (allowed as readonly string[]).includes(value) ? (value as T) : fallback
  }
  const bool = (key: string, fallback: boolean) => {
    const value = options[key]
    return typeof value === 'boolean' ? value : fallback
  }
  const speed = Number(options['speed'])
  return {
    server: text('server', 'http://127.0.0.1:8881').replace(/\/+$/, ''),
    voice: voiceSetting(text('voice', 'heart').toLowerCase(), text('otherVoice', '')),
    speed: Number.isFinite(speed) && speed > 0 ? clampSpeed(speed) : 1,
    startCommand: text('startCommand', 'auto'),
    highlight: pick('highlight', HIGHLIGHTS, 'marker'),
    highlightColor: colorFrom(text('highlightColor', 'yellow').toLowerCase(), text('customColor', '')),
    follow: pick('follow', FOLLOWS, 'sentence'),
    player: pick('player', PLAYERS, 'auto'),
    autoRead: bool('autoRead', false),
    chime: bool('chime', true),
  }
}

/**
 * The voice `/config` picks: one of the three by its option (`heart`), or with `other` the voice
 * named in `otherVoice`. A voice id typed straight into `voice` (`bf_emma`, as before the
 * picker) is taken as it stands.
 */
export function voiceSetting(picked: string, other: string): string {
  const offered = VOICES.find(v => v.option === picked || v.id === picked)
  if (offered !== undefined) return offered.id
  if (picked === 'other') return other.trim() || 'af_heart'
  return /^[a-z]{2}_[a-z]+$/.test(picked) ? picked : 'af_heart'
}

/**
 * The colour `/config` picks: a named one, or with `custom` the `#RRGGBB` typed in
 * `customColor`; yellow when that is not a colour. A hex typed straight into `highlightColor`
 * (as before the picker) is taken too.
 */
export function colorFrom(picked: string, custom: string): string {
  if (picked === 'custom') return hexColor(custom) ?? 'yellow'
  return colorSetting(picked) ?? 'yellow'
}

/** A colour typed as `#RGB` or `#RRGGBB`, the `#` optional, as `#RRGGBB`; undefined if it is not one. */
export function hexColor(typed: string): string | undefined {
  const digits = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(typed.trim())?.[1]
  if (digits === undefined) return undefined
  const full = digits.length === 3 ? [...digits].map(d => d + d).join('') : digits
  return `#${full.toUpperCase()}`
}

/** The text colour that stays readable on a `#RRGGBB` background: near-black on light, white on dark. */
export function inkOn(background: string): string {
  const [r, g, b] = [1, 3, 5].map(i => {
    const c = Number.parseInt(background.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  // Where black and white text have equal contrast against it.
  return luminance > 0.179 ? '#1B1B1B' : '#FFFFFF'
}
