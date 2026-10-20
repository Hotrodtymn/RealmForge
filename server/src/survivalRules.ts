namespace survivalRules {
  export type Status = 'conscious' | 'unconscious' | 'stable' | 'dead'
  export interface State { currentHp: number; maxHp: number; successes: number; failures: number; status: Status }
  export interface Outcome { state: State; message: string }

  export function enterZeroHp(state: State, damage: number, critical: boolean): Outcome {
    if (!Number.isSafeInteger(damage) || damage < 0) throw new Error('Damage must be a nonnegative whole number.')
    if (damage === 0) return { state, message: 'No damage dealt; survival state is unchanged.' }
    if (state.status === 'dead') return { state, message: 'The character is already dead.' }
    const remainingAfterZero = Math.max(0, damage - state.currentHp)
    if (remainingAfterZero >= state.maxHp) {
      return { state: { ...state, currentHp: 0, successes: 0, failures: 3, status: 'dead' }, message: 'Instant death from massive damage.' }
    }
    if (state.currentHp > 0) {
      return { state: { ...state, currentHp: 0, successes: 0, failures: 0, status: 'unconscious' }, message: 'At 0 HP: Unconscious. Death saves are available.' }
    }
    const failures = Math.min(3, state.failures + (critical ? 2 : 1))
    return { state: { ...state, currentHp: 0, failures, successes: state.status === 'stable' ? 0 : state.successes, status: failures >= 3 ? 'dead' : 'unconscious' }, message: failures >= 3 ? 'Three failed death saves. The character has died.' : 'Damage at 0 HP caused a death save failure.' }
  }

  export function deathSave(state: State, naturalRoll: number): Outcome {
    if (!Number.isInteger(naturalRoll) || naturalRoll < 1 || naturalRoll > 20) throw new Error('Death save roll must be a d20 result from 1 to 20.')
    if (state.currentHp !== 0 || state.status !== 'unconscious') throw new Error('Death saves are only available to an unconscious player character at 0 HP.')
    if (naturalRoll === 20) return { state: { ...state, currentHp: 1, successes: 0, failures: 0, status: 'conscious' }, message: 'Natural 20: regain 1 HP and become conscious.' }
    const successes = naturalRoll >= 10 ? Math.min(3, state.successes + 1) : state.successes
    const failures = naturalRoll === 1 ? Math.min(3, state.failures + 2) : naturalRoll <= 9 ? Math.min(3, state.failures + 1) : state.failures
    if (failures >= 3) return { state: { ...state, successes, failures, status: 'dead' }, message: naturalRoll === 1 ? 'Natural 1: two failures; three failures total. The character has died.' : 'Three failed death saves. The character has died.' }
    if (successes >= 3) return { state: { ...state, successes, failures, status: 'stable' }, message: naturalRoll >= 10 ? 'Three successes: Stable at 0 HP.' : 'Stable at 0 HP.' }
    return { state: { ...state, successes, failures }, message: naturalRoll === 1 ? 'Natural 1: two death save failures.' : naturalRoll >= 10 ? 'Death save success.' : 'Death save failure.' }
  }

  export function stabilize(state: State): Outcome {
    if (state.currentHp !== 0 || state.status !== 'unconscious') throw new Error('Only an unconscious player character at 0 HP can be stabilized.')
    return { state: { ...state, successes: 3, failures: 0, status: 'stable' }, message: 'Stable at 0 HP.' }
  }

  export function recover(state: State, currentHp: number, maxHp = state.maxHp): Outcome {
    if (!Number.isSafeInteger(currentHp) || !Number.isSafeInteger(maxHp) || maxHp < 1 || currentHp < 0 || currentHp > maxHp) throw new Error('Hit points are invalid.')
    if (state.status === 'dead' && currentHp > 0) throw new Error('A dead character cannot regain hit points without a resurrection feature.')
    if (currentHp > 0 && state.status !== 'dead') return { state: { ...state, currentHp, maxHp, successes: 0, failures: 0, status: 'conscious' }, message: 'HP regained; death save counters cleared and Unconscious removed.' }
    if (currentHp === 0 && state.currentHp > 0) return { state: { ...state, currentHp, maxHp, successes: 0, failures: 0, status: 'unconscious' }, message: 'At 0 HP: Unconscious.' }
    return { state: { ...state, currentHp, maxHp }, message: 'Hit points updated.' }
  }
}

export = survivalRules
