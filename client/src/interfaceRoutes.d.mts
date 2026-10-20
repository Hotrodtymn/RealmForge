export type InterfaceMode = 'legacy' | 'dm' | 'player'
export function resolveInterfaceMode(pathname: string): InterfaceMode
export function navigationForMode<T extends { label: string }>(items: readonly T[], mode: InterfaceMode): T[]

export function interfaceModeIndicator(mode: InterfaceMode): { label: string; className: 'dm' | 'player' } | null
export function interfaceGreeting(mode: InterfaceMode): string
