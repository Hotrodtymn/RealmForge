export function chooseSession<T extends { id: string; status: string }>(sessions: T[], selectedId?: string): string
export function sceneSelection<T extends { id: string }>(scenes: T[], currentScene: T | null, selectedId?: string): { scene: T | null; isCurrent: boolean }
export function canRecordDecision(sessionStatus: string, isCurrentScene: boolean, decisionText: string, submitting: boolean): boolean
export function playerCharacterSummary(character: { id: string; name: string; species?: string; class?: string; level?: number } | null): { id: string; name: string; species: string; class: string; level: number | null } | null
