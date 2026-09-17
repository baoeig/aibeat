import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { bearerTokenFromFile, createTargetServer } from "../src/node.mjs";

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address())));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function invocation(runId = "run-node-sdk-0001", metadata = {}) {
  return {
    body: JSON.stringify({
      schema_version: "target-invocation-v1",
      run_id: runId,
      case_id: "case-node-sdk-0001",
      input: { text: "Complete the task safely." },
      metadata,
    }),
    headers: {
      "content-type": "application/json",
      authorization: "Bearer target-token",
      "x-aibeat-run-id": runId,
      "x-aibeat-case-id": "case-node-sdk-0001",
    },
  };
}

test("createTargetServer owns TargetInvocation transport and Evidence retrieval", async () => {
  const server = createTargetServer({
    targetId: "target-node-sdk",
    auth: "target-token",
    logger: null,
    async invoke({ input, observe }) {
      observe.message({ text: "Working" });
      observe.toolCall({ callId: "call-1", name: "lookup", arguments: { query: input.text } });
      observe.toolResult({ callId: "call-1", name: "lookup", result: { ok: true } });
      return { finalResponse: "Completed safely.", metadata: { target_id: "cannot-override" } };
    },
  });
  const address = await listen(server);
  const baseURL = `http://127.0.0.1:${address.port}`;
  try {
    const request = invocation();
    const response = await fetch(`${baseURL}/v1/agent/invocations`, { method: "POST", ...request });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.final_response, "Completed safely.");
    assert.equal(result.metadata.target_id, "target-node-sdk");
    assert.equal(result.evidence_ref, "/v1/evidence/run-node-sdk-0001");

    const fetched = await fetch(`${baseURL}${result.evidence_ref}`, { headers: { authorization: "Bearer target-token" } });
    assert.equal(fetched.status, 200);
    const evidence = await fetched.json();
    assert.deepEqual(evidence.events.map((event) => event.type), ["message", "tool.call", "tool.result"]);
    assert.equal(evidence.events[2].data.call_id, "call-1");

    const replay = await fetch(`${baseURL}/v1/agent/invocations`, { method: "POST", ...request });
    assert.equal(replay.status, 409);
  } finally {
    await close(server);
  }
});

test("Target server supports L1 without constructing or serving Evidence", async () => {
  const server = createTargetServer({
    targetId: "target-node-l1",
    auth: "target-token",
    evidence: false,
    logger: null,
    async invoke({ observe }) {
      assert.equal(observe, null);
      return { finalResponse: "L1 answer" };
    },
  });
  const address = await listen(server);
  const baseURL = `http://127.0.0.1:${address.port}`;
  try {
    const request = invocation("run-node-l1-0001");
    const response = await fetch(`${baseURL}/v1/agent/invocations`, { method: "POST", ...request });
    const result = await response.json();
    assert.equal(result.metadata.evidence_level, "L1");
    assert.equal("evidence_ref" in result, false);
    const evidence = await fetch(`${baseURL}/v1/evidence/run-node-l1-0001`, { headers: { authorization: "Bearer target-token" } });
    assert.equal(evidence.status, 404);
  } finally {
    await close(server);
  }
});

test("Target server rejects auth, correlation, and runtime overrides before invoke", async () => {
  let calls = 0;
  const server = createTargetServer({
    targetId: "target-node-guarded",
    auth: "target-token",
    logger: null,
    async invoke() { calls += 1; return { finalResponse: "must not run" }; },
  });
  const address = await listen(server);
  const baseURL = `http://127.0.0.1:${address.port}`;
  try {
    const unauthorized = invocation("run-node-unauthorized");
    unauthorized.headers.authorization = "Bearer wrong";
    let response = await fetch(`${baseURL}/v1/agent/invocations`, { method: "POST", ...unauthorized });
    assert.equal(response.status, 401);

    const mismatch = invocation("run-node-mismatch");
    mismatch.headers["x-aibeat-run-id"] = "run-other";
    response = await fetch(`${baseURL}/v1/agent/invocations`, { method: "POST", ...mismatch });
    assert.equal(response.status, 400);

    const override = invocation("run-node-override", { nested: { model: "attacker" } });
    response = await fetch(`${baseURL}/v1/agent/invocations`, { method: "POST", ...override });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "runtime_override_forbidden");
    assert.equal(calls, 0);
  } finally {
    await close(server);
  }
});

test("Target server rejects non-finite response values instead of serializing null", async () => {
  const server = createTargetServer({
    targetId: "target-node-finite-json",
    auth: "target-token",
    evidence: false,
    logger: null,
    async invoke() {
      return { finalResponse: "done", metadata: { metric: Number.NaN } };
    },
  });
  const address = await listen(server);
  const baseURL = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(`${baseURL}/v1/agent/invocations`, {
      method: "POST",
      ...invocation("run-node-finite-json"),
    });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, "target_execution_failed");
  } finally {
    await close(server);
  }
});

test("bearerTokenFromFile rejects placeholders", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "agentbeat-sdk-token-"));
  const tokenPath = path.join(directory, "token");
  writeFileSync(tokenPath, "target-token\n", { mode: 0o600 });
  assert.equal(bearerTokenFromFile(tokenPath), "target-token");
  writeFileSync(tokenPath, "REPLACE_ME\n", { mode: 0o600 });
  assert.throws(() => bearerTokenFromFile(tokenPath), /placeholder/);
});

test("Target replay protection has an explicit bounded retention window", async () => {
  let calls = 0;
  const server = createTargetServer({
    targetId: "target-node-bounded-replay",
    auth: "target-token",
    evidence: false,
    maxConcurrentRuns: 1,
    maxClaimedRuns: 1,
    logger: null,
    async invoke() { calls += 1; return { finalResponse: "done" }; },
  });
  const address = await listen(server);
  const baseURL = `http://127.0.0.1:${address.port}`;
  try {
    const first = invocation("run-node-window-0001");
    let response = await fetch(`${baseURL}/v1/agent/invocations`, { method: "POST", ...first });
    assert.equal(response.status, 200);
    response = await fetch(`${baseURL}/v1/agent/invocations`, { method: "POST", ...first });
    assert.equal(response.status, 409);

    const second = invocation("run-node-window-0002");
    response = await fetch(`${baseURL}/v1/agent/invocations`, { method: "POST", ...second });
    assert.equal(response.status, 200);
    response = await fetch(`${baseURL}/v1/agent/invocations`, { method: "POST", ...first });
    assert.equal(response.status, 200);
    assert.equal(calls, 3);
  } finally {
    await close(server);
  }
  assert.throws(
    () => createTargetServer({
      targetId: "target-node-invalid-window", auth: "target-token", invoke: async () => ({ finalResponse: "done" }),
      maxConcurrentRuns: 2, maxClaimedRuns: 1,
    }),
    /no smaller than maxConcurrentRuns/,
  );
});
