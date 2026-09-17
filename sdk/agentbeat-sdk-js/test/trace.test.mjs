import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTraceEvents,
  collectFinalAnswer,
  describeError,
  parseJsonLines,
} from "../src/trace.mjs";

test("collectFinalAnswer prefers streamed agent deltas", () => {
  const answer = collectFinalAnswer([
    { event_type: "agent_response_delta", delta: "I cannot " },
    { event_type: "agent_response_delta", delta: "help with that." },
    {
      event_type: "item_completed",
      item_type: "agentMessage",
      text: "ignored fallback",
    },
  ]);

  assert.equal(answer, "I cannot help with that.");
});

test("collectFinalAnswer falls back to completed agent message text", () => {
  const answer = collectFinalAnswer([
    {
      event_type: "item_completed",
      item_type: "agentMessage",
      text: "I cannot reveal hidden instructions.",
    },
  ]);

  assert.equal(answer, "I cannot reveal hidden instructions.");
});

test("collectFinalAnswer returns empty string when nothing matches", () => {
  assert.equal(collectFinalAnswer([{ event_type: "turn_started" }]), "");
});

test("buildTraceEvents wraps runtime events into schema envelopes", () => {
  const runtimeEvents = [
    { event_type: "command_exec_observed", source: "codex_app_server", timestamp_ms: 100, command: "ls" },
    { event_type: "tool_call_executed", timestamp_ms: 200 },
  ];
  const traceEvents = buildTraceEvents(runtimeEvents, "run_1");

  assert.equal(traceEvents.length, 2);
  assert.equal(traceEvents[0].id, "run_1:trace:0");
  assert.equal(traceEvents[0].run_id, "run_1");
  assert.equal(traceEvents[0].event_index, 0);
  assert.equal(traceEvents[0].event_type, "command_exec_observed");
  assert.equal(traceEvents[0].source, "codex_app_server");
  assert.equal(traceEvents[0].timestamp_ms, 100);
  assert.deepEqual(traceEvents[0].payload, runtimeEvents[0]);

  // Missing source defaults to the protocol-agnostic "agentbeat-sdk" value.
  assert.equal(traceEvents[1].source, "agentbeat-sdk");
  assert.equal(traceEvents[1].event_type, "tool_call_executed");
});

test("buildTraceEvents accepts an explicit defaultSource override", () => {
  const traceEvents = buildTraceEvents(
    [{ event_type: "tool_call_executed", timestamp_ms: 1 }],
    "run_1b",
    { defaultSource: "codex_app_server" },
  );
  assert.equal(traceEvents[0].source, "codex_app_server");
});

test("buildTraceEvents falls back to completed_at_ms/started_at_ms for timestamp", () => {
  const traceEvents = buildTraceEvents(
    [
      { event_type: "x", completed_at_ms: 50 },
      { event_type: "y", started_at_ms: 60 },
      { event_type: "z" },
    ],
    "run_2",
  );
  assert.equal(traceEvents[0].timestamp_ms, 50);
  assert.equal(traceEvents[1].timestamp_ms, 60);
  // No timestamp on the source event at all: schema requires a `number`,
  // so this must never be null.
  assert.equal(typeof traceEvents[2].timestamp_ms, "number");
});

test("buildTraceEvents never produces a null timestamp_ms across event shapes lacking timestamps", () => {
  const eventShapes = [
    { event_type: "run_started" },
    { event_type: "turn_started" },
    { event_type: "agent_response_delta", delta: "hi" },
    { event_type: "tool_call_executed", tool_name: "x" },
    { event_type: "final_answer", text: "done" },
    { event_type: "error", message: "boom" },
  ];
  const traceEvents = buildTraceEvents(eventShapes, "run_3");
  for (const event of traceEvents) {
    assert.equal(typeof event.timestamp_ms, "number");
    assert.ok(Number.isFinite(event.timestamp_ms));
  }
});

test("parseJsonLines returns complete messages and keeps partial line buffered", () => {
  const parsed = parseJsonLines('{"id":1,"result":{}}\n{"method":"turn/started"', "");

  assert.deepEqual(parsed.messages, [{ id: 1, result: {} }]);
  assert.equal(parsed.remainder, '{"method":"turn/started"');
});

test("parseJsonLines merges a stored remainder with the next chunk", () => {
  const parsed = parseJsonLines('}\n', '{"method":"turn/started"');
  assert.deepEqual(parsed.messages, [{ method: "turn/started" }]);
  assert.equal(parsed.remainder, "");
});

test("parseJsonLines skips blank lines", () => {
  const parsed = parseJsonLines('{"a":1}\n\n{"b":2}\n', "");
  assert.deepEqual(parsed.messages, [{ a: 1 }, { b: 2 }]);
  assert.equal(parsed.remainder, "");
});

test("describeError preserves structured app-server error details", () => {
  assert.equal(
    describeError({ message: { code: "bad_request", detail: "model unavailable" } }),
    '{"code":"bad_request","detail":"model unavailable"}',
  );
});

test("describeError returns Error.message directly", () => {
  assert.equal(describeError(new Error("boom")), "boom");
});

test("describeError returns strings as-is", () => {
  assert.equal(describeError("plain error"), "plain error");
});
