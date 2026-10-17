export const DIE_SIDES = [4, 6, 8, 10, 12, 20, 100] as const

export type DieSides = typeof DIE_SIDES[number]
export type RollMode = 'normal' | 'advantage' | 'disadvantage'

export interface DiceRollInput {
  diceCount: number
  sides: number
  modifier: number
  mode: RollMode
}

export interface DiceRollResult {
  diceCount: number
  sides: DieSides
  modifier: number
  mode: RollMode
  diceResults: number[]
  keptIndices: number[]
  subtotal: number
  total: number
  breakdown: string
}

export type RandomWordGenerator = () => number

const MAX_DICE = 20
const MIN_MODIFIER = -1000
const MAX_MODIFIER = 1000
const UINT32_RANGE = 0x1_0000_0000

export function validateDiceRollInput(input: DiceRollInput): void {
  if (!Number.isInteger(input.diceCount) || input.diceCount < 1 || input.diceCount > MAX_DICE) {
    throw new RangeError('Number of dice must be a whole number from 1 to 20.')
  }
  if (!DIE_SIDES.some((sides) => sides === input.sides)) {
    throw new RangeError('Choose one of the available dice: d4, d6, d8, d10, d12, d20, or d100.')
  }
  if (!Number.isInteger(input.modifier) || input.modifier < MIN_MODIFIER || input.modifier > MAX_MODIFIER) {
    throw new RangeError('Modifier must be a whole number from -1000 to 1000.')
  }
  if (input.mode !== 'normal' && input.mode !== 'advantage' && input.mode !== 'disadvantage') {
    throw new RangeError('Choose Normal, Advantage, or Disadvantage roll mode.')
  }
  if (input.mode !== 'normal' && (input.sides !== 20 || input.diceCount !== 1)) {
    throw new RangeError('Advantage and Disadvantage are only available for a single d20.')
  }
}

function secureRandomWord(): number {
  const cryptoApi = globalThis.crypto
  if (!cryptoApi?.getRandomValues) throw new Error('Secure randomness is unavailable in this environment.')
  return cryptoApi.getRandomValues(new Uint32Array(1))[0]!
}

export function randomInteger(max: number, randomWord: RandomWordGenerator = secureRandomWord): number {
  if (!Number.isInteger(max) || max < 1 || max > UINT32_RANGE) {
    throw new RangeError('Random integer maximum must be a whole number from 1 to 2^32.')
  }
  const acceptedRange = Math.floor(UINT32_RANGE / max) * max
  let word: number
  do {
    word = randomWord()
    if (!Number.isInteger(word) || word < 0 || word >= UINT32_RANGE) {
      throw new RangeError('Random source must return an unsigned 32-bit integer.')
    }
  } while (word >= acceptedRange)
  return (word % max) + 1
}

function formatModifier(modifier: number): string {
  return `modifier (${modifier > 0 ? '+' : ''}${modifier})`
}

export function formatRollBreakdown(
  diceCount: number,
  sides: DieSides,
  diceResults: number[],
  keptIndices: number[],
  modifier: number,
  mode: RollMode,
  total: number,
): string {
  if (mode === 'normal') {
    return `${diceCount}d${sides}: ${diceResults.join(' + ')} + ${formatModifier(modifier)} = ${total}`
  }

  const keptIndex = keptIndices[0]!
  const renderedRolls = diceResults.map((result, index) => `${result}${index === keptIndex ? ' (kept)' : ''}`).join(' vs ')
  const label = mode === 'advantage' ? 'Advantage' : 'Disadvantage'
  return `d20 ${label}: ${renderedRolls} + ${formatModifier(modifier)} = ${total}`
}

export function rollDice(input: DiceRollInput, randomWord: RandomWordGenerator = secureRandomWord): DiceRollResult {
  validateDiceRollInput(input)
  const sides = input.sides as DieSides
  const diceToRoll = input.mode === 'normal' ? input.diceCount : 2
  const diceResults = Array.from({ length: diceToRoll }, () => randomInteger(sides, randomWord))
  let keptIndices = diceResults.map((_result, index) => index)

  if (input.mode === 'advantage') {
    const keptIndex = diceResults[1]! > diceResults[0]! ? 1 : 0
    keptIndices = [keptIndex]
  } else if (input.mode === 'disadvantage') {
    const keptIndex = diceResults[1]! < diceResults[0]! ? 1 : 0
    keptIndices = [keptIndex]
  }

  const subtotal = keptIndices.reduce((sum, index) => sum + diceResults[index]!, 0)
  const total = subtotal + input.modifier
  return {
    diceCount: input.diceCount,
    sides,
    modifier: input.modifier,
    mode: input.mode,
    diceResults,
    keptIndices,
    subtotal,
    total,
    breakdown: formatRollBreakdown(input.diceCount, sides, diceResults, keptIndices, input.modifier, input.mode, total),
  }
}
