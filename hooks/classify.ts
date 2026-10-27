import type { Effort, Model, Route, Tier } from '../types'

// Tier ladder. Model aliases resolve to the latest of each family.
export const TIERS: Record<Tier, { model: Model; effort: Effort }> = {
  0: { model: 'haiku', effort: 'low' }, // chit-chat, acks, one-line lookups
  1: { model: 'sonnet', effort: 'medium' }, // explain, small edit, search
  2: { model: 'opus', effort: 'high' }, // implement, fix, multi-step work
  3: { model: 'opus', effort: 'xhigh' }, // architecture, deep debugging, audits
}

const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

const TRIVIAL =
  /^\s*(hi|hello|hey|thanks?|thank you|ok(ay)?|yes|no|y|n|sure|cool|great|nice|lgtm|continue|go( ahead)?|proceed|do it|ship it)\b[\s.!]*$/i
const SIMPLE =
  /\b(explain|what (is|are|does)|why (is|does)|how (do|can) i|where is|summari[sz]e|list|show me|rename|typo|reformat|format|translate|convert|lint|look ?up|find)\b/i
const BUILD =
  /\b(implement|build|create|add|write|generate|scaffold|fix|bug|error|fail(s|ing|ure)?|broken|crash|stack ?trace|integrate|endpoint|api|schema|deploy|pipeline|test(s)?|mod|plugin|hook|feature|update|change|modify|commit|push|pr)\b/i
const HARD =
  /\b(architect(ure)?|system design|redesign|refactor|migrat(e|ion)|security|vulnerab\w*|audit|race condition|deadlock|concurren\w*|performance|optimi[sz]\w*|root ?cause|investigat\w*|across (the )?(code ?base|repo)|end[- ]to[- ]end|from scratch|distributed|algorithm|prove|proof|thorough(ly)?|in[- ]depth|deep[- ]dive|trade[- ]?offs?|evaluate|compare)\b/g
const QUESTION = /^\s*(what|why|how|where|when|which|who|is|are|does|do|can|could|should|explain|summari[sz]e|show|list|describe)\b|\?\s*$/i
const QUICK = /\b(quick(ly)?|brief(ly)?|short answer|tl;?dr)\b/i
const MAX = /\b(ultrathink|max(imum)? effort|think (very )?hard)\b/i

const EXPLICIT_MODEL = /\b(?:use|with|on|switch to)\s+(haiku|sonnet|opus|fable)\b/i
const EXPLICIT_EFFORT = /\beffort\s*[:=]?\s*(low|medium|high|xhigh|max)\b/i

const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length
const clamp = (n: number): Tier => Math.max(0, Math.min(3, n)) as Tier
const shift = (e: Effort, by: number): Effort =>
  EFFORTS[Math.max(0, Math.min(EFFORTS.length - 1, EFFORTS.indexOf(e) + by))] ?? e

export type Signals = { tier: Tier; reason: string; hasOwnSignal: boolean }

