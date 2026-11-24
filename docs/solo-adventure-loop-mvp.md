# Solo adventure loop — implementation contract

Status: implementation in progress. This document is a plan, not a claim that the gameplay loop works.

## MVP user journey
1. Select an existing campaign and start or resume a solo session.
2. Load persisted campaign/world context and recent session turns.
3. Ask the existing Ollama narration service for an opening scene.
4. Submit one player action; display the action and the DM's response in chronological order.
5. When a check is needed, the server rolls dice and applies the relevant modifier; the model must not invent a roll.
6. Persist each completed turn and relevant state changes atomically; reload them after restarting the app.
7. Provide actionable errors when Ollama is offline, without losing the player's submitted action.

## Implementation boundaries
- Keep existing /dm and /player views; do not treat them as authenticated security roles.
- Keep API bound to loopback; do not expose it to LAN/public internet.
- Reuse existing Ollama diagnostics/narration, campaign storage, and world persistence where compatible.
- Add server-side session and turn persistence in SQLite with migration/backward compatibility.
- Keep 2024 D&D mechanics limited to basic d20 ability checks and saving throws for the first iteration.
- Use server-generated randomness, never LLM-generated numeric dice outcomes.
- Do not allow model output to directly mutate database state without validation.
- Do not implement multiplayer, payments, accounts, or combat automation in this milestone.

## Acceptance criteria
- Existing campaign opens in solo play and resumes after application restart.
- Opening narration and two consecutive player actions produce ordered, persisted turns.
- A basic d20 check reports the actual roll, modifier, and total.
- Ollama unavailable returns a recoverable error; prior session data remains intact.
- Existing campaign and world workflows still work.
- Client/server tests and builds pass locally; manual Ollama integration test remains required on the user's machine.

## Suggested implementation slices
1. Inspect existing client/server API contracts and SQLite schema.
2. Implement session/turn data model and persistence tests.
3. Add API to start/resume sessions and submit actions.
4. Integrate existing narration with bounded context.
5. Add adventure UI and basic deterministic rules resolution.
6. Run regression checks and document local Ollama smoke test.
