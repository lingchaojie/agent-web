## Context

The current implementation starts Claude Code through a PTY runner and derives live conversation blocks by cleaning terminal frames in `terminalText.ts`. That compatibility layer can suppress known chrome, but it cannot be authoritative: native Claude Code status, model, token, thinking, permission, and redraw output formats change frequently and can appear adjacent to durable content. The user's latest screenshot feedback confirms that matching terminal text is not a stable foundation for a native-like web client.

The project already has a more reliable source for historical sessions: local Claude JSONL history restoration parses structured transcript entries. The live-session path should move toward the same class of structured event source, but it must not expose those entries as raw chat bubbles. Instead, structured events should drive a CLI-like render state similar to Claude Code's native terminal surface: one active output area updates in place, durable transcript regions remain stable, and status/progress/thinking stays transient. PTY should remain available for sending user input and as a degraded fallback only when structured events cannot be obtained.

## Goals / Non-Goals

**Goals:**
- Discover and validate the best available Claude Code structured event source before changing live transcript semantics.
- Introduce a `ClaudeEventSource` boundary that emits typed user, assistant, tool, permission/action, lifecycle, usage/activity, and error events.
- Add a server-side CLI-like render reducer that turns typed Claude events into render regions, active stream state, transient status, tool panels, and interaction controls.
- Make the realtime hub stream render-state snapshots/deltas, not raw assistant/system/tool event bubbles.
- Keep PTY terminal output as an input transport and fallback compatibility source, clearly separated from structured render semantics.
- Align JSONL history restoration with the same render-region model so restored content can seed the live CLI-like surface.
- Preserve ordered snapshot/delta/reconnect behavior while replacing the origin and shape of live UI semantics.
- Verify mobile behavior against `~/test_claude` with screenshot-driven cases and structured fixtures.

**Non-Goals:**
- Rendering raw structured events one-for-one as chat messages.
- Recreating every terminal animation detail beyond the core Claude Code CLI streaming interaction model.
- Removing PTY support entirely; it remains necessary for interaction and fallback.
- Depending on undocumented terminal status strings as the primary durable transcript contract.
- Adding broad regex coverage for every new leaked status line except as fallback-mode containment.

## Decisions

### 1. Add a structured event adapter boundary

Create a backend interface such as `ClaudeEventSource` with a narrow event contract:

- `session-started` / `session-stopped` / `session-failed`
- `user-message`
- `assistant-message-started` / `assistant-message-delta` / `assistant-message-completed`
- `tool-use-started` / `tool-use-updated` / `tool-use-completed`
- `permission-requested` / `choice-requested`
- `usage-or-activity-updated`
- `structured-source-unavailable`

This adapter hides whether the events come from Claude Code JSON output, local JSONL tailing, an SDK/API session stream, or a future official session event mechanism.

**Rationale:** the realtime hub should not know about PTY escape codes or native terminal chrome. It should receive already-typed semantic events.

**Alternative considered:** keep expanding `terminalText.ts`. Rejected because the screenshot feedback shows each real session can expose new chrome variants and ordering failures.

### 2. Probe structured event mechanisms before implementation

The first implementation task must empirically inspect the installed Claude Code capabilities in this environment. Candidate sources include:

- Claude Code CLI flags or environment variables that emit JSON/stream-json output.
- Local Claude session JSONL files written during live sessions.
- A Claude Agent SDK/API session stream if available and compatible with local project control.
- Any documented local session/event protocol exposed by the installed Claude Code version.

The probe should produce a small capability report in tests or fixtures, not a long-lived design doc. If multiple sources exist, prefer the one that provides stable message IDs and event ordering.

**Rationale:** designing the adapter without verifying the actual installed mechanism risks replacing one guess with another.

### 3. Use structured events for CLI-like render state, PTY for fallback only

When structured events are available, the visible live UI MUST be produced by a render-state reducer, not by directly appending every structured event as a transcript block. PTY output in this mode may update coarse activity state or provide strictly-scoped interaction fallback, but MUST NOT create assistant/user/tool render regions.

