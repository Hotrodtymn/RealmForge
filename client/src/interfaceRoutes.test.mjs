import test from 'node:test'
import assert from 'node:assert/strict'
import { interfaceGreeting, interfaceModeIndicator, navigationForMode, resolveInterfaceMode } from './interfaceRoutes.mjs'

const navigation = [
  { label: 'Dashboard' }, { label: 'Campaigns' }, { label: 'Adventures' },
  { label: 'Solo Adventure' }, { label: 'Settings' },
]

test('direct route resolution supports DM, Player, and the existing root interface', () => {
  assert.equal(resolveInterfaceMode('/dm'), 'dm')
  assert.equal(resolveInterfaceMode('/dm/'), 'dm')
  assert.equal(resolveInterfaceMode('/player'), 'player')
  assert.equal(resolveInterfaceMode('/player/'), 'player')
  assert.equal(resolveInterfaceMode('/'), 'legacy')
  assert.equal(resolveInterfaceMode('/campaigns'), 'legacy')
})

test('DM navigation keeps administrative features and hides the player-only destination', () => {
  assert.deepEqual(navigationForMode(navigation, 'dm').map(({ label }) => label), ['Dashboard', 'Campaigns', 'Adventures', 'Settings'])
})

test('Player navigation contains only the player adventure interface', () => {
  assert.deepEqual(navigationForMode(navigation, 'player').map(({ label }) => label), ['Solo Adventure'])
})

test('legacy navigation remains unchanged', () => {
  assert.deepEqual(navigationForMode(navigation, 'legacy'), navigation)
})

test('mode indicators are specific to DM and Player interfaces', () => {
  assert.deepEqual(interfaceModeIndicator('dm'), { label: 'DM MODE', className: 'dm' })
  assert.deepEqual(interfaceModeIndicator('player'), { label: 'PLAYER MODE', className: 'player' })
  assert.equal(interfaceModeIndicator('legacy'), null)
})

test('mode greetings differ while the combined root greeting is preserved', () => {
  assert.equal(interfaceGreeting('dm'), 'Welcome DM')
  assert.equal(interfaceGreeting('player'), 'Welcome Adventurer')
  assert.equal(interfaceGreeting('legacy'), 'Welcome, Adventurer.')
})
