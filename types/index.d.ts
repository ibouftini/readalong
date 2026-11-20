// What the reader is doing, held in session state so every reply draws its controls from it.

/** Starting the speech server, waiting for a sentence's audio, playing it, or holding still. */
export type Phase = 'starting' | 'loading' | 'playing' | 'paused'

/**
 * The reply block being read: its id, a mark of its text, the sentence reached and how many there
 * are, and the word of that sentence being said: its index among the sentence's spoken words, null
 * while none is timed (nothing playing, or a server that gives no word timings).
 */
export type Player = {
  id: string
  mark: string
  index: number
  count: number
  phase: Phase
  word: number | null
  /** Whether the server has timed the words of a sentence of this reading. */
  isTimed: boolean
} | null

/**
 * The install of the voice offered under a reply, by its block id: offered, running (its step,
 * and how far along it is in percent where that is known), or stopped, with why. `withModel`
 * false installs the service alone, for a speech server of the user's own.
 */
export type Setup = {
  id: string
  phase: 'offer' | 'installing' | 'failed'
  text: string
  percent: number | null
  /** Megabytes downloaded and in all, while a download reports them. */
  mb: { done: number; total: number } | null
  /** Which step of the install runs, from 1, and how many there are. */
  step: number
  steps: number
  /** Seconds since the install started. */
  seconds: number
  withModel: boolean
} | null

/**
 * A reply not read without asking because readalong has no voice for its language: its block id,
 * the language it looks to be in, and whether it has sentences in a language that is read.
 */
export type Notice = { id: string; language: string; hasRest: boolean } | null

/** The answer that finished last: its block id, as drawn, and its text. */
export type LastReply = { id: string; text: string } | null

/** The voice as /readalong last saw it: running (since when, in seconds since the epoch, for how many sessions), or not. */
export type Service = {
  state: 'running' | 'stopped' | 'not-installed' | 'other'
  since: number
  sessions: number
  port: number
  home: string
} | null

declare module 'claude-code' {
  interface PluginState {
    'readalong': {
      /** The reply being read aloud; null while silent. */
      player: Player
      /** The speed picked in the player; null until one is picked, so the configured speed applies. */
      speed: number | null
      /** The loading spinner's frame, advanced while a sentence is being synthesised. */
      frame: number
      /** Auto-read as picked in the settings menu; null until picked, so the configured setting applies. */
      autoRead: boolean | null
      /** The chime before auto-read, as picked in the settings menu; null until picked. */
      chime: boolean | null
      /** How the sentence being read is marked, as picked in the settings menu; null until picked. */
      highlight: 'marker' | 'underline' | 'off' | null
      /** The highlight's colour as picked in the settings menu, a name or `#RRGGBB`; null until picked. */
      highlightColor: string | null
      /** The voice picked in the settings menu; null until picked, so the configured voice applies. */
      voice: string | null
      /** What the highlight follows, the sentence or each word, as picked in the settings menu; null until picked. */
      follow: 'sentence' | 'word' | null
      /** How the text not read yet is drawn, dim or plain, as picked in the settings menu; null until picked. */
      unread: 'dim' | 'plain' | null
      /** How a long reply is shown while read, in the window or whole, as last switched in the player; null until switched. */
      view: 'window' | 'whole' | null
      /** The reply whose settings menu is open, by its block id; null while none is. */
      menu: string | null
      /** The install of the voice, offered or running under a reply; null while none is. */
      setup: Setup
      /** A reply not read because readalong has no voice for its language, by its block id, and the language it looks to be in. */
      notice: Notice
      /** The answer that finished last in this session, for /readalong to read: its block id and text. */
      lastReply: LastReply
      /** What the voice was doing when /readalong last looked; null before it has. */
      service: Service

    }
  }
}
