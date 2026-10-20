export function resolveInterfaceMode(pathname) {
  const normalized = typeof pathname === 'string' ? pathname.replace(/\/+$/, '') || '/' : '/'
  if (normalized === '/dm') return 'dm'
  if (normalized === '/player') return 'player'
  return 'legacy'
}

export function navigationForMode(items, mode) {
  if (mode === 'player') return items.filter((item) => item.label === 'Solo Adventure')
  if (mode === 'dm') return items.filter((item) => item.label !== 'Solo Adventure')
  return items.slice()
}

export function interfaceModeIndicator(mode) {
  if (mode === 'dm') return { label: 'DM MODE', className: 'dm' }
  if (mode === 'player') return { label: 'PLAYER MODE', className: 'player' }
  return null
}

export function interfaceGreeting(mode) {
  if (mode === 'dm') return 'Welcome DM'
  if (mode === 'player') return 'Welcome Adventurer'
  return 'Welcome, Adventurer.'
}
