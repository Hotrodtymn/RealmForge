export type LaunchCharacter = { id: string; name: string; status: string; species?: string; characterClass?: string; level?: number }
export type LaunchPlayer = { playerId: string; displayName: string; characters?: LaunchCharacter[] }
export type EligibleLaunchCharacter = LaunchCharacter & { playerId: string; playerName: string }
export type OpeningSceneInput = { id: string; locationId: string | null; title: string; description: string }
export const launchConfiguration: Readonly<{ dmMode: 'ai'; theme: 'dark-fantasy'; worldCreation: 'surprise'; length: 'short' }>
export function supportedLaunchConfiguration(value: unknown): boolean
export function eligibleLaunchCharacters(players: LaunchPlayer[]): EligibleLaunchCharacter[]
export function launchSessionRequest(characterId: string, openingScene: OpeningSceneInput | null, requestId: string): { requestId: string; characterId: string; locationId: string | null; sceneTitle: string; sceneDescription: string }
export function summarizePreview<TLocation extends { isStartingLocation: boolean }, TNpc, TObjective>(preview: { campaign: unknown; locations: TLocation[]; npcs: TNpc[]; mainQuest?: { objectives?: TObjective[] } } | null): { startingLocation: TLocation | null; otherLocations: TLocation[]; npcs: TNpc[]; objectives: TObjective[] } | null
export function playerSelectionFromSearch(search: string): { campaignId: string; adventureId: string; sessionId: string }
export function requestWorldPreview(fetcher: typeof fetch, url: string, signal?: AbortSignal): Promise<{ preview: unknown; previewToken: string }>
export function saveWorldPreview(fetcher: typeof fetch, url: string, previewToken: string): Promise<{ status: number; campaign: { id: string; name?: string }; adventure: { id: string; title: string }; referenceMap?: { openingScene?: string } }>
export function postOpeningSession(fetcher: typeof fetch, url: string, body: Record<string, unknown>): Promise<{ session: { id: string }; status: number }>
