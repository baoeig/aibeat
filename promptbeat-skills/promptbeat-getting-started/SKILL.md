---
name: promptbeat-getting-started
description: Use when a user has downloaded PromptBeat, wants a first local model or Prompt test, or needs help choosing the next supported command.
---

# PromptBeat Getting Started

## Start with the package

Ask where the full package was extracted if the path is unknown. Confirm that
`bin/promptbeat` (macOS/Linux) or `bin/promptbeat.cmd` (Windows) and `examples/`
exist. Use that package root as the working directory. A Skills ZIP does not
contain the executable or runtime; the PromptBeat v0.2 full package does.

Do not send a package user to `core/go` or invent an installer. The public
repository is https://github.com/tophant-ai/aibeat and full packages are at
https://github.com/tophant-ai/aibeat/releases/tag/v0.2.

## Ask what they want to test

PromptBeat is for model and Prompt responses. An AI coding assistant can use
these Skills to operate PromptBeat; that does not make the assistant the test
target. For black-box HTTP Agent tasks, explain the separate AgentBeat product.
The older public AgentBeat adapter preview is not an `agentbeat eval-run` release.
Do not route a new AgentBeat user through a legacy PromptBeat agent example.

## First local preview: no API key

When the user wants to try the package before connecting a model, use the bundled
bootstrap example. Validation and deterministic case preview do not call models.

macOS/Linux, from the extracted package root:

```bash
./bin/promptbeat --version
mkdir -p artifacts
./bin/promptbeat validate --config examples/bootstrap/promptbeat.yaml
./bin/promptbeat generate --config examples/bootstrap/promptbeat.yaml --count 5 --output artifacts/cases.json
```

Windows PowerShell, from the extracted package root:

```powershell
.\bin\promptbeat.cmd --version
New-Item -ItemType Directory -Force artifacts | Out-Null
.\bin\promptbeat.cmd validate --config examples\bootstrap\promptbeat.yaml
.\bin\promptbeat.cmd generate --config examples\bootstrap\promptbeat.yaml --count 5 --output artifacts\cases.json
```

Inspect `artifacts/cases.json`. The count is an upper bound. These are test inputs,
not evaluation results. Do not report a score, a pass, or an HTML report from this
step. `examples/llm-basic/promptbeat.yaml` validation requires provider variables;
it is not the zero-configuration first step.

## Choose the next Skill

| Need | Next Skill |
| --- | --- |
| Run an existing project or inspect results | `promptbeat-run-quick-eval` |
| Choose model risks or local seeds | `promptbeat-select-risk-pack` |
| Use a coding assistant or understand legacy integration limits | `promptbeat-connect-coding-agent` |
| Diagnose an error | `promptbeat-debug-run` |

For a full model evaluation, inspect `examples/llm-basic/README.md` and its
provider configuration. Confirm endpoints, test scope and cost with the user
before `run`, `eval` or dataset generation. Keep credentials in local environment
variables; never request or print their values. Do not download datasets, change
credentials, or execute a remote evaluation merely because a Skill was loaded.
