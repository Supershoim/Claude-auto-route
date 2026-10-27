import { expect, test } from 'claude-code/testing'

import { heuristic, route, routeAgent } from '../hooks/classify'

test('the heuristic ladders prompts by tier', async () => {
  expect(heuristic('thanks').tier).toBe(0)
  expect(heuristic('what is a monad?').tier).toBe(0)
  expect(heuristic('explain how the session cache in this module is invalidated after a write').tier).toBe(1)
  expect(heuristic('fix the failing test in parser.ts').tier).toBe(2)
  expect(heuristic('refactor the auth layer and migrate the session store to redis').tier).toBe(3)
  expect(heuristic('investigate the race condition in the job queue').tier).toBe(3)
})

test('a bare follow-up keeps the route of the task before it', async () => {
  const big = route('refactor the auth layer and migrate the session store', null)
  const ack = route('yes go ahead', big)
  expect(ack.model).toBe(big.model)
  expect(ack.effort).toBe(big.effort)
  expect(ack.source).toBe('inherited')
})

test('a one-step downgrade keeps the model, only effort drops', async () => {
  const big = route('investigate the race condition in the job queue', null)
  const next = route('now add a unit test for the queue retry path', big)
  expect(next.model).toBe('opus')
  expect(next.effort).toBe('high')
})

test('explicit model and effort in the prompt win', async () => {
  const r = route('use sonnet, effort: low — rename foo to bar in utils.ts', null)
  expect(r.model).toBe('sonnet')
  expect(r.effort).toBe('low')
  expect(route('ultrathink: design the plugin system', null).effort).toBe('max')
})

test('agent types bound their tier', async () => {
  expect(routeAgent('refactor and audit the whole codebase', 'Explore').model).toBe('sonnet')
  expect(routeAgent('list files', 'Plan').model).toBe('opus')
})

test('an Agent call without model/effort gets them; one with them is left alone', async ($, on) => {
  const seen: unknown[] = []
  on('command.register', () => ({ value: { command: 'route' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', (_, e) => (seen.push(e), { result: {} }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Agent', description: 'find usages', prompt: 'find where parseConfig is called', subagent_type: 'Explore' })
  await $.tool.call({ tool: 'Agent', description: 'x', prompt: 'y', model: 'opus' })

  expect(seen[0]).toMatchObject({ model: 'haiku' })
  expect((seen[0] as { effort?: string }).effort).toBe(undefined)
  expect(seen[1]).toMatchObject({ model: 'opus' })
  expect((seen[1] as { effort?: string }).effort).toBe(undefined)
})

test('a question that mentions build words stays a question; the imperative does not', async () => {
  expect(heuristic('how do I write a test for this hook?').tier).toBe(1)
  expect(heuristic('write a test for the retry hook').tier).toBe(2)
  expect(heuristic('generate a mod to auto select the correct effort and model for all new tasks. check the promts, evaluate the most appropriate model and effort setting and apply.').tier).toBe(3)
})

test('the band shows the route on terminal and desktop, before and after a prompt', async ($, on) => {
  on('command.register', () => ({ value: { command: 'route' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('model.complete', () => ({ value: { isAnswered: true, text: '3', usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }))
  const seenContext: string[] = []
  on('prompt.submit', (_, e) => (seenContext.push(...(e.context ?? [])), { text: e.text }))
  on('ui.log', () => ({ value: undefined }))
  const toasts: string[] = []
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', (_, e) => (toasts.push(JSON.stringify(e)), { value: undefined }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const band = (surface: 'terminal' | 'desktop') =>
    $.ui.mount({
      plugin: 'auto-route',
      component: 'AbovePrompt',
      surface,
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 9 }, view: {} },
    })

  let ui = await band('desktop')
  expect((await ui.find({ type: 'Text', text: /auto-route/ }))?.text).toBe('auto-route: on · routing from the next prompt')
  await ui.unmount()

  await $.prompt.submit({ text: 'refactor the auth layer and migrate the session store to redis' } as never)
  expect(toasts.length).toBe(1)
  expect(seenContext.at(-1)).toMatch(/^auto-route routed this turn to opus·xhigh[\s\S]*`route: opus·xhigh · T3/)
  expect(toasts[0]).toMatch(/opus·xhigh/)
  for (const surface of ['terminal', 'desktop'] as const) {
    ui = await band(surface)
    expect((await ui.find({ type: 'Text', text: /auto-route/ }))?.text).toMatch(/^auto-route: opus·xhigh · T3/)
    await ui.unmount()
  }
})

test('main-loop requests are rewritten to the route and the answer gets a footer', async ($, on) => {
  const sent: { model: string; effort?: unknown }[] = []
  on('command.register', () => ({ value: { command: 'route' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'api-error', status: 500, error: 'unknown', usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('turn.step', async function* (_, e) {
    sent.push({ model: e.model, effort: e.effort })
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] } as never
  })
  on('turn.complete', () => ({ text: 'done.' }))

  await $.session.start({ cwd: '/', surface: 'mobile', isInteractive: true })
  await $.prompt.submit({ text: 'fix the failing test in parser.ts' } as never)
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 })) void _
  for await (const _ of $.turn.step({ turnId: 't1', index: 1, model: 'x', messageCount: 2, agentId: 'a1' })) void _

  expect(sent[0]).toMatchObject({ model: 'opus', effort: 'high' })
  expect(sent[1]).toMatchObject({ model: 'x' })

  const done = await $.turn.complete({ turnId: 't1', answer: 'done.', durationMs: 1, isAborted: false, reason: 'answer' })
  expect(done.text).toMatch(/^done\.\n\n_route: opus·high · T2/)
  const sub = await $.turn.complete({ turnId: 't2', answer: 'x', durationMs: 1, isAborted: false, reason: 'answer', agentId: 'a1' })
  expect(sub.text).toBe('done.')
})

test('a terse prompt follows the task before it, or goes to haiku with none', async () => {
  for (const t of ['test', 'fix it', 'continue', 'update']) {
    expect(heuristic(t)).toMatchObject({ tier: 0, hasOwnSignal: false })
  }
  const big = route('refactor the auth layer and migrate the session store', null)
  expect(route('test', big)).toMatchObject({ model: 'opus', effort: 'xhigh', source: 'inherited' })
  expect(route('fix it', route('fix it', big)).reason).toBe(`follow-up of ${big.reason}`)
  expect(route('test', null)).toMatchObject({ model: 'haiku', tier: 0 })
  // Concrete or explicit short prompts are still classified on their own.
  expect(heuristic('fix parser.ts').tier).toBe(2)
  expect(route('use sonnet', big)).toMatchObject({ model: 'sonnet', source: 'explicit' })
  expect(route('ultrathink', big)).toMatchObject({ model: 'opus', effort: 'max' })
})
