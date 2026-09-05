# RoutineKit

**Your agent did it once. Make it a tool you can run again.**

RoutineKit turns successful, explicitly selected tool calls into **reviewed, parameterized, executable routines**. Change the inputs, check the live tools, approve the run, and replay without asking a model to reconstruct each step.

![Actual capture, approval, and replay in the local workbench](https://raw.githubusercontent.com/sjh9714/routinekit/main/docs/demo.gif)

*A scripted tutorial through a real native-WebMCP browser. [Watch the recording](https://github.com/sjh9714/routinekit/blob/main/docs/demo.mp4).*

Start in **DeepSeek Harness (DSH)**, or use the standalone workbench and **MCP** server with native **WebMCP** pages. Export a routine with a companion `SKILL.md` for another agent to discover and run.

> **v0.1 preview.** This is a deterministic runner for reviewed linear tool workflows, not a general computer-use agent. It does not silently record your desktop, read old chats, reuse login profiles, or promise that an arbitrary task can be generalized from one example.

## Try it locally

Requires Node **22.19+** and a current Chrome/Edge or Playwright Chromium with native WebMCP. Tested locally with Chromium 151 and Chrome 152; browser APIs are experimental and may change.

```sh
npx routinekit doctor
npx routinekit demo
```

The demo opens a local workbench beside a real browser playground. A **disclosed scripted tutorial**, not an LLM, has made two real WebMCP calls: find a sample project and open its returned id.

1. Click **Preview capture**. Notice the input binding and the reference to the first step's returned id.
2. Add a success check, then choose **Review & save** and approve the exact routine:

   ```json
   [{"step":"step_2","path":"/opened","equals":true}]
   ```

3. Enter `timer` (or `drawing`) as the new `category`, then **Review & run**.
4. Approve the run and each WebMCP call. The selected project changes: the second step uses the **new** result id, not the recorded one.

The demo's localhost origin exists only while that process runs. Demo routines deliberately do not silently rebind to a different origin after a restart. For persistent use, connect your own WebMCP app at a stable origin.

No account, model API key, or GPU is needed for the tutorial. If no supported browser is installed:

```sh
npx playwright-core@1.62.1 install chromium
```

## In DeepSeek Harness

```sh
dsh plugin --profile web add routinekit
```

Use DSH **0.1.2-rc.1** for this preview. The plugin registers tools and adds a **RoutineKit** button to the web sidebar. It does not modify the DSH core or replace your existing tool permissions.

Open the panel and choose **Initialize RoutineKit in DSH**, or ask:

> Use routine_tools to list the tools you can record. I want to repeat [my task] with [these changing inputs]. Before doing it, use routine_record with only the needed tools and exact example argument values. Complete the task, show me routine_preview, and propose checks that prove its result. Save only after I approve.

When replaying a DSH-native routine, the panel's **Run in DSH** button queues a `routine_run` request through the current conversation. That launch can use the host model. **The replay engine itself makes zero model calls** and dispatches each step through `ctx.tools.execute`, retaining the same agent scope, cancellation, approval policies, and guards.

Recording is task-local. Saved DSH routines are kept under `DSH_HOME/routinekit` (partitioned by the available workspace/task identity); standalone storage uses `ROUTINEKIT_HOME` or `~/.routinekit`.

The web panel is **loopback-only** in this preview. Remote/LAN access is not supported. If DSH's package-age policy rejects a just-published package, wait for that policy window; do not lower it to install RoutineKit.

## In an MCP client

Add this stdio server using your client's normal MCP configuration:

```json
{
  "mcpServers": {
    "routinekit": {
      "command": "npx",
      "args": ["-y", "routinekit", "mcp"]
    }
  }
}
```

**Human form elicitation is required** for actions. A client without it can list/inspect routines but cannot auto-approve execution. Use `npx routinekit open` for the standalone workbench instead. Do not infer full client compatibility merely from basic MCP support.

Stop settles the active server operation and sends protocol cancellation for pending elicitation. Dismissing the client's approval UI depends on that client's cancellation support.

Typical flow:

```text
routine_web_open → routine_tools → routine_record
→ routine_web_call … → routine_preview → routine_save
→ routine_run with new inputs
```

`routine_record` takes `name`, `inputs_json` (a JSON object of scalar examples), and an explicit `tools` array. `routine_web_call` takes an exact `webmcp:` tool name and `arguments_json`. `routine_run` takes `name` and `inputs_json`. JSON strings keep the interface consistent between DSH and MCP.

Other tools: `routine_list`, `routine_inspect`, `routine_import`, `routine_discard`, and `routine_stop`. Native DSH tools use the `dsh:` namespace and still require those tools in DSH; RoutineKit does not invent cross-host equivalents.

## What gets saved?

A small JSON routine containing:

- Named input types, **without the original example values**.
- Selected tool identities, exact origins when applicable, and input/output contracts.
- Ordered arguments, with parameter bindings and unambiguous references to earlier results.
- Structural output checks and any explicit success checks you add.

Raw recording outputs are kept **only in memory**, up to 40 calls / 15 minutes / bounded JSON size. They are not saved in the routine. **Reviewed literal arguments are saved** and can contain private business data. Inspect them before sharing.

Bindings are inferred only for exact scalar matches. RoutineKit does not infer substrings, loops, branches, transformations, or ambiguous dependencies. Small numeric constants (0/1), booleans, short result strings, and ambiguous values are not automatically linked to earlier results. Review the proposed bindings and test representative changed inputs before relying on a routine.

Contract fingerprints detect schema/origin changes, **not changes to a tool implementation with an unchanged schema**. Shape checks do not prove business success: add checks such as `/opened == true` or a result field matching a named input. Earlier side effects are not rolled back when a later step fails.

## Share an executable skill

```sh
routinekit list
routinekit inspect my-routine
routinekit export my-routine ./my-routine
```

The new directory contains `SKILL.md` and `routine.json`. Existing destinations are never overwritten. Another user reviews the JSON, imports it using `routinekit import routine.json` or `routine_import`, supplies their own inputs, reconnects compatible tools, and approves a fresh run.

An exported skill is **not** a transfer of credentials or consent. Different hosts, tools, origins, or schemas can make a routine intentionally non-runnable. Never silently replace a missing tool with a shell or computer-use fallback.

## Boundaries worth knowing

- Capture is explicit, scoped to selected tools and one DSH task or MCP connection. Overlapping calls or failures invalidate a recording.
- WebMCP uses a fresh browser context: no existing cookies, login profiles, local files, or desktop capture. No polyfill is injected into third-party sites.
- Cross-origin requests, popups, downloads, and service workers are blocked. Cross-origin dependencies can therefore prevent a site from loading. Non-GET requests are blocked outside an approved WebMCP call.
- A site's tool description/read-only hint is untrusted. Every WebMCP call requires approval. An approved call can still change that site's state; this is not a hostile-site security sandbox.
- Credential detection is heuristic. Do not record secrets. DSH, the MCP client, and the website may retain their own logs independently of RoutineKit.
- Local endpoints check socket, Host, Origin, and Fetch Metadata; the standalone API also requires an ephemeral capability token. These checks do not protect against malicious software running as your OS user.
- JSON Schema references, regex constraints, and format constraints are rejected in v0.1. Unsupported contracts stop, rather than being treated as validated.
- Stop cancels replay and closes the RoutineKit-owned browser. DSH-native tools must cooperate with cancellation; RoutineKit cannot hard-kill arbitrary in-process plugins.
- No accounts, cloud backend, telemetry, model sampling, scheduled execution, marketplace, or automatic GitHub actions on the user's account.

## Development

```sh
npm ci
npm run build
npm run check
npm test
npm run test:e2e
```

Unit/integration tests cover binding, result references, changed contracts, explicit success checks, denied approval, cancellation, secret rejection, file boundaries, the real DSH tool pipeline, and real MCP protocol negotiation. Browser E2E exercises three native-WebMCP workflows plus the actual workbench buttons. Test approvals are synthetic; the UI test clicks the same approval controls users see. These are not claims about autonomous model task success.

Please include the DSH/browser version, tool names, expected result, and a **sanitized** minimal reproduction in an issue. Do not attach raw recordings, cookies, tokens, or private routine literals.

## Why another tool?

Record-to-skill projects such as [Microsoft Skill Recorder](https://github.com/microsoft/skill-recorder) demonstrate the value of reusing work. RoutineKit explores a narrower approach: capture structured calls in your existing harness, preserve reviewed data flow, and replay against live contracts. It is not a claim to have invented recording, skills, or workflow engines.

WebMCP is an [experimental web standard](https://github.com/webmachinelearning/webmcp). The browser adapter follows its native discovery/invocation APIs; the [workflow-preservation discussion](https://github.com/webmachinelearning/webmcp/issues/261) is related prior work, not an endorsement or an adopted standard for RoutineKit's JSON format.

If this is useful, a GitHub star helps other builders find it. A small reusable example or a failure case helps improve it even more.

MIT licensed.
