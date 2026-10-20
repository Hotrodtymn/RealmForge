export const themeIds = ['classic', 'modern', 'gothic', 'tactical']

export function readTheme(storage) {
  try {
    const saved = (storage ?? globalThis.localStorage)?.getItem('realmforge-theme')
    return themeIds.includes(saved) ? saved : 'modern'
  } catch {
    return 'modern'
  }
}

export function saveTheme(theme, storage) {
  if (!themeIds.includes(theme)) throw new Error('Unsupported RealmForge theme.')
  try { (storage ?? globalThis.localStorage)?.setItem('realmforge-theme', theme) } catch { /* Theme remains usable for this session. */ }
}
