// The settings picked in the gear menu under a reply or in the /readalong panel: what is in force
// now, the picks that change it, and the rows both places draw them with.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderElement, RenderSurface, TextProps } from 'claude-code'

import { setVoice } from './reader'
import { COLORS, colorHex, colorSetting, hexColor, inkOn, isFollow, isHighlight, VOICES, voiceName } from './state'
import type { Follow, Highlight, Settings } from './state'

type $ = EngineInterface
type UI = ReturnType<EngineInterface['ui']['resolve']>

// The engine reads each file's state values off its source, so each file names its own.
const pickedSpeed = atom({ plugin: 'readalong', key: 'speed' } as const, null)
const autoReadState = atom({ plugin: 'readalong', key: 'autoRead' } as const, null)
const chimeState = atom({ plugin: 'readalong', key: 'chime' } as const, null)
const highlightState = atom({ plugin: 'readalong', key: 'highlight' } as const, null)
const highlightColorState = atom({ plugin: 'readalong', key: 'highlightColor' } as const, null)
const followState = atom({ plugin: 'readalong', key: 'follow' } as const, null)
const voiceState = atom({ plugin: 'readalong', key: 'voice' } as const, null)

/** How a pick is kept in `$.store`: with the `/config` value it was made under, so a later change there wins. */
type Kept = { value?: unknown; configured?: unknown } | undefined

/** What is in force: each setting as last picked, or as configured where none was picked. */
export type Now = {
  autoRead: boolean
  chime: boolean
  highlight: Highlight
  color: string
  follow: Follow
  voice: string
  speed: number
}

export async function settingsNow($: $, s: Settings): Promise<Now> {
  return {
    autoRead: (await read($, autoReadState)) ?? s.autoRead,
    chime: (await read($, chimeState)) ?? s.chime,
    highlight: (await read($, highlightState)) ?? s.highlight,
    color: (await read($, highlightColorState)) ?? s.highlightColor,
    follow: (await read($, followState)) ?? s.follow,
    voice: (await read($, voiceState)) ?? s.voice,
    speed: (await read($, pickedSpeed)) ?? s.speed,
  }
}

/** At a session's start: the settings as last picked, each unless its configured value changed since. */
export async function restorePicks($: $, s: Settings) {
  const autoRead = (await $.store.get('autoRead')) as Kept
  const chime = (await $.store.get('chime')) as Kept
  const highlight = (await $.store.get('highlight')) as Kept
  const color = (await $.store.get('highlightColor')) as Kept
  const follow = (await $.store.get('follow')) as Kept
  const voice = (await $.store.get('voice')) as Kept
  await update($, autoReadState, () => (typeof autoRead?.value === 'boolean' && autoRead.configured === s.autoRead ? autoRead.value : null))
  await update($, chimeState, () => (typeof chime?.value === 'boolean' && chime.configured === s.chime ? chime.value : null))
  await update($, highlightState, () => (isHighlight(highlight?.value) && highlight.configured === s.highlight ? highlight.value : null))
  await update($, highlightColorState, () => {
    const kept = colorSetting(color?.value)
    return kept !== undefined && color?.configured === s.highlightColor ? kept : null
  })
  await update($, followState, () => (isFollow(follow?.value) && follow.configured === s.follow ? follow.value : null))
  await update($, voiceState, () => (typeof voice?.value === 'string' && voice.configured === s.voice ? voice.value : null))
}

/**
 * Auto-read and the chime as last picked, read from `$.store`, where a pick is kept the moment it
 * is made. In a live session a `turn.complete` hook kept reading the session-state copy the menu
 * draws from as it stood when the session started, so a pick applied only once the session was
 * reopened; the copy is brought up to date here, for the menu.
 */
export async function autoReadNow($: $, s: Settings): Promise<{ isOn: boolean; isChiming: boolean; voice: string; speed: number }> {
  const autoReadPick = await keptPick($, 'autoRead', s.autoRead)
  const chimePick = await keptPick($, 'chime', s.chime)
  if ((await read($, autoReadState)) !== autoReadPick) await update($, autoReadState, () => autoReadPick)
  if ((await read($, chimeState)) !== chimePick) await update($, chimeState, () => chimePick)
  return {
    isOn: autoReadPick ?? s.autoRead,
    isChiming: chimePick ?? s.chime,
    voice: (await read($, voiceState)) ?? s.voice,
    speed: (await read($, pickedSpeed)) ?? s.speed,
  }
}

