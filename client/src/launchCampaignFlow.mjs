export const launchConfiguration = Object.freeze({
  dmMode: 'ai',
  theme: 'dark-fantasy',
  worldCreation: 'surprise',
  length: 'short',
})

export function supportedLaunchConfiguration(value) {
  return value?.dmMode === launchConfiguration.dmMode
    && value?.theme === launchConfiguration.theme
    && value?.worldCreation === launchConfiguration.worldCreation
    && value?.length === launchConfiguration.length
}

export function eligibleLaunchCharacters(players) {
  return (Array.isArray(players) ? players : []).flatMap((player) =>
    (Array.isArray(player.characters) ? player.characters : [])
      .filter((character) => character.status === 'active' || character.status === 'prepared')
      .map((character) => ({ ...character, playerId: player.playerId, playerName: player.displayName })),
  )
}

export function launchSessionRequest(characterId, openingScene, requestId) {
  if (!characterId || !openingScene?.id || !requestId) throw new Error('Choose a character and load the saved opening scene before starting.')
  return {
    requestId,
    characterId,
    locationId: openingScene.locationId ?? null,
    sceneTitle: openingScene.title,
    sceneDescription: openingScene.description,
  }
}

export function summarizePreview(preview) {
  if (!preview || !preview.campaign || !Array.isArray(preview.locations) || !Array.isArray(preview.npcs)) return null
  return {
    startingLocation: preview.locations.find((location) => location.isStartingLocation) ?? null,
    otherLocations: preview.locations.filter((location) => !location.isStartingLocation),
    npcs: preview.npcs,
    objectives: Array.isArray(preview.mainQuest?.objectives) ? preview.mainQuest.objectives : [],
  }
}

export function playerSelectionFromSearch(search) {
  const query = new URLSearchParams(search)
  return { campaignId: query.get('campaignId') ?? '', adventureId: query.get('adventureId') ?? '', sessionId: query.get('sessionId') ?? '' }
}

async function responsePayload(response) {
  try { return await response.json() } catch { return {} }
}

export async function requestWorldPreview(fetcher, url, signal) {
  const response = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(launchConfiguration), signal })
  const result = await responsePayload(response)
  if (!response.ok || !result.preview || typeof result.previewToken !== 'string' || !result.previewToken) throw new Error(result.error || 'The preview response was incomplete. No campaign was saved; you can try again.')
  return { preview: result.preview, previewToken: result.previewToken }
}

export async function saveWorldPreview(fetcher, url, previewToken) {
  const response = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ previewToken }) })
  const result = await responsePayload(response)
  if (![200, 201].includes(response.status) || !result.campaign?.id || !result.adventure?.id) throw new Error(result.error || 'The world was not confirmed as saved. Retry using the same preview token.')
  return { status: response.status, campaign: result.campaign, adventure: result.adventure, referenceMap: result.referenceMap }
}

export async function postOpeningSession(fetcher, url, body) {
  const response = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const result = await responsePayload(response)
  if (!response.ok || !result.session?.id) throw new Error(result.error || 'The campaign is saved. Session start failed; retry without generating or saving again.')
  return { session: result.session, status: response.status }
}
