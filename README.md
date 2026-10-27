# auto-route

Routes every new task to the cheapest model + effort that fits it.

- **Main prompts** (`prompt.submit` → `turn.step`): a keyword/structure heuristic scores the prompt into tiers 0–3; for non-trivial prompts haiku refines the tier (5 s timeout, ~4 output tokens, falls back to the heuristic). The route is applied to every model request of the main loop.
- **Subagents** (`tool.call` on `Agent`): `model`/`effort` are filled in from the agent's prompt when the caller left them out. `Explore`/guide agents are capped at tier 1, `Plan` floored at tier 2; forks are untouched.

| Tier | Model | Effort | Typical prompt |
|---|---|---|---|
| 0 | haiku | – | ack, greeting, one-line lookup |
| 1 | sonnet | medium | explain, question, small edit |
| 2 | opus | high | implement, fix, multi-step |
| 3 | opus | xhigh | architecture, refactor/migration, hard debugging, audits |

Rules: short follow-ups ("yes, go ahead") inherit the previous route; a one-tier downgrade keeps the model (prompt cache survives) and only lowers effort; `quick`/`briefly` drops effort one step; `ultrathink`/`max effort` sets `max`; `use <model>` / `effort: <level>` in the prompt wins.

Commands: `/route` (status), `/route on|off`, `/route llm on|off`, `/route pin <model> [effort]`, `/route unpin`.

## Install

At the prompt of a terminal session:

```
/plugin install auto-route --marketplace supershoim/claude-auto-route
```

From a shell:

```
claude plugin install auto-route --marketplace supershoim/claude-auto-route
```

Answer `y` to add the marketplace, then pick the **user** scope: the plugin then runs in every session you start, in every project.

In the desktop app (where `/plugin` does not run): click + next to the prompt box → Plugins → Add marketplace `supershoim/claude-auto-route` → Add plugin.

## Apply globally without an install step

Each Claude Code on the web session starts in a fresh container, so a user-scope install there does not carry over. To make it apply in **every** session (local or cloud) automatically, put this in `~/.claude/settings.json` (all projects on that machine) or in a repo's `.claude/settings.json` (every session on that repo, including cloud ones):

```json
{
  "extraKnownMarketplaces": {
    "auto-route": { "source": { "source": "github", "repo": "supershoim/claude-auto-route" } }
  },
  "enabledPlugins": { "auto-route@auto-route": true }
}
```