async function keptPick($: $, key: 'autoRead' | 'chime', configured: boolean): Promise<boolean | null> {
  const kept = (await $.store.get(key)) as Kept
  return typeof kept?.value === 'boolean' && kept.configured === configured ? kept.value : null
}

export type Picks = {
  autoRead: (value: boolean) => Promise<void>
  chime: (value: boolean) => Promise<void>
  highlight: (value: Highlight) => Promise<void>
  follow: (value: Follow) => Promise<void>
  color: (value: string) => Promise<void>
  voice: (value: string) => Promise<void>
}

/** The picks, each used at once and kept with the configured value it was made under. */
export function picksFor($: $, s: Settings, now: Now): Picks {
  const highlight = async (value: Highlight) => {
    await update($, highlightState, () => value)
    await $.store.set('highlight', { value, configured: s.highlight })
  }
  return {
    autoRead: async value => {
      await update($, autoReadState, () => value)
      await $.store.set('autoRead', { value, configured: s.autoRead })
    },
    chime: async value => {
      await update($, chimeState, () => value)
      await $.store.set('chime', { value, configured: s.chime })
    },
    highlight,
    follow: async value => {
      await update($, followState, () => value)
      await $.store.set('follow', { value, configured: s.follow })
    },
    // With the highlight off, a colour turns the marker on, so the colour shows.
    color: async value => {
      await update($, highlightColorState, () => value)
      await $.store.set('highlightColor', { value, configured: s.highlightColor })
      if (now.highlight === 'off') await highlight('marker')
    },
    // A voice picked is heard at once: the reading goes on in it, or it says hello. The hello is
    // a whole sentence with no comma: the voices are weak on a line of a few sounds, and "I'm
    // Emma" ran the two m's together.
    voice: async value => {
      await update($, voiceState, () => value)
      await $.store.set('voice', { value, configured: s.voice })
      await setVoice($, s, value, `My name is ${voiceName(value)} and I will read for you.`, now.speed)
    },
  }
}

/**
 * How the sentence being read is drawn, in a colour named or `#RRGGBB`: a marker behind it, its
 * text dark or white to stay readable; or an underline, its text in the colour. The same in light
 * and dark themes.
 */
export function litBy(highlight: Exclude<Highlight, 'off'>, color: string): TextProps {
  const hex = colorHex(color)
  if (highlight === 'marker') return { backgroundColor: hex, color: inkOn(hex) }
  return { underline: true, color: hex }
}

/** What a colour swatch's own label holds in the editor: half as much room, a square of colour. */
const SWATCH_ROOM = ' '

/**
 * The settings as rows, in two groups: what is read and by whom, and how it is shown. In the
 * `/readalong` panel (`isPanel`) the voices say their accent, a field takes a colour's hex code,
 * and a sample sentence shows the highlight as it will look.
 */
