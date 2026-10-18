export interface CombatantMarkers {
  active: boolean
  attacker: boolean
  target: boolean
}

export function getHpPercentage(currentHp: number, maxHp: number): number {
  if (!Number.isFinite(currentHp) || !Number.isFinite(maxHp) || maxHp <= 0) return 0
  return Math.max(0, Math.min(100, currentHp / maxHp * 100))
}

export function getCombatantMarkers(combatantId: string, activeId: string | null, attackerId: string, targetId: string): CombatantMarkers {
  return { active: combatantId === activeId, attacker: combatantId === attackerId, target: combatantId === targetId }
}
