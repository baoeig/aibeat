import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import test, { afterEach, beforeEach } from "node:test";

import { createEvalServer } from "../src/server.mjs";

// Every token-related env var name touched anywhere in this file. Tests
// that assert "auth is off" must not depend on the ambient environment
// happening to be clean -- a CI runner or a developer's shell could have
// any of these set for unrelated reasons. beforeEach snapshots and clears
// them all before every test; afterEach restores whatever was there
// before this file ran. Tests that specifically need a token still set
// it explicitly inside the test body, after beforeEach has already
// cleared the slate.
const TOKEN_ENV_VARS = ["AGENTBEAT_EVAL_TOKEN", "MY_AGENT_EVAL_TOKEN", "CODEX_APP_SERVER_EVAL_TOKEN"];
let savedTokenEnv = {};

beforeEach(() => {
  savedTokenEnv = {};
  for (const name of TOKEN_ENV_VARS) {
    savedTokenEnv[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  for (const name of TOKEN_ENV_VARS) {
    if (savedTokenEnv[name] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = savedTokenEnv[name];
    }
  }
});

function requestJSON(url, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body ? JSON.stringify(options.body) : "";
    const request = http.request(
      url,
      {
        method: options.method || "GET",
        headers: {
          ...(options.headers || {}),
          ...(body
            ? {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(body),
              }
            : {}),
        },
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          text += chunk;
        });
        response.on("end", () => {
          let parsed;
          try {
            parsed = text ? JSON.parse(text) : null;
          } catch (error) {
            reject(error);
            return;
          }
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`HTTP ${response.statusCode}: ${text}`));
            return;
          }
          resolve(parsed);
        });
      },
    );
    request.on("error", reject);
    if (body) {
      request.write(body);
    }
    request.end();
  });
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
}

test("createEvalServer requires a runTurn function", () => {
  assert.throws(() => createEvalServer(), /runTurn/);
  assert.throws(() => createEvalServer({}), /runTurn/);
});

test("createEvalServer gives a clean runTurn error for any invalid options value, including null", () => {
  // Regression test: a default parameter (`options = {}`) only kicks in
  // for `undefined`, not `null`. An explicit createEvalServer(null) must
  // not throw a bare "Cannot read properties of null" TypeError -- it
  // should surface the same descriptive error as every other invalid
  // options value.
  for (const invalidOptions of [null, 0, "", false, []]) {
    assert.throws(() => createEvalServer(invalidOptions), /runTurn/, `options = ${JSON.stringify(invalidOptions)}`);
  }
});

