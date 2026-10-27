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
