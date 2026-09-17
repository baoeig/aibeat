---
name: promptbeat-select-risk-pack
description: Use when a user needs help choosing PromptBeat model risks, scenarios, local seeds, dataset subscriptions, or a small first-test scope.
---

# Select a PromptBeat Risk Scope

Work from the extracted full package root. Ask which model behavior the user
wants to test, then inspect existing scenarios and seeds. Do not invent a risk
pack, directory, CLI flag, coverage claim or compliance certification.

## Choose a starting point

| Need | Existing project | Prerequisite |
| --- | --- | --- |
| No-key local preview | `examples/bootstrap/promptbeat.yaml` | Included in the v0.2 full package. Do not run a remote evaluation yet. |
| A small model evaluation | `examples/llm-basic/promptbeat.yaml` | Provider environment variables are required for validation and the full run. |
| Model safety baseline | `examples/llm-safety-baseline/promptbeat.yaml` | Inspect its config, scenarios, seeds and provider requirements. |
| Example regulatory risk mapping | `examples/china-compliance/promptbeat.yaml` | Example mappings are not proof of legal compliance. |
| Dataset subscriptions | `examples/dataset-subscriptions/safety-baseline/promptbeat.yaml` | Raw datasets are separate; inspect `subscriptions/safety-baseline.yaml` and obtain authorized local data. |

If the target is a black-box HTTP Agent, explain AgentBeat instead. Legacy
`http-agent` and coding-agent package examples do not redefine PromptBeat as the
current AgentBeat evaluator.

## Preview the selected scope

From the package root, macOS/Linux:

```bash
mkdir -p artifacts
./bin/promptbeat validate --config examples/bootstrap/promptbeat.yaml
./bin/promptbeat generate --config examples/bootstrap/promptbeat.yaml --count 5 --output artifacts/cases.json
```

Windows PowerShell:

```powershell
New-Item -ItemType Directory -Force artifacts | Out-Null
.\bin\promptbeat.cmd validate --config examples\bootstrap\promptbeat.yaml
.\bin\promptbeat.cmd generate --config examples\bootstrap\promptbeat.yaml --count 5 --output artifacts\cases.json
```

For another project, substitute the existing config path and resolve its
prerequisites first. `--count 5` is an upper bound, not a promise of five cases.
Inspect `artifacts/cases.json`; no target has been evaluated by `generate`.

Keep risks together in an existing project unless a real requirement justifies
editing its local config. Do not invent `--pack`, `--quick`, `-c`, or a registry
URL. Use `scenarios list` only for built-in discovery, not as proof that every
example-local scenario is registered.

## Before a full run

Use `promptbeat-run-quick-eval` to choose the command. Explain which providers
will receive test content, and ask permission for any model cost, dataset
download or target side effects. Do not fetch raw datasets or start model calls
merely because the user asked to select a risk. Never read or print credentials.
