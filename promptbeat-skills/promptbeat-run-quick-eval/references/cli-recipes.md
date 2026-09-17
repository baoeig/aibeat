# CLI recipes

Run from the extracted full PromptBeat package root. These are command templates,
not recorded successful evaluations. Confirm provider configuration and user
approval before any full run or eval; both can call models and incur costs.

## Local preview without keys

```bash
mkdir -p artifacts
./bin/promptbeat validate --config examples/bootstrap/promptbeat.yaml
./bin/promptbeat generate --config examples/bootstrap/promptbeat.yaml --count 5 --output artifacts/cases.json
```

PowerShell:

```powershell
New-Item -ItemType Directory -Force artifacts | Out-Null
.\bin\promptbeat.cmd validate --config examples\bootstrap\promptbeat.yaml
.\bin\promptbeat.cmd generate --config examples\bootstrap\promptbeat.yaml --count 5 --output artifacts\cases.json
```

The case count is an upper bound. Inspect this local JSON as test inputs, not
results. `generate` does not create the backend YAML used by `eval`.

## Full project run after provider setup and approval

Read `examples/llm-basic/README.md` and configure the referenced environment
variables locally. Do not ask for, print or save their secret values.

```bash
./bin/promptbeat validate --config examples/llm-basic/promptbeat.yaml
./bin/promptbeat run --config examples/llm-basic/promptbeat.yaml --output-dir artifacts/llm-basic/run
```

PowerShell uses `.\bin\promptbeat.cmd` with the same arguments and Windows paths.
`run` compiles configuration, generates/evaluates cases and parses results. A
standalone local `generate` is not a required input to this pipeline.

## Existing backend YAML

Use only an existing backend config, never a PromptBeat project YAML or cases
JSON. Technical names such as `promptfoo-result.json` are retained unchanged.

```bash
./bin/promptbeat eval --config path/to/promptfoo.yaml --output-dir artifacts/eval
```

Direct `eval` writes backend artifacts such as `promptfoo-result.json`. Do not
promise a normalized result or HTML report from this command alone.

## View a completed result

After a successful project run, inspect `evaluation_result.json` and `report.html`
under the run output directory. To render HTML again:

```bash
./bin/promptbeat report --input artifacts/llm-basic/run/evaluation_result.json --output artifacts/llm-basic/run/report.html
```

For a direct `eval` result:

```bash
./bin/promptbeat report --input artifacts/eval/promptfoo-result.json --output artifacts/eval/report.html
```

Do not invent result counts, scores or output paths. Check the filesystem and
command exit status. `report` is a local operation, not a rerun of the target.
