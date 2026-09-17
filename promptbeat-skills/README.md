# AIBeat Skill

Instruction packs that help a coding assistant operate AI Beat evaluation tools.
AIBeat Skill serves as the unified umbrella for assistant skills across AI Beat
products. This package currently contains five PromptBeat workflows covering
first use, command selection, risk selection, troubleshooting, and integration
boundaries, plus one AgentBeat workflow for writing evaluation cases. More
AgentBeat evaluation skills will be added in future releases; the older public
adapter preview does not provide `agentbeat eval-run`. They are instruction
definitions, not executables or automatic installers.

## Get the product first

The full PromptBeat v0.2 packages include the CLI, examples and evaluation runtime:
https://github.com/tophant-ai/aibeat/releases/tag/v0.2

The standalone Skills ZIP contains instructions, references, and the
`agentbeat-write-agent-cases` local packer (`scripts/pack.py` plus its schema
and taxonomy files). It still does not include the PromptBeat CLI or an
evaluation runtime. The canonical
download is `aibeat-skill.zip` (user-facing root `aibeat-skill/`), and the legacy
archive `promptbeat-skills.zip` (root `promptbeat-skills/`) is retained for compatibility.
Both are built from this directory for the website; they are not separate GitHub releases.
PromptBeat tests Model/Prompt responses. AgentBeat is a separate HTTP Agent
evaluator; the older public adapter preview does not provide `agentbeat eval-run`.

## Load one Skill

1. Extract the ZIP (`aibeat-skill.zip` or `promptbeat-skills.zip`). Keep each `promptbeat-*` folder intact, including `references/`.
2. Copy the selected folder to the skill directory supported by your coding tool.
   For Claude Code, a project-local path is
   `.claude/skills/promptbeat-run-quick-eval/`. For Codex, use
   `.agents/skills/promptbeat-run-quick-eval/` in the project. Check your installed
   tool's documentation if it uses a different location. Do not overwrite an
   existing Skill without reviewing local changes.
3. Open a fresh session in that project. If automatic discovery is unavailable,
   explicitly attach `SKILL.md` and give access to its adjacent references.
4. Provide your extracted **product package** path, not just the Skills path.

First task to copy (replace the package path):

> Use promptbeat-run-quick-eval. My PromptBeat package is at <package-path>.
> Validate examples/bootstrap/promptbeat.yaml and preview up to five local cases
> in artifacts/cases.json. Do not call models or change credentials. Show me
> where the output is saved.

Loading a Skill does not grant approval to call providers or start a target.
For a full evaluation, review the model endpoints, credentials, scope and costs
first. Keep secrets out of prompts, YAML and generated artifacts.

## Included Skills

| Directory | Job |
| --- | --- |
| `promptbeat-getting-started` | Find the package and complete a first local preview. |
| `promptbeat-run-quick-eval` | Choose validate, generate, run, eval or report. |
| `promptbeat-select-risk-pack` | Choose existing model scenarios and local seeds. |
| `promptbeat-debug-run` | Diagnose path, config, provider and result errors. |
| `promptbeat-connect-coding-agent` | Distinguish using a coding assistant from evaluating one; identify legacy integration limits. |
| `agentbeat-write-agent-cases` | Write, extend or validate AgentBeat security evaluation cases in the 21-field `agent-case-only-v1` contract, then pack JSONL with the bundled `scripts/pack.py`. |

## Source and verification

This directory is the versioned source. Website packaging uses an explicit
Markdown allowlist, retains references, and excludes `test-scenarios/`. The ZIP
contains a SHA-256 manifest. Run `npm --prefix website run build:skills` after
changing these instructions and `npm --prefix website run check:skills` to check
reproducibility and source alignment. No provider calls are involved.

The historical pressure-test notes in `test-scenarios/` are not evidence for this
revision. Loading/discovery depends on the user's coding runtime; CLI integration
tests do not prove autonomous assistant behavior.
