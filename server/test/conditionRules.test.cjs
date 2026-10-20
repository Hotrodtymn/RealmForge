require('tsx/cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const { attackEffects, movement, preventsActions } = require('../src/conditionRules.ts')
const conditionRules = require('../src/conditionRules.ts')

const c = (condition, sourceCombatantId) => ({ condition, sourceCombatantId })

test('automatic attack advantage and disadvantage sources cancel regardless of count', () => {
  const result = attackEffects('a', 'b', [c('blinded'), c('poisoned')], [c('blinded'), c('restrained'), c('stunned')], 'normal')
  assert.equal(result.mode, 'normal')
  assert.equal(result.advantageSources.length, 3)
  assert.equal(result.disadvantageSources.length, 2)
})

test('manual mode combines with automatic condition sources and charmed source blocks its attacker', () => {
  assert.equal(attackEffects('a', 'b', [c('poisoned')], [], 'advantage').mode, 'normal')
  const blocked = attackEffects('a', 'b', [c('charmed', 'b')], [], 'normal')
  assert.match(blocked.blockedReason, /cannot attack its charmer/)
})

test('conditional frightened, invisible, prone, and critical effects require explicit context', () => {
  const missing = attackEffects('a', 'b', [c('frightened', 'c'), c('invisible')], [c('invisible'), c('prone'), c('paralyzed')], 'normal')
  assert.equal(missing.mode, 'advantage', 'an unverified modifier is warned about while automatic Paralyzed Advantage still applies')
  assert.equal(missing.criticalOnHit, false)
  assert(missing.warnings.length >= 4)
  const verified = attackEffects('a', 'b', [c('frightened', 'c'), c('invisible')], [c('invisible'), c('prone'), c('paralyzed')], 'normal', { fearSourceVisible: true, targetCanSeeAttacker: false, attackerCanSeeTarget: false, distanceFeet: 5 })
  assert.equal(verified.mode, 'normal', 'any Advantage and Disadvantage cancel regardless of source count')
  assert.equal(verified.criticalOnHit, true)
  assert.equal(verified.advantageSources.length, 3)
  assert.equal(verified.disadvantageSources.length, 2)
  const beyond = attackEffects('a', 'b', [], [c('unconscious')], 'normal', { distanceFeet: 10 })
  assert.equal(beyond.criticalOnHit, false)
})

test('action blocking and movement speed restrictions use saved conditions', () => {
  assert.equal(preventsActions([c('deafened'), c('stunned')]).length, 1)
  assert.deepEqual(movement(30, [c('grappled'), c('prone')]), { effectiveSpeed: 0, reasons: ['grappled sets Speed to 0'], prone: true, standCost: null, adjudication: [] })
  assert.equal(movement(25, [c('prone')]).standCost, 12)
  assert.equal(movement(30, [c('stunned')]).effectiveSpeed, 30)
  assert.match(movement(30, [c('stunned')]).adjudication[0], /does not set Speed to 0/)
})

test('Exhaustion applies cumulative D20 penalties and reduces Speed with a zero floor', () => {
  for (let level = 0; level <= 6; level += 1) assert.equal(conditionRules.exhaustionPenalty(level), -2 * level)
  assert.equal(movement(30, [{ condition: 'exhaustion', level: 2 }]).effectiveSpeed, 20)
  assert.equal(movement(25, [{ condition: 'exhaustion', level: 6 }]).effectiveSpeed, 0)
  assert.throws(() => conditionRules.exhaustionPenalty(7), /0 to 6/)
})

test('each supported condition exposes its core mechanical summary and automatic attack rule', () => {
  const keys = ['blinded','charmed','deafened','frightened','grappled','incapacitated','invisible','paralyzed','poisoned','prone','restrained','stunned','unconscious']
  for (const key of keys) assert.equal(typeof require('../src/conditionRules.ts').summary(key), 'string', `${key} summary`)
  assert.equal(attackEffects('a','b',[c('blinded')],[],'normal').mode,'disadvantage')
  assert.equal(attackEffects('a','b',[c('poisoned')],[],'normal').mode,'disadvantage')
  assert.equal(attackEffects('a','b',[c('restrained')],[],'normal').mode,'disadvantage')
  assert.equal(attackEffects('a','b',[c('prone')],[],'normal').mode,'disadvantage')
  assert.equal(attackEffects('a','b',[c('frightened','fear')],[],'normal',{fearSourceVisible:true}).mode,'disadvantage')
  assert.equal(attackEffects('a','b',[c('grappled','grappler')],[],'normal').mode,'disadvantage')
  assert.equal(attackEffects('a','b',[c('grappled','b')],[],'normal').mode,'normal')
  assert.equal(attackEffects('a','b',[],[c('blinded')],'normal').mode,'advantage')
  assert.equal(attackEffects('a','b',[],[c('stunned')],'normal').mode,'advantage')
  assert.equal(attackEffects('a','b',[],[c('restrained')],'normal').mode,'advantage')
  assert.equal(attackEffects('a','b',[],[c('prone')],'normal',{distanceFeet:10}).mode,'disadvantage')
  assert.equal(attackEffects('a','b',[],[c('invisible')],'normal',{attackerCanSeeTarget:false}).mode,'disadvantage')
  assert.equal(attackEffects('a','b',[c('invisible')],[],'normal',{targetCanSeeAttacker:false}).mode,'advantage')
  assert.equal(attackEffects('a','b',[],[c('paralyzed')],'normal').mode,'advantage')
  assert.equal(attackEffects('a','b',[],[c('unconscious')],'normal').mode,'advantage')
  assert.equal(attackEffects('a','b',[],[c('petrified')],'normal').mode,'advantage')
})
