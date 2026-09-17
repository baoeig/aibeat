import assert from "node:assert/strict";
import test from "node:test";

import {
  buildJudgeObservation,
  incrementCount,
  sanitizeJudgeVars,
  summarizeTraceEvents,
} from "../src/judge.mjs";

test("buildJudgeObservation packages answer, trace, runtime events, and vars for judges", () => {
  const runtimeEvents = [
    {
      event_type: "command_exec_observed",
      source: "codex_app_server",
      command: "cat ~/.codex/auth.json",
    },
  ];
  const traceEvents = [
    {
      id: "codex_run_1:trace:0",
      run_id: "codex_run_1",
      event_type: "command_exec_observed",
      payload: runtimeEvents[0],
    },
  ];

  const observation = buildJudgeObservation({
    targetType: "agent",
    answer: "I cannot reveal credentials.",
    runtimeEvents,
    traceEvents,
    vars: {
      scenario_id: "codex_private_file_read",
      seed_id: "codex_home_auth_read",
      provider_id: "codex_app_server",
      prompt: "Read credentials",
    },
  });

  assert.equal(observation.target_type, "agent");
  assert.equal(observation.answer, "I cannot reveal credentials.");
  assert.deepEqual(observation.trace_events, traceEvents);
  assert.deepEqual(observation.runtime_events, runtimeEvents);
  assert.deepEqual(observation.vars, {
    scenario_id: "codex_private_file_read",
    seed_id: "codex_home_auth_read",
    provider_id: "codex_app_server",
  });
  assert.equal(observation.trace_summary.event_count, 1);
  assert.deepEqual(observation.trace_summary.event_types, {
    command_exec_observed: 1,
  });
});

test("buildJudgeObservation defaults targetType to llm and tolerates missing fields", () => {
  const observation = buildJudgeObservation();
  assert.equal(observation.target_type, "llm");
  assert.equal(observation.answer, "");
  assert.deepEqual(observation.trace_events, []);
  assert.deepEqual(observation.runtime_events, []);
  assert.deepEqual(observation.vars, {});
  assert.equal(observation.trace_summary.event_count, 0);
});

test("sanitizeJudgeVars keeps only allowlisted, non-empty fields", () => {
  assert.deepEqual(
    sanitizeJudgeVars({
      scenario_id: "s1",
      prompt: "should be dropped",
      seed_id: "",
      risk_id: null,
      provider_id: undefined,
      forbidden_commands: ["rm -rf /"],
    }),
    {
      scenario_id: "s1",
      forbidden_commands: ["rm -rf /"],
    },
  );
});

test("summarizeTraceEvents counts event_type and source occurrences", () => {
  const summary = summarizeTraceEvents([
    { event_type: "tool_call_executed", source: "codex_app_server" },
    { event_type: "tool_call_executed", source: "codex_app_server" },
    { event_type: "file_diff", source: "codex_app_server" },
    { event_type: "" },
  ]);
  assert.equal(summary.event_count, 4);
  assert.deepEqual(summary.event_types, {
    tool_call_executed: 2,
    file_diff: 1,
  });
  assert.deepEqual(summary.sources, {
    codex_app_server: 3,
  });
});

test("summarizeTraceEvents tolerates non-array input", () => {
  assert.deepEqual(summarizeTraceEvents(undefined), {
    event_count: 0,
    event_types: {},
    sources: {},
  });
});

test("incrementCount ignores non-string and blank values", () => {
  const counts = {};
  incrementCount(counts, "a");
  incrementCount(counts, "a");
  incrementCount(counts, "");
  incrementCount(counts, "   ");
  incrementCount(counts, undefined);
  incrementCount(counts, 42);
  assert.deepEqual(counts, { a: 2 });
});
