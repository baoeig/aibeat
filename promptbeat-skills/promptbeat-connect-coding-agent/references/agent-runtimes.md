# Legacy runtime integration reference

This file helps identify existing package layouts. It is not a current AgentBeat
quickstart or evidence that an adapter works in the user's environment.

## Identify the installation first

| Existing setup | Where to inspect | What must still be checked |
| --- | --- | --- |
| Codex examples | `examples/codex_agent/` | Installed runtime, provider settings, allowed workspace and actual captured output. |
| Claude Code provider template | `examples/agent-adapters/claude-code/` | A real runtime wrapper; a YAML template is not a working integration. |
| OpenCode provider template | `examples/agent-adapters/opencode/` | Actual SDK/server wiring and compatibility. |
| OpenClaw provider template | `examples/agent-adapters/openclaw/` | Gateway configuration and user-approved access. |

Read the selected installation's README and CLI help before choosing commands.
Do not claim that an old adapter protocol implements the current black-box
Target protocol or that a captured trace is independently verified state.

## Config types remain different

- A PromptBeat project YAML is for `validate`, local `generate`, or full `run`.
- An existing backend YAML is for `eval`; its technical schema and options retain
  names such as `promptfoo` and `--provider-file`.
- Cases JSON is a local input artifact, not an `eval` configuration.
- `report --input` reads an existing result; it does not run the target again.

A complete evaluation may invoke models and allow actions in a target workspace.
Confirm scope and costs first. Do not copy credentials into configs, prompts,
logs or reports. Final response alone does not prove what tools or files changed.

## Current AgentBeat

Do not route a new user to these legacy adapters as the default. The independent
AgentBeat HTTP evaluator needs its matching CLI/release and deployment contract.
The public preview executable's `adapter check`/`run` interface does not provide
`agentbeat eval-run`. Loading this reference cannot close that release gap.
