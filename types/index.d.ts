export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type Model = 'haiku' | 'sonnet' | 'opus' | 'fable'
export type Tier = 0 | 1 | 2 | 3

export type Route = {
  tier: Tier
  model: Model
  effort: Effort
  reason: string
  source: 'heuristic' | 'llm' | 'explicit' | 'pinned' | 'inherited'
}

export type RouteSettings = {
  isEnabled: boolean
  // Ask haiku to refine the heuristic tier on non-trivial prompts.
  isLlmRefined: boolean
  // Append a one-line route footer under each answer (the one display every surface shows).
  isFooterShown: boolean
  // Have the model open each reply with the route line: the one display that lands
  // in the stored transcript, so it shows in the app for cloud sessions too.
  isEchoed: boolean
  // Fixed route that bypasses classification.
  pin: { model: Model; effort: Effort } | null
}

declare module 'claude-code' {
  interface PluginState {
    'auto-route': {
      route: Shaped<Route | null>
      settings: Shaped<RouteSettings>
    }
  }
}