When structured events are unavailable, the system may enter fallback mode and use the existing PTY normalizer with explicit source metadata, degraded-mode UI state, and regression tests.

**Rationale:** this prevents both terminal chrome and raw structured system/status/thinking events from becoming visible assistant prose or chat bubbles.

### 4. Replace the live stream contract with render-state snapshots/deltas

The WebSocket protocol should evolve from block-level chat deltas (`block-added`, `block-updated`, `block-finalized`) to render-state deltas that can express:

- stable render regions for durable user/assistant/tool/system/interaction content;
- one active assistant stream region that updates in place;
- transient status/activity that replaces itself rather than entering history;
- inline permission/choice controls;
- degraded fallback source metadata.

Existing reconnect semantics should remain monotonic and resumable, but the client should render a CLI-like session surface from state rather than a raw event log.

**Rationale:** preserving the old block protocol keeps pushing the implementation toward chat bubbles. The native Claude Code experience is stateful streaming, not an event-by-event transcript.

### 5. Unify live and restored render-region mapping

Extract reusable mapping logic from JSONL history restoration and the new structured event adapter into a shared server-side normalization layer that maps Claude semantic messages into initial render regions and live render-state updates.

**Rationale:** live sessions, resumed sessions, and restored history should not disagree about what is durable conversation content, active stream content, tool UI, permission prompt, or transient status.

### 6. Preserve ordering and delivery guarantees

The realtime hub must keep the existing guarantees:

- User input is not added to render state if delivery to the runner fails.
- If structured output arrives synchronously during input delivery, the user region appears before the assistant response region.
- Reconnect snapshots are authoritative and deltas are monotonic.
- Activity/status/thinking/system control events never append visible transcript regions.

**Rationale:** the previous PTY fixes uncovered important ordering and failure semantics that must survive the adapter replacement.

## Risks / Trade-offs

- **Structured source is unavailable or undocumented** → Probe first, keep PTY fallback, and expose degraded mode rather than silently pretending parity.
- **JSONL tailing may lag behind PTY output** → Prefer event sources with explicit flushing/sequence semantics; if tailing JSONL, use stable IDs and tolerate slight UI latency instead of leaking PTY chrome.
- **Claude Code event schema changes** → Isolate parsing in adapter fixtures and schema guards; unknown structured entries become diagnostics or transient activity, not assistant prose and not user-visible chat bubbles by default.
- **Permission/action prompts may only appear in PTY** → Support hybrid mode where structured transcript remains authoritative but PTY can provide interaction controls only when no structured prompt event exists, with strict non-transcript handling.
- **Implementation scope grows across runner, hub, history, and UI** → Stage the work: discovery fixtures first, adapter second, hub integration third, browser verification last.
- **Mobile testing still depends on local Claude behavior** → Keep fixture-driven structured tests and a browser smoke test against `~/test_claude`; record any environment limitation explicitly.

## Migration Plan

1. Add discovery tests/fixtures that identify the available structured Claude Code event source in the current environment.
2. Implement the structured adapter behind a feature-detected runtime path.
3. Add semantic event fixtures and render-reducer tests before changing the hub.
4. Replace the live hub/client block pipeline with structured render-state snapshots/deltas and mark PTY mode as fallback.
5. Keep existing PTY normalizer tests as fallback regression coverage, but remove it from the primary structured render path.
6. Verify automated tests and mobile browser acceptance against `~/test_claude` with real streaming behavior.
7. If structured source discovery fails, pause implementation and report the fallback-only blocker rather than continuing with more terminal matching.

## Open Questions

- Which structured source is actually available from the installed Claude Code version in this environment: CLI JSON output, live JSONL tailing, SDK stream, or another local protocol?
- Can permission prompts be observed structurally, or do they require a PTY-derived interaction fallback?
- Are structured events emitted before or after terminal display updates, and do they include stable message IDs suitable for reconnect/deduplication?
- Does resuming an existing Claude history session emit enough structured metadata to align live deltas with restored blocks without duplicates?
