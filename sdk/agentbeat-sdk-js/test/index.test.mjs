import assert from "node:assert/strict";
import test from "node:test";

import { BoundedEvidenceStore, EvidenceCollector, buildTargetEvidence } from "../src/index.mjs";

const start = "2026-08-26T00:00:00.000Z";
const finish = "2026-08-26T00:00:01.000Z";

function collector(options = {}) {
  let tick = 0;
  return new EvidenceCollector({
    runId: "run-sdk-example-0001",
    caseId: "case-sdk-example-0001",
    source: "customer-agent",
    startedAt: start,
    clock: () => new Date(Date.parse(start) + (++tick * 100)),
    ...options,
  });
}

test("the root SDK exposes only the canonical collection primitives", async () => {
  const root = await import("../src/index.mjs");
  assert.deepEqual(Object.keys(root).sort(), ["BoundedEvidenceStore", "EvidenceCollector", "buildTargetEvidence"]);
  const legacy = await import("../src/legacy.mjs");
  assert.equal(typeof legacy.createEvalServer, "function");
  assert.equal(typeof legacy.buildEvalRun, "function");
});

test("EvidenceCollector makes the common message and correlated tool path small", () => {
  const evidence = collector();
  evidence.message({ role: "assistant", text: "I will inspect the notice." });
  evidence.toolCall({ callId: "call-1", name: "read_file", arguments: { path: "notice.txt" } });
  evidence.toolResult({ callId: "call-1", name: "read_file", result: "safe" });
  const document = evidence.finalize({ finishedAt: finish });

  assert.equal(document.schema_version, "target-evidence-v1");
  assert.equal(document.assurance_level, "L2");
  assert.deepEqual(document.observed_channels, ["messages", "tools"]);
  assert.deepEqual(document.events.map((event) => event.type), ["message", "tool.call", "tool.result"]);
  assert.equal(document.events[1].event_id, "run-sdk-example-0001:event:1");
  assert.equal(document.events[1].sequence, 1);
  assert.deepEqual(document.events[1].data, {
    call_id: "call-1",
    name: "read_file",
    arguments: { path: "notice.txt" },
    attributes: {},
  });
});

test("tool results must bind one prior call with the same name", () => {
  const missing = collector();
  assert.throws(
    () => missing.toolResult({ callId: "call-1", name: "read_file", result: "x" }),
    /no matching call/,
  );

  const mismatch = collector();
  mismatch.toolCall({ callId: "call-1", name: "read_file", arguments: {} });
  assert.throws(
    () => mismatch.toolResult({ callId: "call-1", name: "send_money", result: "x" }),
    /name does not match/,
  );
});

test("collector applies bounded default secret redaction before export", () => {
  const evidence = collector({ maxStringLength: 128 });
  evidence.toolCall({
    callId: "call-secret",
    name: "http",
    arguments: {
      authorization: "Bearer must-not-leak",
      nested: {
        api_key: "must-not-leak",
        auth_token: "must-not-leak",
        bearerToken: "must-not-leak",
        "model.token": "must-not-leak",
        prompt: "keep this",
      },
      long: "x".repeat(200),
    },
  });
  const event = evidence.toEvents()[0];
  assert.equal(event.data.arguments.authorization, "[redacted]");
  assert.equal(event.data.arguments.nested.api_key, "[redacted]");
  assert.equal(event.data.arguments.nested.auth_token, "[redacted]");
  assert.equal(event.data.arguments.nested.bearerToken, "[redacted]");
  assert.equal(event.data.arguments.nested["model.token"], "[redacted]");
  assert.equal(event.data.arguments.nested.prompt, "keep this");
  assert.match(event.data.arguments.long, /\[truncated\]$/);
});

test("collector rejects undeclared channels, invalid IDs, overflow, and mutation after finalize", () => {
  assert.throws(() => new EvidenceCollector({ runId: "run_bad", caseId: "case-good" }), /runId/);
  assert.throws(() => collector({ observedChannels: ["messages"] }), /include messages and tools/);
  assert.throws(() => collector({ observedChannels: ["files"] }), /include messages and tools/);
  assert.throws(() => collector({ maxEvents: 5001 }), /1 to 5000/);
  assert.throws(() => collector({ startedAt: "2026-08-26" }), /RFC3339/);
  const withoutFiles = collector();
  assert.throws(() => withoutFiles.fileChange({ path: "x", diff: "" }), /not declared observed/);

  const limited = collector({ maxEvents: 1 });
  limited.message({ text: "one" });
  assert.throws(() => limited.message({ text: "two" }), /event limit/);

  const complete = collector();
  complete.message({ text: "done" });
  complete.finalize({ finishedAt: finish });
  assert.throws(() => complete.message({ text: "late" }), /already finalized/);
  assert.throws(() => complete.finalize({ finishedAt: finish }), /already finalized/);
});

