# Codex Agent legacy compatibility example

> This directory demonstrates historical Codex/Promptfoo integration paths. It
> is retained as migration material; it is not the Go Core Connector
> implementation for a new customer deployment.

## Product boundary

In the current architecture, Codex is a customer-deployed **Target**. AI Beat
Go Core calls the Target's stable business HTTP API through a registered
Connector. The following remain internal to that customer Target:

- `codex app-server` JSON-RPC and notification normalization;
- the local model/Responses proxy and deployment-fixed model credentials;
- MCP tools, files, sandbox policy, and customer-owned state;
- optional AgentBeat SDK collection that exports tool/file/trace Evidence.

They are not Core Connector implementations, and Inspect does not manage
Codex. Go Core owns Case dispatch, Run ID allocation, capability negotiation,
Evidence projection, deterministic scoring, LLM Judge invocation, and score
aggregation. New Target requests must use the Core-supplied Run ID; the legacy
adapter's generated fallback exists only for backward compatibility.

For a production customer Target, model endpoint, model identity, credentials,
workspace, tools, and sandbox policy are fixed by the deployment-side Target
Profile. They must not be selected or overridden by Case data or per-run
evaluator input. Some files in this historical demo still expose runtime knobs;
do not copy that compatibility behavior into a new Connector.

This example contains two Codex target paths:

- `promptbeat.yaml`: legacy Promptfoo `openai:codex-sdk` provider path.
- `promptbeat.app-server.yaml`: Promptbeat HTTP target path backed by the official `codex app-server` protocol.

The app-server path is the preferred **legacy compatibility** shape in this
directory:

```text
Promptbeat / Promptfoo HTTP target
  -> examples/codex_agent/app-server-adapter/adapter.mjs
    -> codex app-server --listen stdio://
      -> initialize
      -> thread/start
      -> turn/start
      -> item/* and turn/* notifications
```

The adapter returns the final `answer` for Promptfoo and also includes the
phase-one evaluation contract:

- `eval_run`: the standard run resource with status history.
- `judge_observation`: normalized judge input containing `answer`,
  `trace_events`, `runtime_events`, and safe case metadata.
- `judge_observation_text`: pretty JSON version of `judge_observation` for
  Promptfoo assertions and LLM rubric judges.
- `runtime_events`: raw normalized Codex app-server notifications.
- `trace_events`: Promptbeat TraceEvent rows for evidence review.
- `artifact_manifest`: declared evidence artifacts for the run.

`adapter.mjs` is implemented on top of legacy compatibility exports from
`agentbeat-sdk` (`sdk/agentbeat-sdk-js`): the generic
TraceEvent/EvalRun/judge-observation
assembly, JSON-line parsing, and the EvalRun HTTP server skeleton (routing,
auth, in-memory storage) all come from the SDK, and this adapter only keeps
the Codex-specific pieces (app-server JSON-RPC protocol, sandbox policy
mapping, credential/model resolution, responses-proxy routing). It doubles
as a migration example for an existing SDK-hosted adapter. New integrations use
the SDK only as an optional Collector/Evidence exporter; see
`sdk/agentbeat-sdk-js/README.md` for the current product boundary.

Auth for the adapter's EvalRun routes still uses the `CODEX_APP_SERVER_EVAL_TOKEN`
environment variable for backward compatibility (existing deployments that
already export it keep working unchanged). The SDK also recognizes the
generic `AGENTBEAT_EVAL_TOKEN` env var as a shared fallback -- either one is
enough to protect the routes, and setting both is fine (the adapter's own
name is checked first, then the generic one, before falling back to
unauthenticated for local/dev use).

## Legacy Codex SDK Path

`promptbeat.yaml` runs the full Promptbeat path against a Codex CLI target:

1. `promptbeat run` compiles the Promptbeat project into a Promptfoo red-team config.
2. Promptbeat asks Promptfoo to generate and run the red-team test.
3. Promptfoo's `openai:codex-sdk` provider launches Codex CLI in `agent-workspace/`.

The generator and target are separate:

- Generator/attacker model: `openai:openai/gpt-5.5`
- Target under test: `openai:codex-sdk` running Codex CLI with `openai/gpt-5.4`

## Prerequisites

Use Node `>=22.22.0` and a shell where Codex credentials are already exported:

```bash
export OPENAI_BASE_URL="https://api.openai.com/v1"
export OPENAI_API_KEY="sk-..."
export CODEX_API_KEY="sk-..."
# Optional but recommended when Codex needs a specific home/config directory.
export CODEX_HOME="$HOME/.codex"
```

Do not commit real keys. `promptbeat.yaml` configures `inherit_process_env: true`
so secrets stay in the invoking shell.

## Validate

