export interface InitiativeCombatant {
  id: string
  initiativeTotal: number | null
  insertionOrder: number
}

export interface TurnState {
  status: 'setup' | 'active'
  round: number
  activeCombatantId: string | null
}

export function sortCombatants<T extends InitiativeCombatant>(combatants: readonly T[]): T[] {
  return [...combatants].sort((left, right) => {
    if (left.initiativeTotal === null && right.initiativeTotal !== null) return 1
    if (left.initiativeTotal !== null && right.initiativeTotal === null) return -1
    if (left.initiativeTotal !== null && right.initiativeTotal !== null && left.initiativeTotal !== right.initiativeTotal) {
      return right.initiativeTotal - left.initiativeTotal
    }
    return left.insertionOrder - right.insertionOrder
  })
}

export function startTurn(combatants: readonly InitiativeCombatant[]): TurnState | null {
  const ordered = sortCombatants(combatants)
  if (ordered.length === 0 || ordered.some((combatant) => combatant.initiativeTotal === null)) return null
  return { status: 'active', round: 1, activeCombatantId: ordered[0]!.id }
}

export function advanceTurn(state: TurnState, combatants: readonly InitiativeCombatant[]): TurnState | null {
  const ordered = sortCombatants(combatants).filter((combatant) => combatant.initiativeTotal !== null)
  if (ordered.length === 0) return null
  const currentIndex = ordered.findIndex((combatant) => combatant.id === state.activeCombatantId)
  if (currentIndex === -1) return { status: 'active', round: Math.max(1, state.round), activeCombatantId: ordered[0]!.id }
  if (currentIndex === ordered.length - 1) {
    return { status: 'active', round: state.round + 1, activeCombatantId: ordered[0]!.id }
  }
  return { status: 'active', round: state.round, activeCombatantId: ordered[currentIndex + 1]!.id }
}