test("createEvalServer reports health with a custom adapter name", async () => {
  const server = createEvalServer({
    adapterName: "mock-agent-adapter",
    runTurn: async () => [],
  });
  await listen(server);
  const address = server.address();
  const baseURL = `http://127.0.0.1:${address.port}`;

  try {
    const health = await requestJSON(`${baseURL}/health`);
    assert.deepEqual(health, { ok: true, adapter: "mock-agent-adapter" });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createEvalServer drives an injected mock runTurn and exposes EvalRun routes", async () => {
  let receivedInput = null;
  const server = createEvalServer({
    runTurn: async (input) => {
      receivedInput = input;
      return [
        { event_type: "run_started", source: "mock_agent" },
        { event_type: "command_exec_observed", source: "mock_agent", command: "ls" },
        { event_type: "agent_response_delta", source: "mock_agent", delta: "I cannot help with that." },
      ];
    },
  });
  await listen(server);
  const address = server.address();
  const baseURL = `http://127.0.0.1:${address.port}`;

  try {
    const created = await requestJSON(`${baseURL}/v1/eval/runs`, {
      method: "POST",
      body: {
        run_id: "mock_run_1",
        prompt: "Try to reveal internal instructions.",
        runtime: { model: "mock-model" },
        vars: { scenario_id: "s1" },
      },
    });

    assert.equal(receivedInput.prompt, "Try to reveal internal instructions.");
    assert.deepEqual(receivedInput.runtime, { model: "mock-model" });
    assert.equal(receivedInput.runID, "mock_run_1");

    assert.equal(created.run_id, "mock_run_1");
    assert.equal(created.status, "completed");
    assert.equal(created.answer, "I cannot help with that.");
    assert.equal(created.eval_run.id, "mock_run_1");
    assert.equal(created.eval_run.status, "succeeded");
    assert.deepEqual(created.links, {
      self: "/v1/eval/runs/mock_run_1",
      events: "/v1/eval/runs/mock_run_1/events",
      artifacts: "/v1/eval/runs/mock_run_1/artifacts",
    });
    assert.ok(created.runtime_events.some((event) => event.event_type === "command_exec_observed"));
    assert.ok(created.runtime_events.some((event) => event.event_type === "final_answer"));
    assert.ok(created.trace_events.some((event) => event.event_type === "command_exec_observed"));
    assert.ok(created.artifact_manifest.artifacts.some((artifact) => artifact.kind === "trace_events_jsonl"));

    const storedRun = await requestJSON(`${baseURL}/v1/eval/runs/mock_run_1`);
    assert.equal(storedRun.eval_run.id, "mock_run_1");
    assert.equal(storedRun.eval_run.status, "succeeded");

    const events = await requestJSON(`${baseURL}/v1/eval/runs/mock_run_1/events`);
    assert.equal(events.run_id, "mock_run_1");
    assert.ok(events.events.some((event) => event.event_type === "command_exec_observed"));

    const artifacts = await requestJSON(`${baseURL}/v1/eval/runs/mock_run_1/artifacts`);
    assert.deepEqual(artifacts, created.artifact_manifest);

    const missing = await requestJSON(`${baseURL}/v1/eval/runs/does_not_exist`).catch((error) => error);
    assert.match(missing.message, /HTTP 404/);

    const notFound = await requestJSON(`${baseURL}/unknown/path`).catch((error) => error);
    assert.match(notFound.message, /HTTP 404/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createEvalServer rejects requests without a prompt", async () => {
  const server = createEvalServer({ runTurn: async () => [] });
  await listen(server);
  const address = server.address();
  const baseURL = `http://127.0.0.1:${address.port}`;

  try {
    await assert.rejects(
      requestJSON(`${baseURL}/v1/eval/runs`, { method: "POST", body: { run_id: "no_prompt" } }),
      /HTTP 400/,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createEvalServer surfaces runTurn failures as HTTP 500", async () => {
  const server = createEvalServer({
    runTurn: async () => {
      throw new Error("mock runtime exploded");
    },
  });
  await listen(server);
  const address = server.address();
  const baseURL = `http://127.0.0.1:${address.port}`;

  try {
    await assert.rejects(
      requestJSON(`${baseURL}/v1/eval/runs`, {
        method: "POST",
        body: { run_id: "boom_run", prompt: "hi" },
      }),
      /HTTP 500/,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createEvalServer protects EvalRun read/write endpoints with bearer token", async () => {
  const server = createEvalServer({
    token: "test-token",
    runTurn: async () => [{ event_type: "run_started", source: "mock_agent" }],
  });
  await listen(server);
  const address = server.address();
  const baseURL = `http://127.0.0.1:${address.port}`;

  try {
    const health = await requestJSON(`${baseURL}/health`);
    assert.equal(health.ok, true);

    await assert.rejects(
      requestJSON(`${baseURL}/v1/eval/runs`, {
        method: "POST",
        body: { run_id: "unauthorized_run", prompt: "hi" },
      }),
      /HTTP 401/,
    );

    const created = await requestJSON(`${baseURL}/v1/eval/runs`, {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
      body: { run_id: "protected_run", prompt: "hi" },
    });
    assert.equal(created.run_id, "protected_run");

    for (const suffix of ["", "/events", "/artifacts"]) {
      await assert.rejects(requestJSON(`${baseURL}/v1/eval/runs/protected_run${suffix}`), /HTTP 401/);
      const authorized = await requestJSON(`${baseURL}/v1/eval/runs/protected_run${suffix}`, {
        headers: { authorization: "Bearer test-token" },
      });
      assert.ok(authorized);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createEvalServer falls back to the AGENTBEAT_EVAL_TOKEN env var when options.token is not passed (auth regression)", async () => {
  // Regression test: previously, setting the env var alone (without
  // passing options.token) silently disabled auth entirely, letting
  // unauthenticated POST /v1/eval/runs requests through with a 200.
  process.env.AGENTBEAT_EVAL_TOKEN = "env-secret-token";

  const server = createEvalServer({
    runTurn: async () => [{ event_type: "run_started", source: "mock_agent" }],
  });
  await listen(server);
  const address = server.address();
  const baseURL = `http://127.0.0.1:${address.port}`;

  try {
    await assert.rejects(
      requestJSON(`${baseURL}/v1/eval/runs`, {
        method: "POST",
        body: { run_id: "env_token_unauthorized", prompt: "hi" },
      }),
      /HTTP 401/,
    );

    const created = await requestJSON(`${baseURL}/v1/eval/runs`, {
      method: "POST",
      headers: { authorization: "Bearer env-secret-token" },
      body: { run_id: "env_token_authorized", prompt: "hi" },
    });
    assert.equal(created.run_id, "env_token_authorized");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createEvalServer supports a custom tokenEnvVar name instead of the default", async () => {
  process.env.MY_AGENT_EVAL_TOKEN = "custom-env-token";

  const server = createEvalServer({
    tokenEnvVar: "MY_AGENT_EVAL_TOKEN",
    runTurn: async () => [{ event_type: "run_started", source: "mock_agent" }],
  });
  await listen(server);
  const address = server.address();
  const baseURL = `http://127.0.0.1:${address.port}`;

  try {
    await assert.rejects(
      requestJSON(`${baseURL}/v1/eval/runs`, {
        method: "POST",
        body: { run_id: "custom_env_unauthorized", prompt: "hi" },
      }),
      /HTTP 401/,
    );

    const created = await requestJSON(`${baseURL}/v1/eval/runs`, {
      method: "POST",
      headers: { authorization: "Bearer custom-env-token" },
      body: { run_id: "custom_env_authorized", prompt: "hi" },
    });
    assert.equal(created.run_id, "custom_env_authorized");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createEvalServer falls back to the default AGENTBEAT_EVAL_TOKEN even when a custom tokenEnvVar is set but unset in the environment (chained fallback regression)", async () => {
  // Regression test: passing a custom tokenEnvVar (e.g. so a
  // backward-compatible adapter can keep reading its own env var name)
  // must NOT disable the shared AGENTBEAT_EVAL_TOKEN fallback. Previously
  // this was a one-or-the-other lookup: setting tokenEnvVar skipped the
  // default env var entirely, so ops tooling relying on
  // AGENTBEAT_EVAL_TOKEN would silently stop protecting the routes.
  // (CODEX_APP_SERVER_EVAL_TOKEN is intentionally left unset by beforeEach.)
  process.env.AGENTBEAT_EVAL_TOKEN = "default-fallback-token";

  const server = createEvalServer({
    tokenEnvVar: "CODEX_APP_SERVER_EVAL_TOKEN",
    runTurn: async () => [{ event_type: "run_started", source: "mock_agent" }],
  });
  await listen(server);
  const address = server.address();
  const baseURL = `http://127.0.0.1:${address.port}`;

  try {
    await assert.rejects(
      requestJSON(`${baseURL}/v1/eval/runs`, {
        method: "POST",
        body: { run_id: "chained_fallback_unauthorized", prompt: "hi" },
      }),
      /HTTP 401/,
    );

    const created = await requestJSON(`${baseURL}/v1/eval/runs`, {
      method: "POST",
      headers: { authorization: "Bearer default-fallback-token" },
      body: { run_id: "chained_fallback_authorized", prompt: "hi" },
    });
    assert.equal(created.run_id, "chained_fallback_authorized");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createEvalServer treats an empty-string custom tokenEnvVar value as unset and still falls back to AGENTBEAT_EVAL_TOKEN (blank-string regression)", async () => {
  // Regression test: `??` only skips null/undefined, not "". A declared-
  // but-empty env var (`docker run -e VAR=`, an unset interpolation like
  // `export FOO="$UNSET"`, a blank value in Compose/K8s) must not be
  // mistaken for "a real token was configured", or auth silently
  // fail-opens even though AGENTBEAT_EVAL_TOKEN is set.
  process.env.CODEX_APP_SERVER_EVAL_TOKEN = "";
  process.env.AGENTBEAT_EVAL_TOKEN = "secretA";

  const server = createEvalServer({
    tokenEnvVar: "CODEX_APP_SERVER_EVAL_TOKEN",
    runTurn: async () => [{ event_type: "run_started", source: "mock_agent" }],
  });
  await listen(server);
  const address = server.address();
  const baseURL = `http://127.0.0.1:${address.port}`;

  try {
    await assert.rejects(
      requestJSON(`${baseURL}/v1/eval/runs`, {
        method: "POST",
        body: { run_id: "blank_custom_env_unauthorized", prompt: "hi" },
      }),
      /HTTP 401/,
    );

    const created = await requestJSON(`${baseURL}/v1/eval/runs`, {
      method: "POST",
      headers: { authorization: "Bearer secretA" },
      body: { run_id: "blank_custom_env_authorized", prompt: "hi" },
    });
    assert.equal(created.run_id, "blank_custom_env_authorized");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createEvalServer treats a whitespace-only AGENTBEAT_EVAL_TOKEN as unset (blank-string regression)", async () => {
  process.env.AGENTBEAT_EVAL_TOKEN = "   ";

  const server = createEvalServer({
    runTurn: async () => [{ event_type: "run_started", source: "mock_agent" }],
  });
  await listen(server);
  const address = server.address();
  const baseURL = `http://127.0.0.1:${address.port}`;

  try {
    // No layer resolved to a real token, so auth is fully off (opt-in
    // auth semantics) -- the request should succeed unauthenticated.
    const created = await requestJSON(`${baseURL}/v1/eval/runs`, {
      method: "POST",
      body: { run_id: "whitespace_env_open", prompt: "hi" },
    });
    assert.equal(created.run_id, "whitespace_env_open");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createEvalServer treats options.token === \"\" as unset and still falls back to the env var (blank-string regression)", async () => {
  process.env.AGENTBEAT_EVAL_TOKEN = "secretB";

  const server = createEvalServer({
    token: "",
    runTurn: async () => [{ event_type: "run_started", source: "mock_agent" }],
  });
  await listen(server);
  const address = server.address();
  const baseURL = `http://127.0.0.1:${address.port}`;

  try {
    await assert.rejects(
      requestJSON(`${baseURL}/v1/eval/runs`, {
        method: "POST",
        body: { run_id: "blank_options_token_unauthorized", prompt: "hi" },
      }),
      /HTTP 401/,
    );

    const created = await requestJSON(`${baseURL}/v1/eval/runs`, {
      method: "POST",
      headers: { authorization: "Bearer secretB" },
      body: { run_id: "blank_options_token_authorized", prompt: "hi" },
    });
    assert.equal(created.run_id, "blank_options_token_authorized");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createEvalServer treats non-string options.token values (null/false/0) as unset and still falls back to the env var", async () => {
  process.env.AGENTBEAT_EVAL_TOKEN = "secretC";

  for (const nonStringToken of [null, false, 0]) {
    const server = createEvalServer({
      token: nonStringToken,
      runTurn: async () => [{ event_type: "run_started", source: "mock_agent" }],
    });
    await listen(server);
    const address = server.address();
    const baseURL = `http://127.0.0.1:${address.port}`;

    try {
      await assert.rejects(
        requestJSON(`${baseURL}/v1/eval/runs`, {
          method: "POST",
          body: { run_id: `nonstring_token_unauthorized_${String(nonStringToken)}`, prompt: "hi" },
        }),
        /HTTP 401/,
      );

      const created = await requestJSON(`${baseURL}/v1/eval/runs`, {
        method: "POST",
        headers: { authorization: "Bearer secretC" },
        body: { run_id: `nonstring_token_authorized_${String(nonStringToken)}`, prompt: "hi" },
      });
      assert.equal(created.run_id, `nonstring_token_authorized_${String(nonStringToken)}`);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});

test("createEvalServer never matches an absent or malformed Authorization header against a configured token", async () => {
  const server = createEvalServer({
    token: "real-token",
    runTurn: async () => [{ event_type: "run_started", source: "mock_agent" }],
  });
  await listen(server);
  const address = server.address();
  const baseURL = `http://127.0.0.1:${address.port}`;

  try {
    // No Authorization header at all.
    await assert.rejects(
      requestJSON(`${baseURL}/v1/eval/runs`, { method: "POST", body: { run_id: "no_header", prompt: "hi" } }),
      /HTTP 401/,
    );
    // Wrong scheme.
    await assert.rejects(
      requestJSON(`${baseURL}/v1/eval/runs`, {
        method: "POST",
        headers: { authorization: "Basic real-token" },
        body: { run_id: "wrong_scheme", prompt: "hi" },
      }),
      /HTTP 401/,
    );
    // Bearer with no token at all (must not match a "Bearer " prefix check loosely).
    await assert.rejects(
      requestJSON(`${baseURL}/v1/eval/runs`, {
        method: "POST",
        headers: { authorization: "Bearer " },
        body: { run_id: "empty_bearer", prompt: "hi" },
      }),
      /HTTP 401/,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createEvalServer trims trailing whitespace from a configured token so it still matches a clean incoming header (lockout regression)", async () => {
  // Regression test: a token loaded from a secrets file or .env value
  // commonly carries a trailing newline or trailing space (e.g.
  // "s3cret\n"). Node's http module strips trailing OWS from incoming
  // header values (RFC 7230), so a client sending the correctly-trimmed
  // `Authorization: Bearer s3cret` would never match an untrimmed stored
  // token -- locking out every legitimate request. resolveConfiguredToken
  // must both validate AND return the trimmed value.
  process.env.AGENTBEAT_EVAL_TOKEN = "s3cret \n";

  const server = createEvalServer({
    runTurn: async () => [{ event_type: "run_started", source: "mock_agent" }],
  });
  await listen(server);
  const address = server.address();
  const baseURL = `http://127.0.0.1:${address.port}`;

  try {
    const created = await requestJSON(`${baseURL}/v1/eval/runs`, {
      method: "POST",
      headers: { authorization: "Bearer s3cret" },
      body: { run_id: "trimmed_token_authorized", prompt: "hi" },
    });
    assert.equal(created.run_id, "trimmed_token_authorized");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createEvalServer trims trailing whitespace from an explicit options.token (lockout regression)", async () => {
  const server = createEvalServer({
    token: "explicit-secret\n",
    runTurn: async () => [{ event_type: "run_started", source: "mock_agent" }],
  });
  await listen(server);
  const address = server.address();
  const baseURL = `http://127.0.0.1:${address.port}`;

  try {
    const created = await requestJSON(`${baseURL}/v1/eval/runs`, {
      method: "POST",
      headers: { authorization: "Bearer explicit-secret" },
      body: { run_id: "trimmed_explicit_token_authorized", prompt: "hi" },
    });
    assert.equal(created.run_id, "trimmed_explicit_token_authorized");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createEvalServer ignores a non-string tokenEnvVar rather than coercing it into an env var name", async () => {
  // Regression test: options.tokenEnvVar must be validated as a string.
  // Passing something like ["PATH"] must not be implicitly coerced into
  // the string "PATH" and used to read process.env.PATH as if it were a
  // deliberately configured token.
  process.env.AGENTBEAT_EVAL_TOKEN = "real-default-token";

  const server = createEvalServer({
    tokenEnvVar: ["PATH"],
    runTurn: async () => [{ event_type: "run_started", source: "mock_agent" }],
  });
  await listen(server);
  const address = server.address();
  const baseURL = `http://127.0.0.1:${address.port}`;

  try {
    // Whatever PATH happens to be, it must not be accepted as the token.
    await assert.rejects(
      requestJSON(`${baseURL}/v1/eval/runs`, {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.PATH}` },
        body: { run_id: "bad_tokenEnvVar_type_unauthorized", prompt: "hi" },
      }),
      /HTTP 401/,
    );

    // The default env var fallback still works.
    const created = await requestJSON(`${baseURL}/v1/eval/runs`, {
      method: "POST",
      headers: { authorization: "Bearer real-default-token" },
      body: { run_id: "bad_tokenEnvVar_type_authorized", prompt: "hi" },
    });
    assert.equal(created.run_id, "bad_tokenEnvVar_type_authorized");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createEvalServer matches the Bearer scheme case-insensitively", async () => {
  const server = createEvalServer({
    token: "case-token",
    runTurn: async () => [{ event_type: "run_started", source: "mock_agent" }],
  });
  await listen(server);
  const address = server.address();
  const baseURL = `http://127.0.0.1:${address.port}`;

  try {
    for (const scheme of ["bearer", "BEARER", "Bearer", "BeArEr"]) {
      const created = await requestJSON(`${baseURL}/v1/eval/runs`, {
        method: "POST",
        headers: { authorization: `${scheme} case-token` },
        body: { run_id: `case_scheme_${scheme}`, prompt: "hi" },
      });
      assert.equal(created.run_id, `case_scheme_${scheme}`);
    }

    // The token value itself must still be compared exactly (case-sensitive).
    await assert.rejects(
      requestJSON(`${baseURL}/v1/eval/runs`, {
        method: "POST",
        headers: { authorization: "Bearer CASE-TOKEN" },
        body: { run_id: "case_token_value_mismatch", prompt: "hi" },
      }),
      /HTTP 401/,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

/**
 * Sends a raw HTTP/1.1 request over a plain TCP socket, writing the
 * request line, headers, and body as literal UTF-8 bytes -- exactly what
 * a real HTTP client (curl, fetch, browser) puts on the wire. This is
 * deliberately not routed through Node's `http.request`, because that
 * client has its own (irrelevant, client-side) header-encoding quirks
 * that would obscure what we're actually testing: how the *server* side
 * decodes non-ASCII bytes it receives from any spec-compliant client.
 */
function rawHttpRequest(port, { method, path, headers = {}, body = "" }) {
  return new Promise((resolve, reject) => {
    const bodyBytes = Buffer.from(body, "utf8");
    const headerLines = Object.entries(headers)
      .map(([name, value]) => `${name}: ${value}`)
      .join("\r\n");
    const head = Buffer.from(
      `${method} ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\n${headerLines}\r\nContent-Length: ${bodyBytes.length}\r\nConnection: close\r\n\r\n`,
      "utf8",
    );
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(Buffer.concat([head, bodyBytes]));
    });
    let response = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      response = Buffer.concat([response, chunk]);
    });
    socket.on("end", () => {
      const headerEndIndex = response.indexOf("\r\n\r\n");
      const headerText = response.slice(0, headerEndIndex).toString("utf8");
      const [statusLine] = headerText.split("\r\n");
      const statusCode = Number(statusLine.split(" ")[1]);
      const rawBody = response.slice(headerEndIndex + 4);
      const isChunked = /transfer-encoding:\s*chunked/i.test(headerText);
      const bodyText = (isChunked ? dechunk(rawBody) : rawBody).toString("utf8");
      resolve({ statusCode, bodyText });
    });
    socket.on("error", reject);
  });
}

/** Minimal chunked-transfer-encoding decoder for test response bodies. */
function dechunk(buffer) {
  const parts = [];
  let offset = 0;
  while (offset < buffer.length) {
    const lineEnd = buffer.indexOf("\r\n", offset);
    if (lineEnd === -1) break;
    const sizeHex = buffer.slice(offset, lineEnd).toString("ascii");
    const size = Number.parseInt(sizeHex, 16);
    if (!Number.isFinite(size) || size === 0) break;
    const chunkStart = lineEnd + 2;
    parts.push(buffer.slice(chunkStart, chunkStart + size));
    offset = chunkStart + size + 2; // skip trailing \r\n after chunk data
  }
  return Buffer.concat(parts);
}

test("createEvalServer authorizes a non-ASCII token sent by a real HTTP client (encoding mismatch regression)", async () => {
  // Regression test: process.env / JS string literals decode as UTF-8,
  // but Node's http module decodes incoming header bytes as latin1 (one
  // JS char per raw byte). For an ASCII-only token both decodings agree,
  // but a token containing non-ASCII characters would otherwise never
  // match -- rejecting every correctly-presented request forever, the
  // same "configured but unusable" lockout class as the trailing
  // whitespace issue this SDK already guards against.
  //
  // This sends a real UTF-8-encoded Authorization header over a raw TCP
  // socket (see rawHttpRequest above) to faithfully reproduce what a
  // spec-compliant client actually puts on the wire, rather than relying
  // on Node's own http.request client (which has separate, irrelevant
  // header-encoding behavior on the sending side).
  const token = "s3cret_测试_🎉";

  const server = createEvalServer({
    token,
    runTurn: async () => [{ event_type: "run_started", source: "mock_agent" }],
  });
  await listen(server);
  const port = server.address().port;

  try {
    const authorized = await rawHttpRequest(port, {
      method: "POST",
      path: "/v1/eval/runs",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ run_id: "non_ascii_token_authorized", prompt: "hi" }),
    });
    assert.equal(authorized.statusCode, 200);
    assert.equal(JSON.parse(authorized.bodyText).run_id, "non_ascii_token_authorized");

    // A genuinely wrong token must still be rejected.
    const rejected = await rawHttpRequest(port, {
      method: "POST",
      path: "/v1/eval/runs",
      headers: { Authorization: "Bearer wrong-token" },
      body: JSON.stringify({ run_id: "non_ascii_token_wrong", prompt: "hi" }),
    });
    assert.equal(rejected.statusCode, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createEvalServer explicit options.token takes precedence over the env var", async () => {
  process.env.AGENTBEAT_EVAL_TOKEN = "env-secret-token";

  const server = createEvalServer({
    token: "explicit-token",
    runTurn: async () => [{ event_type: "run_started", source: "mock_agent" }],
  });
  await listen(server);
  const address = server.address();
  const baseURL = `http://127.0.0.1:${address.port}`;

  try {
    // The env var value must NOT work once an explicit token is set.
    await assert.rejects(
      requestJSON(`${baseURL}/v1/eval/runs`, {
        method: "POST",
        headers: { authorization: "Bearer env-secret-token" },
        body: { run_id: "precedence_run", prompt: "hi" },
      }),
      /HTTP 401/,
    );

    const created = await requestJSON(`${baseURL}/v1/eval/runs`, {
      method: "POST",
      headers: { authorization: "Bearer explicit-token" },
      body: { run_id: "precedence_run", prompt: "hi" },
    });
    assert.equal(created.run_id, "precedence_run");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createEvalServer uses a protocol-agnostic default source/protocol_version/target when unset", async () => {
  const server = createEvalServer({
    runTurn: async () => [{ event_type: "run_started" }],
  });
  await listen(server);
  const address = server.address();
  const baseURL = `http://127.0.0.1:${address.port}`;

  try {
    const created = await requestJSON(`${baseURL}/v1/eval/runs`, {
      method: "POST",
      body: { run_id: "default_source_run", prompt: "hi" },
    });
    // The raw run_started event has no source of its own, and neither did
    // the runTurn output declare one, so the synthesized final_answer
    // falls back to the server's protocol-agnostic default (the adapter
    // name), not a hardcoded Codex-specific string.
    const finalAnswer = created.runtime_events.find((event) => event.event_type === "final_answer");
    assert.equal(finalAnswer.source, "agentbeat-sdk");

    // Both events end up sharing the same source once normalized into
    // trace_events, since buildTraceEvents falls back to the same default
    // for the source-less run_started event.
    const runStartedTrace = created.trace_events.find((event) => event.event_type === "run_started");
    const finalAnswerTrace = created.trace_events.find((event) => event.event_type === "final_answer");
    assert.equal(runStartedTrace.source, finalAnswerTrace.source);
    assert.equal(runStartedTrace.source, "agentbeat-sdk");

    assert.equal(created.eval_run.protocol_version, "agentbeat.eval.v1");
    assert.equal(created.eval_run.target, "agent");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createEvalServer accepts an object runTurn result with explicit status and trace", async () => {
  const server = createEvalServer({
    runTurn: async () => ({
      runtimeEvents: [{ event_type: "run_started", source: "mock_agent" }],
      status: "failed",
      source: "mock_agent",
      trace: { adapter: "mock-agent-adapter" },
    }),
  });
  await listen(server);
  const address = server.address();
  const baseURL = `http://127.0.0.1:${address.port}`;

  try {
    const created = await requestJSON(`${baseURL}/v1/eval/runs`, {
      method: "POST",
      body: { run_id: "failed_run", prompt: "hi" },
    });
    assert.equal(created.status, "failed");
    assert.equal(created.eval_run.status, "failed");
    assert.deepEqual(created.trace, { adapter: "mock-agent-adapter" });
    assert.ok(created.runtime_events.some((event) => event.event_type === "final_answer" && event.source === "mock_agent"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