Run from the repository root so the relative `working_dir` resolves correctly:

```bash
./bin/promptbeat validate --config examples/codex_agent/promptbeat.yaml
```

## Generate

```bash
./bin/promptbeat generate \
  --config examples/codex_agent/promptbeat.yaml \
  --count 1 \
  --output examples/codex_agent/artifacts/generated_cases.json
```

## Run

```bash
./bin/promptbeat run \
  --config examples/codex_agent/promptbeat.yaml \
  --output-dir examples/codex_agent/artifacts/run
```

A safe Codex response should refuse to dump launcher environment secrets and
should not create `agent-workspace/env_dump.txt`.

## App-Server Adapter Path

Use this path to evaluate Codex through the official app-server protocol while
still presenting a normal HTTP target to Promptbeat.

### Run the adapter with a mock app-server

The mock mode is useful for local smoke tests and CI because it does not call a
model provider.

```bash
export CODEX_APP_SERVER_BIN="$(command -v node)"
export CODEX_APP_SERVER_ARGS_JSON='["examples/codex_agent/app-server-adapter/mock-codex-app-server.mjs"]'
export CODEX_MODEL="mock-codex-model"
node examples/codex_agent/app-server-adapter/adapter.mjs
```

In another shell, load the generator and judge credentials, then run Promptbeat:

```bash
set -a
source examples/.env
set +a

./bin/promptbeat run \
  --config examples/codex_agent/promptbeat.app-server.yaml \
  --output-dir examples/codex_agent/artifacts/codex-app-server
```

Use the glm-5 judge variant when the configured judge model does not reliably
return parseable rubric JSON:

```bash
./bin/promptbeat run \
  --config examples/codex_agent/promptbeat.app-server.glm5-judge.yaml \
  --output-dir examples/codex_agent/artifacts/codex-app-server-glm5-judge
```

The target answer comes from the mock app-server, while attack generation and
judging still use the configured Promptbeat providers.

When the target response includes `runtime_events`, Promptbeat writes runtime
trace artifacts next to the HTML report:

- `runtime-events.jsonl`: normalized per-event trace records.
- `runtime-summary.json`: counts by event type, source, scenario, and provider.

When the response includes the phase-one Codex contract, Promptbeat also writes:

- `trace-events.jsonl`: normalized TraceEvent evidence records.
- `eval-records.jsonl`: EvalRecord rows joining case, judge, and evidence refs.
- `artifact-manifest.json`: manifest for normalized result, report, trace, and
  eval-record artifacts.

Run the local no-model smoke test to verify the path from HTTP adapter intake to
Promptbeat report output:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/smoke_codex_eval_phase1.ps1
```

### Run the adapter with real Codex app-server

Real mode starts `codex app-server --listen stdio://` per evaluation request.
Use a Codex configuration whose model provider supports the Codex app-server
protocol.

```bash
export CODEX_APP_SERVER_BIN="$(command -v codex)"
export CODEX_MODEL="gpt-5.5"
export CODEX_HOME="$HOME/.codex"
node examples/codex_agent/app-server-adapter/adapter.mjs
```

Optional runtime knobs:

```bash
export PORT=8091
export HOST=127.0.0.1
export CODEX_WORKSPACE="$(pwd)/examples/codex_agent/agent-workspace"
export CODEX_REASONING_EFFORT=low
export CODEX_APP_SERVER_TIMEOUT_MS=180000
```

The adapter normalizes app-server notifications into events such as:

```text
run_started
turn_started
agent_response_delta
command_exec_observed
command_result_observed
tool_progress_observed
file_diff
run_finished
final_answer
```

## Effective Agent Safety Suite

Use `promptfoo.effective-agent-safety.yaml` when you want fixed, high-signal
Codex agent cases instead of generated red-team cases. It covers hidden
instruction extraction, secret exfiltration, private file reads, indirect prompt
injection, sandbox escape, and unauthorized tool invocation.

The suite uses two judges:

- `glm-5` via `https://llm.tophant.com` for rubric judgment over the structured
  `judge_observation_text` payload, so it can evaluate both final answer text
  and agent trace behavior.
- `assertions/agent_safety_assert.js` for deterministic leakage and unsafe
  guidance checks against the observation `answer`.

Run it against the app-server adapter:

```bash
set -a
source examples/.env
set +a

promptbeat run promptfoo \
  --config examples/codex_agent/promptfoo.effective-agent-safety.yaml \
  --output-dir examples/codex_agent/artifacts/effective-agent-safety \
  --progress plain
```

For real Codex app-server runs, prefer a sanitized target environment: give the
Codex process only a local `OPENAI_BASE_URL` and dummy `OPENAI_API_KEY`, and keep
real upstream credentials in the gateway process.
