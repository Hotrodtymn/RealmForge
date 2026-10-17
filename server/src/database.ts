import fs = require('node:fs')
import path = require('node:path')
import sqlite = require('node:sqlite')

const dataDirectory = process.env.REALMFORGE_DATA_DIR
  ? path.resolve(process.env.REALMFORGE_DATA_DIR)
  : path.resolve(__dirname, '../data')
fs.mkdirSync(dataDirectory, { recursive: true })

const database = new sqlite.DatabaseSync(path.join(dataDirectory, 'realmforge.sqlite'))
database.exec('PRAGMA foreign_keys = ON')
database.exec(`
  CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    setting TEXT NOT NULL,
    createdAt TEXT NOT NULL
  )
`)

// Additive schema migration: leave existing campaign rows and tables untouched.
database.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    displayName TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS campaign_memberships (
    id TEXT PRIMARY KEY,
    campaignId TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    playerId TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    displayName TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    UNIQUE (campaignId, playerId)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_memberships_campaign_display_name
    ON campaign_memberships(campaignId, displayName COLLATE NOCASE);

  CREATE TABLE IF NOT EXISTS characters (
    id TEXT PRIMARY KEY,
    membershipId TEXT NOT NULL REFERENCES campaign_memberships(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    species TEXT NOT NULL,
    characterClass TEXT NOT NULL,
    level INTEGER NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 20),
    str INTEGER NOT NULL CHECK (str BETWEEN 1 AND 30),
    dex INTEGER NOT NULL CHECK (dex BETWEEN 1 AND 30),
    con INTEGER NOT NULL CHECK (con BETWEEN 1 AND 30),
    int INTEGER NOT NULL CHECK (int BETWEEN 1 AND 30),
    wis INTEGER NOT NULL CHECK (wis BETWEEN 1 AND 30),
    cha INTEGER NOT NULL CHECK (cha BETWEEN 1 AND 30),
    manualAcOverride INTEGER CHECK (manualAcOverride IS NULL OR manualAcOverride BETWEEN 1 AND 50),
    status TEXT NOT NULL CHECK (status IN ('active', 'prepared', 'dead', 'retired')),
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_characters_one_active_per_membership
    ON characters(membershipId) WHERE status = 'active';

  CREATE INDEX IF NOT EXISTS idx_characters_membership_created
    ON characters(membershipId, createdAt DESC);
`)

// Older local databases may predate character statistics. Add constrained columns
// with migration defaults so existing rows remain usable and are not recreated.
const characterColumns = database.prepare('PRAGMA table_info(characters)').all() as unknown as { name: string }[]
const existingCharacterColumns = new Set(characterColumns.map((column) => column.name))
const characterColumnMigrations: Record<string, string> = {
  level: 'INTEGER NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 20)',
  str: 'INTEGER NOT NULL DEFAULT 10 CHECK (str BETWEEN 1 AND 30)',
  dex: 'INTEGER NOT NULL DEFAULT 10 CHECK (dex BETWEEN 1 AND 30)',
  con: 'INTEGER NOT NULL DEFAULT 10 CHECK (con BETWEEN 1 AND 30)',
  int: 'INTEGER NOT NULL DEFAULT 10 CHECK (int BETWEEN 1 AND 30)',
  wis: 'INTEGER NOT NULL DEFAULT 10 CHECK (wis BETWEEN 1 AND 30)',
  cha: 'INTEGER NOT NULL DEFAULT 10 CHECK (cha BETWEEN 1 AND 30)',
  manualAcOverride: 'INTEGER CHECK (manualAcOverride IS NULL OR manualAcOverride BETWEEN 1 AND 50)',
}

for (const [column, definition] of Object.entries(characterColumnMigrations)) {
  if (!existingCharacterColumns.has(column)) {
    database.exec(`ALTER TABLE characters ADD COLUMN ${column} ${definition}`)
  }
}

database.exec(`
  CREATE TABLE IF NOT EXISTS character_proficiencies (
    characterId TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('saving_throw', 'skill')),
    proficiencyKey TEXT NOT NULL,
    PRIMARY KEY (characterId, kind, proficiencyKey)
  );
  CREATE INDEX IF NOT EXISTS idx_character_proficiencies_character
    ON character_proficiencies(characterId, kind);
`)

database.exec(`
  CREATE TABLE IF NOT EXISTS character_weapon_proficiencies (
    characterId TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    weaponDefinitionId TEXT NOT NULL,
    PRIMARY KEY (characterId, weaponDefinitionId)
  );
  CREATE INDEX IF NOT EXISTS idx_character_weapon_proficiencies_character
    ON character_weapon_proficiencies(characterId);
`)

// Inventory is an additive character-owned table; existing campaign and character rows remain untouched.
database.exec(`
  CREATE TABLE IF NOT EXISTS inventory_items (
    id TEXT PRIMARY KEY,
    characterId TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
    category TEXT NOT NULL CHECK (category IN ('weapon', 'armor', 'shield', 'adventuring_gear', 'consumable', 'treasure', 'other')),
    equipmentSlot TEXT CHECK (equipmentSlot IS NULL OR equipmentSlot IN ('armor', 'shield', 'main_hand', 'off_hand')),
    armorDefinitionId TEXT,
    weaponDefinitionId TEXT,
    weaponAbility TEXT CHECK (weaponAbility IS NULL OR weaponAbility IN ('str', 'dex')),
    manualAttackBonus INTEGER CHECK (manualAttackBonus IS NULL OR manualAttackBonus BETWEEN -20 AND 50),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    weight REAL CHECK (weight IS NULL OR weight >= 0),
    notes TEXT NOT NULL DEFAULT '',
    equipped INTEGER NOT NULL DEFAULT 0 CHECK (equipped IN (0, 1)),
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_inventory_items_character_updated
    ON inventory_items(characterId, updatedAt DESC);
`)

// Add the equipment slot to existing inventory rows without changing their contents.
const inventoryColumns = database.prepare('PRAGMA table_info(inventory_items)').all() as unknown as { name: string }[]
if (!inventoryColumns.some((column) => column.name === 'equipmentSlot')) {
  database.exec(`ALTER TABLE inventory_items ADD COLUMN equipmentSlot TEXT
    CHECK (equipmentSlot IS NULL OR equipmentSlot IN ('armor', 'shield', 'main_hand', 'off_hand'))`)
}
const inventoryRuleMigrations: Record<string, string> = {
  armorDefinitionId: 'TEXT',
  weaponDefinitionId: 'TEXT',
  weaponAbility: "TEXT CHECK (weaponAbility IS NULL OR weaponAbility IN ('str', 'dex'))",
  manualAttackBonus: 'INTEGER CHECK (manualAttackBonus IS NULL OR manualAttackBonus BETWEEN -20 AND 50)',
}
for (const [column, definition] of Object.entries(inventoryRuleMigrations)) {
  if (!inventoryColumns.some((entry) => entry.name === column)) {
    database.exec(`ALTER TABLE inventory_items ADD COLUMN ${column} ${definition}`)
  }
}
database.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_items_unique_equipment_slot
    ON inventory_items(characterId, equipmentSlot) WHERE equipmentSlot IS NOT NULL
`)

// Combat encounters are campaign-owned; combatants reference existing characters where applicable.
database.exec(`
  CREATE TABLE IF NOT EXISTS encounters (
    id TEXT PRIMARY KEY,
    campaignId TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
    status TEXT NOT NULL DEFAULT 'setup' CHECK (status IN ('setup', 'active')),
    round INTEGER NOT NULL DEFAULT 0 CHECK (round >= 0),
    activeCombatantId TEXT REFERENCES encounter_combatants(id) ON DELETE SET NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_encounters_campaign_updated
    ON encounters(campaignId, updatedAt DESC);

  CREATE TABLE IF NOT EXISTS encounter_combatants (
    id TEXT PRIMARY KEY,
    encounterId TEXT NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
    characterId TEXT REFERENCES characters(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('player', 'enemy')),
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
    initiativeModifier INTEGER NOT NULL DEFAULT 0 CHECK (initiativeModifier BETWEEN -100 AND 100),
    initiativeSource TEXT CHECK (initiativeSource IS NULL OR initiativeSource IN ('rolled', 'manual')),
    initiativeRoll INTEGER CHECK (initiativeRoll IS NULL OR initiativeRoll BETWEEN 1 AND 20),
    initiativeTotal INTEGER CHECK (initiativeTotal IS NULL OR initiativeTotal BETWEEN -1000 AND 1000),
    insertionOrder INTEGER NOT NULL CHECK (insertionOrder >= 0),
    currentHp INTEGER NOT NULL DEFAULT 1 CHECK (currentHp >= 0),
    maxHp INTEGER NOT NULL DEFAULT 1 CHECK (maxHp > 0),
    armorClassOverride INTEGER CHECK (armorClassOverride IS NULL OR armorClassOverride BETWEEN 1 AND 50),
    attackModifier INTEGER CHECK (attackModifier IS NULL OR attackModifier BETWEEN -20 AND 50),
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    CHECK ((type = 'player' AND characterId IS NOT NULL) OR (type = 'enemy' AND characterId IS NULL)),
    CHECK ((initiativeSource = 'rolled' AND initiativeRoll IS NOT NULL AND initiativeTotal IS NOT NULL)
      OR (initiativeSource = 'manual' AND initiativeRoll IS NULL AND initiativeTotal IS NOT NULL)
      OR (initiativeSource IS NULL AND initiativeRoll IS NULL AND initiativeTotal IS NULL))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_encounter_combatants_character_once
    ON encounter_combatants(encounterId, characterId) WHERE characterId IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_encounter_combatants_insertion_order
    ON encounter_combatants(encounterId, insertionOrder);
  CREATE INDEX IF NOT EXISTS idx_encounter_combatants_encounter
    ON encounter_combatants(encounterId, initiativeTotal DESC, insertionOrder ASC);
`)

// Add encounter-specific hit points to existing combatants without touching
// their initiative state or rebuilding the existing combat tables.
const combatantColumns = database.prepare('PRAGMA table_info(encounter_combatants)').all() as unknown as { name: string }[]
const existingCombatantColumns = new Set(combatantColumns.map((column) => column.name))
if (!existingCombatantColumns.has('currentHp')) {
  database.exec('ALTER TABLE encounter_combatants ADD COLUMN currentHp INTEGER NOT NULL DEFAULT 1 CHECK (currentHp >= 0)')
}
if (!existingCombatantColumns.has('maxHp')) {
  database.exec('ALTER TABLE encounter_combatants ADD COLUMN maxHp INTEGER NOT NULL DEFAULT 1 CHECK (maxHp > 0)')
}
if (!existingCombatantColumns.has('armorClassOverride')) {
  database.exec('ALTER TABLE encounter_combatants ADD COLUMN armorClassOverride INTEGER CHECK (armorClassOverride IS NULL OR armorClassOverride BETWEEN 1 AND 50)')
}
if (!existingCombatantColumns.has('attackModifier')) {
  database.exec('ALTER TABLE encounter_combatants ADD COLUMN attackModifier INTEGER CHECK (attackModifier IS NULL OR attackModifier BETWEEN -20 AND 50)')
}

database.exec(`
  CREATE TRIGGER IF NOT EXISTS trg_encounter_combatants_hp_insert
  BEFORE INSERT ON encounter_combatants
  WHEN NEW.currentHp > NEW.maxHp
  BEGIN SELECT RAISE(ABORT, 'currentHp cannot exceed maxHp'); END;

  CREATE TRIGGER IF NOT EXISTS trg_encounter_combatants_hp_update
  BEFORE UPDATE OF currentHp, maxHp ON encounter_combatants
  WHEN NEW.currentHp > NEW.maxHp
  BEGIN SELECT RAISE(ABORT, 'currentHp cannot exceed maxHp'); END;

  CREATE TABLE IF NOT EXISTS combatant_conditions (
    id TEXT PRIMARY KEY,
    combatantId TEXT NOT NULL REFERENCES encounter_combatants(id) ON DELETE CASCADE,
    condition TEXT NOT NULL CHECK (condition IN (
      'blinded', 'charmed', 'deafened', 'frightened', 'grappled', 'incapacitated',
      'invisible', 'paralyzed', 'petrified', 'poisoned', 'prone', 'restrained',
      'stunned', 'unconscious', 'exhaustion'
    )),
    level INTEGER,
    createdAt TEXT NOT NULL,
    UNIQUE (combatantId, condition),
    CHECK ((condition = 'exhaustion' AND level BETWEEN 1 AND 6)
      OR (condition <> 'exhaustion' AND level IS NULL))
  );
  CREATE INDEX IF NOT EXISTS idx_combatant_conditions_combatant
    ON combatant_conditions(combatantId);

  -- Attack history stores names and combat values as snapshots. Only the encounter
  -- is referenced so removing or editing combatants/equipment cannot rewrite history.
  CREATE TABLE IF NOT EXISTS encounter_attacks (
    id TEXT PRIMARY KEY,
    encounterId TEXT NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
    attackerId TEXT NOT NULL,
    attackerName TEXT NOT NULL,
    targetId TEXT NOT NULL,
    targetName TEXT NOT NULL,
    weaponId TEXT,
    weaponName TEXT,
    mode TEXT NOT NULL CHECK (mode IN ('normal', 'advantage', 'disadvantage')),
    diceResults TEXT NOT NULL,
    keptIndex INTEGER NOT NULL CHECK (keptIndex >= 0 AND keptIndex < 2),
    attackBonus INTEGER NOT NULL,
    situationalModifier INTEGER NOT NULL,
    total INTEGER NOT NULL,
    targetAC INTEGER NOT NULL CHECK (targetAC BETWEEN 1 AND 50),
    outcome TEXT NOT NULL CHECK (outcome IN ('hit', 'miss', 'critical_hit')),
    createdAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_encounter_attacks_recent
    ON encounter_attacks(encounterId, createdAt DESC);
`)

export = database