test("collector rejects schema drift and bounds that damage required event fields", () => {
  const unknown = collector();
  assert.throws(
    () => unknown.event({
      type: "message",
      data: { role: "assistant", text: "done", attributes: {}, score: 1 },
    }),
    /unsupported field score/,
  );

  const missingResult = collector();
  missingResult.toolCall({ callId: "call-missing-result", name: "lookup", arguments: {} });
  assert.throws(
    () => missingResult.event({
      type: "tool.result",
      data: { call_id: "call-missing-result", name: "lookup", is_error: false, attributes: {} },
    }),
    /requires result/,
  );

  const tooFewItems = collector({ maxCollectionItems: 1 });
  assert.throws(
    () => tooFewItems.toolCall({ callId: "call-truncated", name: "lookup", arguments: {} }),
    /tool.call name|attributes is required/,
  );

  const tooShallow = collector({ maxDepth: 1 });
  assert.throws(
    () => tooShallow.toolCall({ callId: "call-depth", name: "lookup", arguments: { query: "safe" } }),
    /arguments must be an object/,
  );

  const emptyDelta = collector();
  assert.throws(() => emptyDelta.messageDelta({ delta: "" }), /message.delta/);
  const longStatus = collector();
  assert.throws(() => longStatus.lifecycle("ready", { status: "x".repeat(129) }), /status/);
  const nullStatus = collector();
  assert.throws(() => nullStatus.lifecycle("ready", { status: null }), /status/);
  const unsafeExit = collector();
  assert.throws(
    () => unsafeExit.commandResult({ command: "true", exitCode: Number.MAX_SAFE_INTEGER + 1, output: "" }),
    /must be an integer/,
  );
  const empty = collector();
  assert.throws(() => empty.finalize({ finishedAt: finish }), /at least one event/);
});

test("collector rejects non-finite JSON numbers", () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const evidence = collector();
    assert.throws(
      () => evidence.toolCall({ callId: "call-number", name: "lookup", arguments: { nested: { value } } }),
      /finite JSON numbers/,
    );
  }
});

test("custom redactors are applied once and cannot recurse on equal replacements", () => {
  const evidence = collector({ redact: (_key, value) => typeof value === "string" ? `${value}x`.slice(0, -1) : value });
  evidence.message({ text: "hello" });
  assert.equal(evidence.toEvents()[0].data.text, "hello");
});

test("command and file events follow the canonical string and collection types", () => {
  const evidence = collector({ observedChannels: ["messages", "tools", "files"] });
  evidence.commandResult({ command: "true", exitCode: 0, output: "" });
  evidence.fileChange({ path: "result.txt", diff: "" });
  assert.equal(evidence.toEvents()[0].data.output, "");
  assert.equal(evidence.toEvents()[1].data.diff, "");
  assert.throws(
    () => evidence.event({ type: "file.change", data: { path: "x", changes: {}, attributes: {} } }),
    /changes must be an array/,
  );
});

test("buildTargetEvidence standardizes source-adapter events", () => {
  const document = buildTargetEvidence({
    runId: "run-builder-example-0001",
    caseId: "case-builder-example-0001",
    source: "codex-app-server",
    observedChannels: ["messages", "tools"],
    startedAt: start,
    finishedAt: finish,
    events: [
      { type: "tool.call", occurredAt: start, data: { call_id: "item-1", name: "read_file", arguments: {} } },
      { type: "tool.result", occurredAt: finish, data: { call_id: "item-1", name: "read_file", result: "ok", is_error: false } },
      { type: "message", occurredAt: finish, data: { role: "assistant", text: "done" } },
    ],
  });
  assert.equal(document.events[0].source, "codex-app-server");
  assert.equal(document.events[2].data.text, "done");
});

test("BoundedEvidenceStore clones values and evicts the oldest run", () => {
  const firstCollector = collector();
  firstCollector.message({ text: "first" });
  const first = firstCollector.finalize({ finishedAt: finish });
  const second = buildTargetEvidence({
    runId: "run-sdk-example-0002",
    caseId: "case-sdk-example-0002",
    events: [{ type: "message", data: { role: "assistant", text: "second" } }],
    observedChannels: ["messages", "tools"],
    startedAt: start,
    finishedAt: finish,
  });
  const store = new BoundedEvidenceStore(1);
  store.put(first.run_id, first);
  const returned = store.get(first.run_id);
  returned.events.push({ unsafe: true });
  assert.equal(store.get(first.run_id).events.length, 1);
  store.put(second.run_id, second);
  assert.equal(store.get(first.run_id), null);
  assert.equal(store.get(second.run_id).run_id, second.run_id);
});
