import { expect, test } from 'claude-code/testing'

const reply = (text: string) =>
  ({
    plugin: 'readalong',
    component: 'AssistantMessage',
    requestId: 'msg-1',
    props: { text, isFirstOfReply: true },
  }) as const

test('a reply gets the play button under the engine drawing, on every surface', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...reply('Some **bold** words and a [link](https://x.org).'), surface })
    expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
    // An icon in the editor and the desktop app, a word elsewhere.
    const icons = (await ui.findAll({ type: 'Svg' })).map(icon => String(icon.props.alt)).filter(alt => alt.trim() !== '')
    const label = (await ui.find({ key: 'read' }))?.props.label
    if (surface === 'vscode' || surface === 'desktop') expect(icons).toEqual(['Read aloud', 'Settings'])
    else expect(label).toBe('read aloud')
    expect(await ui.find({ key: 'next' })).toBeUndefined()
    await ui.unmount()
  }
})

test('a reply that is only code gets no button', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount({ ...reply('```\nls -la\n```'), surface: 'vscode' })
  expect(await ui.find({ key: 'read' })).toBeUndefined()
  await ui.unmount()
})

test('a summary of a reply gets no button', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount({
    plugin: 'readalong',
    component: 'AssistantMessage',
    requestId: 'msg-1',
    props: { text: 'A summary of what was said.', isFirstOfReply: true, isSummary: true },
    surface: 'vscode',
  })
  expect(await ui.find({ key: 'read' })).toBeUndefined()
  await ui.unmount()
})

test(
  'custom settings still draw the button',
  { options: { server: 'http://localhost:9000/', voice: 'bf_emma', speed: 1.2, highlight: 'underline', highlightColor: '#f0c', player: 'ffplay' } },
  async ($, on) => {
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine</Text>
    })
    const ui = await $.ui.mount({ ...reply('Hello.'), surface: 'desktop' })
    expect(await ui.find({ key: 'read' })).toBeDefined()
    await ui.unmount()
  },
)

test("Claude Code's line for a dropped prompt gets no button", async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount({
    plugin: 'readalong',
    component: 'AssistantMessage',
    requestId: 'dropped',
    props: { text: 'Prompt dropped by a hook: readalong: stopped (s is its key while it reads, not sent to Claude)', isFirstOfReply: true },
    surface: 'terminal',
  })
  expect(await ui.find({ key: 'read' })).toBeUndefined()
  await ui.unmount()
})
