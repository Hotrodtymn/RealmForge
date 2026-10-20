# Stage 5.2B-3 — Launch Campaign

## Interface

The dashboard now has a **Launch Campaign** action. It opens a six-step workflow without replacing the existing manual campaign form or Adventures editor. Human Dungeon Master mode opens the existing manual campaign form. AI-assisted Human DM is labeled as coming later; it cannot be selected. The only enabled generation setup is AI Dungeon Master, dark fantasy, surprise generation, and short adventure.

The AI path calls `POST /api/ai/world/preview`, retains the server-issued preview token only in component memory, and renders the validated preview before saving. Generation has a six-minute client timeout and a cancel-request action. The preview API does not expose server-side cancellation, so aborting closes the browser request; local model work may continue until the backend request finishes, but no campaign is saved. Saving posts only `{ previewToken }` to `POST /api/ai/world/save`; the UI accepts both initial `201` and idempotent replay `200` responses. It does not send client-authored world content.

## Roster and character ownership

The saved campaign is loaded from the normal campaign, player, character, and adventure APIs. The workflow only offers active or prepared characters already in that generated campaign's roster. It does not transfer or copy characters from another campaign. If the new roster is empty, a local player membership and level 1 prepared character can be created in the new campaign using the existing endpoints and rules.

## Session initialization and recovery

The workflow loads the persisted opening scene template (including its location ID, title, and description) and passes these values to the existing adventure session endpoint. Starting requires an explicit confirmation. A UUID request ID is retained for retries in the current page session; changing the selected character creates a new ID. A failed session start leaves the saved world and preview intact for retry.

After a successful start, **Enter Adventure** opens `/player?campaignId=…&adventureId=…&sessionId=…`. The player view reads those query parameters, loads the requested session, and selects it after a refresh. No server or database schema changes were needed.

## Validation and security

World-generation and persistence remain on the existing loopback-only APIs. Campaign membership and character ownership are enforced by existing server routes. This UI stage does not add authentication or extend access to LAN/remote clients. The preview token is transient client state and is not written to localStorage or logged.

## Manual test procedure

1. Start the local RealmForge backend and Ollama with `llama3.1:8b` available.
2. Open the DM dashboard and choose **Launch Campaign**.
3. Confirm the supported AI configuration is selected; verify Human Dungeon Master opens the existing manual campaign form and assisted mode is disabled/labeled as future work.
4. Choose **Generate world preview**. Confirm loading feedback appears, cancel works, and a successful result displays campaign premise/setting, all locations/NPCs/objectives, mystery, possible resolution, and opening scene. Verify no campaign appears in the dashboard before Save.
5. Choose **Save campaign**. Confirm exactly one campaign and adventure appear in normal management and the launch view displays their IDs. If a response is interrupted, retry with the same preview token and verify the same saved IDs are returned.
6. Select an active/prepared character on the generated campaign roster, or add a player and level 1 character. Verify characters from other campaign rosters are not offered.
7. Choose **Start opening session**, confirm the character/location dialog, and verify session start is initialized with the stored opening scene. Simulate an error or retry and verify the workflow does not regenerate or resave the world.
8. Choose **Enter Adventure**. Confirm `/player` shows the selected campaign, adventure, and session. Refresh the page and confirm the same session is selected.
9. Repeat from `/` and verify the legacy dashboard and manual campaign creation still work.

## Limitations and next steps

The preview token, workflow progress, and session retry key are held in memory; a browser refresh before saving loses the preview token. Saved campaigns remain available in normal campaign/adventure management. A session-start retry is idempotent during the current page session; if the page closes before an ambiguous response is resolved, use the Player interface to inspect existing sessions. Player identity remains the existing local roster model. This stage does not add free-text AI actions, dynamic world expansion, authentication, or network access.
