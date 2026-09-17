---
name: promptbeat-connect-coding-agent
description: Use when a user wants a coding assistant to operate PromptBeat, asks about a coding-agent integration, or needs to distinguish legacy adapters from current AgentBeat evaluation.
---

# PromptBeat and Coding Assistants

## Decide which side the assistant is on

Ask whether the coding assistant will **help run PromptBeat** or is itself the
**system under test**. Do not conflate these tasks.

### Use an assistant to run PromptBeat

Load a complete Skill directory into a runtime that supports `SKILL.md`, including
its `references/` directory. Use the runtime's documented install location; do not
invent a universal `npx` command or assume all tools use the same directory.
Start a fresh session and provide the extracted PromptBeat package path.

Use `promptbeat-getting-started` or `promptbeat-run-quick-eval` for the initial
local bootstrap validation and case preview. If the runtime cannot discover
Skills, explicitly attach the selected `SKILL.md` and let it read its references.
This fallback is manual instruction loading, not automatic Skill installation.

### Evaluate the assistant as a target

PromptBeat's documented product scope is Model/Prompt evaluation. Black-box HTTP
Agent tasks belong to the independent AgentBeat evaluator. L1 requires a matching
HTTP invocation contract; L2 evidence is optional; L3 requires an independent
state controller. A Skill does not implement those integrations.

The public `v0.3-agentbeat-preview.1` binary is an older adapter orchestrator,
not the new `agentbeat eval-run` evaluator. Do not present it as a compatible
release or suggest a public-source build without verifying the required files.

## Legacy integrations

Only when maintaining an existing legacy setup, read
`references/agent-runtimes.md`. Package examples are not evidence of a verified
runtime. Require version compatibility, explicit user approval, an isolated test
workspace and real evidence before making claims about agent actions.

Do not change sandbox policies, download tools, inspect credentials, start agent
processes or call model providers simply to load or test a Skill.
