import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Effort, Model, Route, RouteSettings } from '../types'
import { CLASSIFIER_SYSTEM, heuristic, parseTier, route, routeAgent } from './classify'

const routeAtom = atom({ plugin: 'auto-route', key: 'route' } as const, null, { shape: 'route-1' })
const settingsAtom = atom(
  { plugin: 'auto-route', key: 'settings' } as const,
  { isEnabled: true, isLlmRefined: true, pin: null } as RouteSettings,
  { shape: 'settings-1' },
)

const MODELS: Model[] = ['haiku', 'sonnet', 'opus', 'fable']
const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']
// Haiku takes no effort parameter; sending one risks a 400.
const takesEffort = (model: string) => !/haiku/i.test(model)

const label = (r: Pick<Route, 'model' | 'effort'>) =>
  takesEffort(r.model) ? `${r.model}·${r.effort}` : r.model

async function refine($: EngineInterface, text: string): Promise<number | undefined> {
  const r = await $.model.complete({
    model: 'haiku',
    system: CLASSIFIER_SYSTEM,
    prompt: text.slice(0, 4000),
    maxTokens: 4,
    timeoutMs: 5000,
  })
  return r.isAnswered ? parseTier(r.text) : undefined
}

const HELP = `/route                    show the current route
/route on | off           enable / disable auto-routing
/route llm on | off       haiku refinement of the heuristic tier
/route pin <model> [effort]   fix model (+effort) for every turn
/route unpin              back to auto`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'route', description: 'Auto model/effort routing: status, on/off, pin' })
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const settings = await read($, settingsAtom)
    // Slash commands and engine-injected prompts don't start a new task.
    if (!settings.isEnabled || e.command || e.isMeta || e.turnId) return next(e)

    let r: Route
    if (settings.pin) {
      r = { tier: 2, ...settings.pin, reason: 'pinned', source: 'pinned' }
    } else {
      const prev = await read($, routeAtom)
      const sig = heuristic(e.text)
      // Refine only where the heuristic can be wrong in a costly way:
      // non-trivial prompts that aren't plain follow-ups.
      const llmTier =
        settings.isLlmRefined && sig.hasOwnSignal && e.text.trim().split(/\s+/).length >= 8
          ? await refine($, e.text).catch(() => undefined)
          : undefined
      // The LLM may raise the tier freely but lower it by one step at most.
      const tier =
        llmTier === undefined ? undefined : (Math.max(llmTier, sig.tier - 1) as Route['tier'])
      r = route(e.text, prev, tier)
    }

    await update($, routeAtom, () => r)
    $.ui.status(`route ${label(r)} · T${r.tier} ${r.source}`)
    return next(e)
  })

  // Main loop only; subagents get their route through the Agent call below.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)
    const [settings, r] = await Promise.all([read($, settingsAtom), read($, routeAtom)])
    if (!settings.isEnabled || !r) return yield* next(e)

    const { effort: _drop, ...rest } = e
    return yield* next(
      takesEffort(r.model) ? { ...e, model: r.model, effort: r.effort } : { ...rest, model: r.model },
    )
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const settings = await read($, settingsAtom)
    // Respect a caller that already chose, and forks, which ignore both fields.
    if (!settings.isEnabled || e.model || e.effort || e.subagent_type === 'fork') return next(e)

    const a = settings.pin ?? routeAgent(`${e.description}\n${e.prompt}`, e.subagent_type)
    return next({
      ...e,
      model: a.model,
      ...(takesEffort(a.model) && { effort: a.effort }),
    })
  })

  on('command.run', { command: 'route' }, async ($, e) => {
    const [cmd, arg1, arg2] = e.args.trim().toLowerCase().split(/\s+/)
    const set = (fn: (s: RouteSettings) => RouteSettings) => update($, settingsAtom, fn)

    switch (cmd) {
      case 'on':
      case 'off':
        await set(s => ({ ...s, isEnabled: cmd === 'on' }))
        if (cmd === 'off') $.ui.status(undefined)
        return { text: `auto-route ${cmd}` }
      case 'llm':
        if (arg1 !== 'on' && arg1 !== 'off') return { text: HELP }
        await set(s => ({ ...s, isLlmRefined: arg1 === 'on' }))
        return { text: `haiku refinement ${arg1}` }
      case 'pin': {
        const model = arg1 as Model
        const effort = (arg2 ?? 'high') as Effort
        if (!MODELS.includes(model) || !EFFORTS.includes(effort)) return { text: HELP }
        await set(s => ({ ...s, pin: { model, effort } }))
        $.ui.status(`route ${label({ model, effort })} · pinned`)
        return { text: `pinned ${label({ model, effort })}` }
      }
      case 'unpin':
        await set(s => ({ ...s, pin: null }))
        return { text: 'unpinned; auto-routing from the next prompt' }
      case undefined:
      case '':
      case 'status': {
        const [s, r] = await Promise.all([read($, settingsAtom), read($, routeAtom)])
        const state = `${s.isEnabled ? 'on' : 'off'}, llm ${s.isLlmRefined ? 'on' : 'off'}${s.pin ? `, pinned ${label(s.pin)}` : ''}`
        const cur = r ? `${label(r)} (T${r.tier}, ${r.source}: ${r.reason})` : 'none yet'
        return { text: `auto-route ${state}\ncurrent: ${cur}\n\n${HELP}` }
      }
      default:
        return { text: HELP }
    }
  })
}
