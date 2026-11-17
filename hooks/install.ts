// Installing the voice from inside Claude Code: a press that finds it missing offers the install
// under that reply, and the install runs there, its progress drawn in its place.

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Setup } from '../types'
import { installCommand, place } from './service'

type $ = EngineInterface

// The engine reads each file's state values off its source, so each file names its own.
const setupState = atom({ plugin: 'readalong', key: 'setup' } as const, null)

let isInstalling = false

/** Offers the install under reply `id`; `withModel` false installs the service alone, for a speech server of the user's own. */
export async function offerInstall($: $, id: string, withModel: boolean) {
  const offer: Setup = { id, phase: 'offer', text: '', percent: null, mb: null, step: 1, steps: withModel ? 4 : 3, seconds: 0, withModel }
  await update($, setupState, now => (now?.phase === 'installing' ? now : offer))
}

export async function dismissInstall($: $) {
  await update($, setupState, now => (now?.phase === 'installing' ? now : null))
}

/**
 * Runs the installer for this system, drawing its progress under the reply that offered it;
 * `onDone` runs once the voice is installed and answers. One install at a time.
 */
export async function runInstall($: $, onDone: () => Promise<void>) {
  const offer = await read($, setupState)
  if (isInstalling || offer === null) return
  isInstalling = true
  const show = (next: Partial<NonNullable<Setup>>) => update($, setupState, now => (now === null ? now : { ...now, ...next }))
  await show({ phase: 'installing', text: 'Starting', percent: null, mb: null, step: 1, seconds: 0 })
  // A clock in the panel, so a step that reports no progress of its own is seen to go on.
  const ticking = $.clock.every(1000, () => void update($, setupState, now => (now?.phase === 'installing' ? { ...now, seconds: now.seconds + 1 } : now)))
  let failed: string | null = null
  let isDone = false
  let errors = ''
  let pending = ''
  const said = async (line: string) => {
    let step: { step?: unknown; text?: unknown; error?: unknown; percent?: unknown; done_mb?: unknown; total_mb?: unknown }
    try {
      step = JSON.parse(line) as typeof step
    } catch {
      return // what a tool beneath the installer printed
    }
    if (step.step === 'failed') failed = typeof step.error === 'string' && step.error !== '' ? step.error : 'the install stopped'
    else if (step.step === 'done') isDone = true
    else if (step.step !== 'warning' && typeof step.text === 'string' && step.text !== '') {
      const isCounted = typeof step.done_mb === 'number' && typeof step.total_mb === 'number' && step.total_mb > 0
      await show({
        text: step.text,
        percent: typeof step.percent === 'number' ? step.percent : null,
        mb: isCounted ? { done: step.done_mb as number, total: step.total_mb as number } : null,
        step: stepNumber(step.step, offer.withModel),
      })
    }
  }
  try {
    const p = await place($)
    const child = $.process.spawn({
      argv: installCommand($, p, offer.withModel),
      env: { READALONG_HOME: p.home, READALONG_PORT: String(p.port) },
    })
    for await (const { stream, text } of child) {
      if (stream === 'stderr') {
        errors = (errors + text).slice(-4000)
        continue
      }
      pending += text
      for (let cut = pending.indexOf('\n'); cut >= 0; cut = pending.indexOf('\n')) {
        const line = pending.slice(0, cut).trim()
        pending = pending.slice(cut + 1)
        if (line !== '') await said(line)
      }
    }
    if (pending.trim() !== '') await said(pending.trim())
    const ended = await child.result
    if (!isDone && failed === null) {
      const last = errors.trim().split(/\r?\n/).filter(l => l.trim() !== '').slice(-1)[0]
      failed = last ?? `the installer ended with ${ended.code ?? ended.signal}`
    }
  } catch (err) {
    failed = `the installer could not run (${String(err)})`
  } finally {
    ticking.cancel()
    isInstalling = false
  }
  if (failed !== null) {
    await show({ phase: 'failed', text: failed, percent: null })
    return
  }
  await update($, setupState, () => null)
  $.ui.toast('The readalong voice is installed')
  await onDone()
}

/** Where a step the installer names comes in the install: getting ready, packages, model, test. */
function stepNumber(name: unknown, withModel: boolean): number {
  switch (name) {
    case 'packages':
      return 2
    case 'model':
      return 3
    case 'test':
      return withModel ? 4 : 3
    default:
      return 1
  }
}