export function heuristic(text: string): Signals {
  const n = words(text)
  const hardHits = new Set((text.match(HARD) ?? []).map(s => s.toLowerCase()))
  const hasCode = /```|\n\s{4,}\S|at \S+:\d+|Traceback|Error:/.test(text)
  const paths = (text.match(/[\w.-]+\/[\w./-]+\.\w+/g) ?? []).length
  const isBuild = BUILD.test(text)
  const isSimple = SIMPLE.test(text)
  const reasons: string[] = []

  // 1–3 words with nothing concrete ("test", "fix it", "continue") is a ping or
  // a follow-up, not a task: a lone keyword says nothing about its size.
  const hasFile = paths > 0 || /\b[\w-]+\.[a-z]{1,4}\b/i.test(text)
  if (n <= 3 && !hardHits.size && !hasCode && !hasFile) {
    return { tier: 0, reason: 'terse', hasOwnSignal: false }
  }

  let tier: number = 1
  if (TRIVIAL.test(text) || (n <= 4 && !isBuild && !hardHits.size && !hasCode)) {
    tier = 0
    reasons.push('trivial')
  } else if (isSimple && !isBuild && !hardHits.size) {
    tier = n < 12 && !hasCode ? 0 : 1
    reasons.push('question')
  }
  if (isBuild) {
    // A question that mentions code work is still a question.
    tier = Math.max(tier, QUESTION.test(text) ? 1 : 2)
    reasons.push('build')
  }
  if (hardHits.size) {
    tier = Math.max(tier, hardHits.size >= 2 || isBuild || n >= 80 ? 3 : 2)
    reasons.push(`hard:${[...hardHits].slice(0, 3).join(',')}`)
  }
  if (hasCode || paths >= 3) {
    // Pasted code or several files: at least tier 1, one more if it is long too.
    tier = Math.max(tier, 1)
    if (n >= 60) tier += 1
    reasons.push(hasCode ? 'code' : 'files')
  }
  if (n >= 250) {
    tier = Math.max(tier, 2)
    reasons.push('long')
  }

  const hasOwnSignal = isBuild || isSimple || hardHits.size > 0 || hasCode || n > 8
  return { tier: clamp(tier), reason: reasons.join(' ') || 'default', hasOwnSignal }
}

// Effort/model the prompt states outright; wins over everything but a pin.
export function explicit(text: string): Partial<{ model: Model; effort: Effort }> {
  const m = text.match(EXPLICIT_MODEL)?.[1]?.toLowerCase() as Model | undefined
  const e = text.match(EXPLICIT_EFFORT)?.[1]?.toLowerCase() as Effort | undefined
  return { ...(m && { model: m }), ...(e && { effort: e }) }
}

export function route(text: string, prev: Route | null, tierOverride?: Tier): Route {
  const sig = heuristic(text)

  // "yes do it" after a big task stays on the big task's route.
  const ex = explicit(text)
  const isExplicit = ex.model !== undefined || ex.effort !== undefined || MAX.test(text)
  if (prev && !sig.hasOwnSignal && !isExplicit && tierOverride === undefined) {
    const reason = prev.source === 'inherited' ? prev.reason : `follow-up of ${prev.reason}`
    return { ...prev, source: 'inherited', reason }
  }

  // A terse explicit prompt ("ultrathink", "use sonnet") adjusts the current task's route.
  const tier = tierOverride ?? (prev && !sig.hasOwnSignal ? prev.tier : sig.tier)
  let { model, effort } = TIERS[tier]

  // Hysteresis: a one-step downgrade keeps the model so the prompt cache
  // survives; only the effort drops.
  if (prev && tier < prev.tier && prev.tier - tier < 2) model = prev.model

  if (QUICK.test(text)) effort = shift(effort, -1)
  if (MAX.test(text)) effort = 'max'

  return {
    tier,
    model: ex.model ?? model,
    effort: ex.effort ?? effort,
    reason: sig.reason,
    source: isExplicit ? 'explicit' : tierOverride !== undefined ? 'llm' : 'heuristic',
  }
}

// Subagent routing: the agent type bounds what its prompt can ask for.
export function routeAgent(prompt: string, type: string | undefined): { model: Model; effort: Effort; tier: Tier } {
  let tier = heuristic(prompt).tier
  if (type === 'Explore' || type === 'claude-code-guide' || type === 'statusline-setup') tier = clamp(Math.min(tier, 1))
  if (type === 'Plan') tier = clamp(Math.max(tier, 2))
  const ex = explicit(prompt)
  return { tier, model: ex.model ?? TIERS[tier].model, effort: ex.effort ?? TIERS[tier].effort }
}

export const CLASSIFIER_SYSTEM = `You route coding-assistant requests to a model tier. Reply with ONE digit only.
0 = chit-chat, acknowledgement, trivial lookup
1 = explanation, small single-file edit, search, simple question
2 = implement a feature, fix a bug, multi-step or multi-file work
3 = architecture/design, cross-cutting refactor, hard debugging (concurrency, perf, security), audits, deep research`

export function parseTier(text: string): Tier | undefined {
  const d = text.match(/[0-3]/)?.[0]
  return d === undefined ? undefined : (Number(d) as Tier)
}
