export type ThemeId = 'classic' | 'modern' | 'gothic' | 'tactical'
export function readTheme(storage?: Pick<Storage, 'getItem'>): ThemeId
export function saveTheme(theme: ThemeId, storage?: Pick<Storage, 'setItem'>): void
