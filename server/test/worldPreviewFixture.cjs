module.exports = function worldPreview() {
  return {
    campaign: {
      key: 'campaign', title: 'The Bell Beneath the Fen',
      premise: 'A drowned bell tolls each night, drawing the living toward a forgotten marsh shrine.',
      setting: 'A rain-dark borderland of drowned roads and old stone.', startingLocationKey: 'location_causeway',
    },
    locations: [
      { key: 'location_causeway', name: 'Morrowfen Causeway', kind: 'Road', description: 'A raised stone track crosses a wide, black marsh.', isStartingLocation: true },
      { key: 'location_chapel', name: 'Sunken Chapel', kind: 'Ruin', description: 'A roofless chapel sinks into the water beside leaning yews.', isStartingLocation: false },
      { key: 'location_ferry', name: 'Old Ferry House', kind: 'Shelter', description: 'A shuttered ferry house waits beside a broken wooden pier.', isStartingLocation: false },
    ],
    npcs: [
      { key: 'npc_edda', name: 'Edda Vale', role: 'Ferryman who watches the causeway', personality: 'Careful and slow to trust strangers.', motivation: 'She wants the nightly bell silenced before the next flood.', locationKey: 'location_causeway' },
      { key: 'npc_caldus', name: 'Brother Caldus', role: 'Keeper of the ruined chapel', personality: 'Soft-spoken but fiercely protective of the shrine.', motivation: 'He seeks the missing chapel key to protect the village.', locationKey: 'location_chapel' },
      { key: 'npc_mara', name: 'Mara Venn', role: 'Reclusive former ferry keeper', personality: 'Wry, watchful, and uncomfortable around bells.', motivation: 'She hopes to repay an old debt to the people of the fen.', locationKey: 'location_ferry' },
    ],
    mainQuest: {
      key: 'main_quest', title: 'Answer the Drowned Bell',
      description: 'Find why the bell rings beneath the marsh and help the locals decide what to do.',
      objectives: [
        { key: 'objective_ask_edda', description: 'Ask Edda what changed before the first toll.' },
        { key: 'objective_reach_chapel', description: 'Reach the sunken chapel and examine its bell tower.' },
        { key: 'objective_choose_fate', description: 'Learn what sustains the toll and choose how to respond.' },
      ],
      locationKeys: ['location_causeway', 'location_chapel', 'location_ferry'],
    },
    mysteryOrThreat: 'Something beneath the chapel is repeating a warning from the flood that destroyed the old village.',
    openingScene: {
      key: 'opening_scene', title: 'A Toll Through the Rain',
      description: 'Rain beads on the causeway stones as a low bell sounds from beneath the dark water. Edda raises her lantern and asks who else heard it.',
      locationKey: 'location_causeway', questKey: 'main_quest',
    },
    possibleResolution: 'The character may quiet the bell, uncover its warning, or leave the mystery unresolved; the choice belongs to the player.',
  }
}
