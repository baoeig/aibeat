import assert from "node:assert/strict";
import test from "node:test";

import { buildArtifactManifest, buildEvalRun, buildEvalRunLinks } from "../src/evalRun.mjs";

test("buildEvalRunLinks exposes standard EvalRun resource endpoints", () => {
  assert.deepEqual(buildEvalRunLinks("codex_run_1"), {
    self: "/v1/eval/runs/codex_run_1",
    events: "/v1/eval/runs/codex_run_1/events",
    artifacts: "/v1/eval/runs/codex_run_1/artifacts",
  });
});

test("buildEvalRunLinks encodes run ids for URL-safety", () => {
  assert.deepEqual(buildEvalRunLinks("run with space/slash"), {
    self: "/v1/eval/runs/run%20with%20space%2Fslash",
    events: "/v1/eval/runs/run%20with%20space%2Fslash/events",
    artifacts: "/v1/eval/runs/run%20with%20space%2Fslash/artifacts",
  });
});

test("buildEvalRun produces a succeeded status history and metrics by default", () => {
  const evalRun = buildEvalRun("run_1", "completed", {
    latency_ms: 42,
    runtime_event_count: 5,
    trace_event_count: 5,
  });

  assert.equal(evalRun.id, "run_1");
  assert.equal(evalRun.status, "succeeded");
  assert.equal(evalRun.protocol_version, "agentbeat.eval.v1");
  assert.equal(evalRun.target, "agent");
  assert.deepEqual(
    evalRun.status_history.map((entry) => entry.status),
    ["queued", "running", "judging", "reporting", "succeeded"],
  );
  assert.deepEqual(evalRun.metrics, {
    latency_ms: 42,
    runtime_event_count: 5,
    trace_event_count: 5,
  });
  assert.deepEqual(evalRun.links, buildEvalRunLinks("run_1"));
});

test("buildEvalRun marks status failed only when explicitly failed", () => {
  assert.equal(buildEvalRun("run_2", "failed").status, "failed");
  assert.equal(buildEvalRun("run_3", "anything-else").status, "succeeded");
});

test("buildEvalRun fills in default metrics when omitted", () => {
  const evalRun = buildEvalRun("run_4", "completed");
  assert.deepEqual(evalRun.metrics, {
    latency_ms: null,
    runtime_event_count: 0,
    trace_event_count: 0,
  });
});

test("buildArtifactManifest lists eval-run, raw-events, and trace-events artifacts", () => {
  const traceEvents = [{ id: "run_1:trace:0" }, { id: "run_1:trace:1" }];
  const runtimeEvents = [{ event_type: "a" }, { event_type: "b" }, { event_type: "c" }];
  const manifest = buildArtifactManifest("run_1", traceEvents, runtimeEvents);

  assert.equal(manifest.run_id, "run_1");
  assert.equal(manifest.protocol_version, "agentbeat.eval.v1");
  assert.equal(manifest.artifacts.length, 3);

  const kinds = manifest.artifacts.map((artifact) => artifact.kind);
  assert.deepEqual(kinds, ["eval_run_json", "raw_events_jsonl", "trace_events_jsonl"]);

  const rawArtifact = manifest.artifacts.find((artifact) => artifact.kind === "raw_events_jsonl");
  assert.equal(rawArtifact.event_count, 3);

  const traceArtifact = manifest.artifacts.find((artifact) => artifact.kind === "trace_events_jsonl");
  assert.equal(traceArtifact.event_count, 2);
});

test("buildEvalRun and buildArtifactManifest accept explicit protocol_version/target overrides", () => {
  const evalRun = buildEvalRun("run_5", "completed", {}, {
    protocolVersion: "promptbeat.codex-eval.v1",
    target: "codex-app-server",
  });
  assert.equal(evalRun.protocol_version, "promptbeat.codex-eval.v1");
  assert.equal(evalRun.target, "codex-app-server");

  const manifest = buildArtifactManifest("run_5", [], [], { protocolVersion: "promptbeat.codex-eval.v1" });
  assert.equal(manifest.protocol_version, "promptbeat.codex-eval.v1");
});