export function settingsRows(
  ui: UI,
  surface: RenderSurface,
  now: Now,
  picks: Picks,
  isPanel: boolean,
  say: (text: string) => void = () => undefined,
): { reading: RenderElement[]; looks: RenderElement[] } {
  const { Box, Button, Text, Input } = ui

  /** One row: its name, then a button per choice, the one in force marked. */
  const row = <T extends string | boolean>(
    key: string,
    name: string,
    choices: ReadonlyArray<readonly [T, string]>,
    value: T,
    pick: (value: T) => Promise<void>,
  ): RenderElement => (
    <Box key={`row:${key}`} flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={1}>
      <Box width={10} flexShrink={0}>
        <Text dimColor>{name}</Text>
      </Box>
      {choices.map(([choice, word]) => {
        // The choice in force in Claude's orange, the rest dim. Every choice is built alike and
        // only its colour changes, so a press restyles the button in place instead of replacing
        // it, which shifted the panel's scroll; not bold, which would widen it and move the rest.
        const isChosen = choice === value
        return (
          <Button key={`${key}:${word}`} label={word} dimColor={!isChosen} onPress={() => void pick(choice)}>
            <Text color={isChosen ? 'claude' : undefined} dimColor={!isChosen}>
              {word}
            </Text>
          </Button>
        )
      })}
    </Box>
  )
  const onOff = [
    [true, 'On'],
    [false, 'Off'],
  ] as const

  // The three voices by name; a voice of the user's own set in /config, by its id, after them.
  const voices: Array<readonly [string, string]> = VOICES.map(v => [v.id, isPanel ? `${v.name}, ${v.kind}` : v.name] as const)
  if (!VOICES.some(v => v.id === now.voice)) voices.push([now.voice, now.voice])

  /**
   * The colour row: a swatch per colour. A `#RRGGBB` set in /config or the panel that no swatch
   * matches is offered as one more swatch, at the end.
   *
   * In the editor a swatch is its colour and nothing else. The editor draws a button with
   * padding inside its border, and its label in place of what it holds, so a colour held inside
   * would fill only its middle. So the button's label is blank, and the colour is the background
   * of a box drawn just the button's size, under it: a dim button is see-through, so the colour
   * fills it to its border. The box is rounded, more than the button, so the colour stays inside
   * the button's rounded corners; its border, which it needs to be rounded, is drawn in the
   * panel's colour, or around the swatch in force in the text colour, a ring that marks it.
   *
   * Elsewhere the colour is a chip inside the button, beside its name. The one in force holds a
   * dot in an ink readable on it; every chip holds a dot, the rest drawn in the chip's own colour,
   * so a pick changes colours, never widths.
   */
  const isEditor = surface === 'vscode'
  const chip = surface === 'terminal' ? ' ● ' : ' • '
  const nowHex = colorHex(now.color)
  const swatches: ReadonlyArray<readonly [string, string, string]> = [
    ...Object.entries(COLORS).map(([name, hex]) => [name, name.charAt(0).toUpperCase() + name.slice(1), hex] as const),
    ...(Object.values(COLORS).some(hex => hex === nowHex) ? [] : [[nowHex, nowHex, nowHex] as const]),
  ]
  const colorRow = (
    <Box key="row:color" flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={1}>
      <Box width={10} flexShrink={0}>
        <Text dimColor>Colour</Text>
      </Box>
      {swatches.map(([value, word, hex]) => {
        const isChosen = hex === nowHex
        return isEditor && !isPanel ? (
          <Box key={`swatch:${word}`} backgroundColor={hex} borderStyle="round" borderColor={isChosen ? 'text' : 'background'} flexShrink={0}>
            <Button key={`color:${word}`} label={SWATCH_ROOM} dimColor onPress={() => void picks.color(value)} />
          </Box>
        ) : (
          <Button key={`color:${word}`} label={word} dimColor={!isChosen} onPress={() => void picks.color(value)}>
            <Text backgroundColor={hex} color={isChosen ? inkOn(hex) : hex}>
              {chip}
            </Text>
            {isEditor ? null : (
              <Text color={isChosen ? 'claude' : undefined} dimColor={!isChosen}>
                {word}
              </Text>
            )}
          </Button>
        )
      })}
    </Box>
  )

  const reading = [
    row('autoRead', 'Auto-read', onOff, now.autoRead, picks.autoRead),
    row('chime', 'Chime', onOff, now.chime, picks.chime),
    row('voice', 'Voice', voices, now.voice, picks.voice),
  ]
  const looks = [
    row(
      'highlight',
      'Highlight',
      [
        ['marker', 'Marker'],
        ['underline', 'Underline'],
        ['off', 'Off'],
      ] as const,
      now.highlight,
      picks.highlight,
    ),
    row(
      'follow',
      'Follow',
      [
        ['sentence', 'Sentence'],
        ['word', 'Word'],
      ] as const,
      now.follow,
      picks.follow,
    ),
    colorRow,
  ]
  if (isPanel) {
    // A colour of one's own: its hex code, typed; one that is not a colour is said so, and kept out.
    const useHex = (typed: string) => {
      const hex = hexColor(typed)
      if (hex === undefined) return say(`"${typed.trim()}" is not a colour: type # and six hex digits, such as #FFB3C7`)
      void picks.color(hex)
    }
    const lit = now.highlight === 'off' ? {} : litBy(now.highlight, now.color)
    looks.push(
      <Box key="row:custom" flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={1}>
        <Box width={10} flexShrink={0}>
          <Text dimColor>Your own</Text>
        </Box>
        <Input key="custom-color" placeholder="type a hex code such as #FFB3C7, then Enter" submitLabel="use it" onSubmit={useHex} />
      </Box>,
      <Box key="row:sample" flexDirection="row" flexWrap="wrap" columnGap={1}>
        <Box width={10} flexShrink={0}>
          <Text dimColor>Looks like</Text>
        </Box>
        <Text>
          {'A reply is read like this: '}
          <Text {...lit}>the sentence being read is marked</Text>
          {now.highlight === 'off' ? ' (the highlight is off).' : ', and the mark moves on.'}
        </Text>
      </Box>,
    )
  }
  return { reading, looks }
}
