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
    initiativeExhaustionPenalty INTEGER NOT NULL DEFAULT 0 CHECK (initiativeExhaustionPenalty BETWEEN -12 AND 0),
    insertionOrder INTEGER NOT NULL CHECK (insertionOrder >= 0),
    currentHp INTEGER NOT NULL DEFAULT 1 CHECK (currentHp >= 0),
    maxHp INTEGER NOT NULL DEFAULT 1 CHECK (maxHp > 0),
    deathSaveSuccesses INTEGER NOT NULL DEFAULT 0 CHECK (deathSaveSuccesses BETWEEN 0 AND 3),
    deathSaveFailures INTEGER NOT NULL DEFAULT 0 CHECK (deathSaveFailures BETWEEN 0 AND 3),
    survivalStatus TEXT NOT NULL DEFAULT 'conscious' CHECK (survivalStatus IN ('conscious', 'unconscious', 'stable', 'dead')),
    armorClassOverride INTEGER CHECK (armorClassOverride IS NULL OR armorClassOverride BETWEEN 1 AND 50),
    attackModifier INTEGER CHECK (attackModifier IS NULL OR attackModifier BETWEEN -20 AND 50),
    damageFormula TEXT CHECK (damageFormula IS NULL OR length(damageFormula) <= 20),
    damageType TEXT CHECK (damageType IS NULL OR damageType IN ('acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder')),
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
if (!existingCombatantColumns.has('initiativeExhaustionPenalty')) database.exec('ALTER TABLE encounter_combatants ADD COLUMN initiativeExhaustionPenalty INTEGER NOT NULL DEFAULT 0 CHECK (initiativeExhaustionPenalty BETWEEN -12 AND 0)')
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
if (!existingCombatantColumns.has('damageFormula')) {
  database.exec('ALTER TABLE encounter_combatants ADD COLUMN damageFormula TEXT CHECK (damageFormula IS NULL OR length(damageFormula) <= 20)')
}
if (!existingCombatantColumns.has('damageType')) {
  database.exec("ALTER TABLE encounter_combatants ADD COLUMN damageType TEXT CHECK (damageType IS NULL OR damageType IN ('acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'))")
}
const survivalColumnMigrations: Record<string, string> = {
  deathSaveSuccesses: 'INTEGER NOT NULL DEFAULT 0 CHECK (deathSaveSuccesses BETWEEN 0 AND 3)',
  deathSaveFailures: 'INTEGER NOT NULL DEFAULT 0 CHECK (deathSaveFailures BETWEEN 0 AND 3)',
  survivalStatus: "TEXT NOT NULL DEFAULT 'conscious' CHECK (survivalStatus IN ('conscious', 'unconscious', 'stable', 'dead'))",
}
for (const [column, definition] of Object.entries(survivalColumnMigrations)) {
  if (!existingCombatantColumns.has(column)) database.exec(`ALTER TABLE encounter_combatants ADD COLUMN ${column} ${definition}`)
}

// Encounter-scoped action economy. These additive tables preserve existing encounters
// and provide immutable, idempotent action history.
database.exec(`
  CREATE TABLE IF NOT EXISTS encounter_action_state (
    combatantId TEXT PRIMARY KEY REFERENCES encounter_combatants(id) ON DELETE CASCADE,
    actionUsed INTEGER NOT NULL DEFAULT 0 CHECK (actionUsed IN (0, 1)),
    bonusActionUsed INTEGER NOT NULL DEFAULT 0 CHECK (bonusActionUsed IN (0, 1)),
    reactionUsed INTEGER NOT NULL DEFAULT 0 CHECK (reactionUsed IN (0, 1)),
    movementAllowance INTEGER NOT NULL DEFAULT 30 CHECK (movementAllowance BETWEEN 0 AND 300),
    movementUsed INTEGER NOT NULL DEFAULT 0 CHECK (movementUsed >= 0),
    dashBonusMovement INTEGER NOT NULL DEFAULT 0 CHECK (dashBonusMovement BETWEEN 0 AND 300),
    turnCount INTEGER NOT NULL DEFAULT 0 CHECK (turnCount >= 0),
    disengageActive INTEGER NOT NULL DEFAULT 0 CHECK (disengageActive IN (0, 1)),
    dodgeActive INTEGER NOT NULL DEFAULT 0 CHECK (dodgeActive IN (0, 1))
  );
  CREATE TABLE IF NOT EXISTS encounter_action_effects (
    id TEXT PRIMARY KEY,
    encounterId TEXT NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
    ownerCombatantId TEXT NOT NULL REFERENCES encounter_combatants(id) ON DELETE CASCADE,
    targetCombatantId TEXT REFERENCES encounter_combatants(id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK (kind IN ('help', 'ready')),
    helpUse TEXT CHECK (helpUse IS NULL OR helpUse IN ('ability_check', 'attack')),
    description TEXT NOT NULL DEFAULT '',
    triggerText TEXT NOT NULL DEFAULT '',
    responseText TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'cancelled', 'expired')),
    expiresAtOwnerTurn INTEGER NOT NULL,
    createdAt TEXT NOT NULL,
    resolvedAt TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_action_effects_active ON encounter_action_effects(encounterId, status, createdAt DESC);
  CREATE TABLE IF NOT EXISTS encounter_action_events (
    id TEXT PRIMARY KEY,
    actionId TEXT NOT NULL UNIQUE,
    encounterId TEXT NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
    combatantId TEXT,
    combatantName TEXT NOT NULL,
    kind TEXT NOT NULL,
    details TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_action_events_recent ON encounter_action_events(encounterId, createdAt DESC);
  INSERT OR IGNORE INTO encounter_action_state(combatantId)
    SELECT id FROM encounter_combatants;
`)

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
    weaponDefinitionId TEXT,
    weaponUse TEXT CHECK (weaponUse IS NULL OR weaponUse IN ('one_handed', 'two_handed')),
    damageDiceCount INTEGER CHECK (damageDiceCount IS NULL OR damageDiceCount BETWEEN 1 AND 20),
    damageDieSize INTEGER CHECK (damageDieSize IS NULL OR damageDieSize IN (4, 6, 8, 10, 12, 20)),
    versatileDamageDiceCount INTEGER CHECK (versatileDamageDiceCount IS NULL OR versatileDamageDiceCount BETWEEN 1 AND 20),
    versatileDamageDieSize INTEGER CHECK (versatileDamageDieSize IS NULL OR versatileDamageDieSize IN (4, 6, 8, 10, 12, 20)),
    damageType TEXT,
    damageAbility TEXT CHECK (damageAbility IS NULL OR damageAbility IN ('str', 'dex')),
    damageAbilityModifier INTEGER,
    enemyDamageFormula TEXT,
    enemyDamageType TEXT,
    createdAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_encounter_attacks_recent
    ON encounter_attacks(encounterId, createdAt DESC);
`)

const attackColumns = database.prepare('PRAGMA table_info(encounter_attacks)').all() as unknown as { name: string }[]
const existingAttackColumns = new Set(attackColumns.map((column) => column.name))
const conditionColumns = database.prepare('PRAGMA table_info(combatant_conditions)').all() as unknown as { name: string }[]
const existingConditionColumns = new Set(conditionColumns.map((column) => column.name))
const conditionMigrations: Record<string, string> = {
  sourceCombatantId: 'TEXT REFERENCES encounter_combatants(id) ON DELETE SET NULL',
  notes: "TEXT NOT NULL DEFAULT ''",
  durationType: "TEXT NOT NULL DEFAULT 'indefinite' CHECK (durationType IN ('indefinite','turn_boundary','fixed_rounds','recovery_save'))",
  durationCombatantId: 'TEXT REFERENCES encounter_combatants(id) ON DELETE SET NULL',
  durationTiming: "TEXT CHECK (durationTiming IS NULL OR durationTiming IN ('start','end'))",
  remainingRounds: 'INTEGER CHECK (remainingRounds IS NULL OR remainingRounds BETWEEN 1 AND 1000)',
  originalDuration: "TEXT NOT NULL DEFAULT '{}'",
  recoveryAbility: "TEXT CHECK (recoveryAbility IS NULL OR recoveryAbility IN ('str','dex','con','int','wis','cha'))",
  recoveryDc: 'INTEGER CHECK (recoveryDc IS NULL OR recoveryDc BETWEEN 1 AND 40)',
  recoveryTiming: "TEXT CHECK (recoveryTiming IS NULL OR recoveryTiming IN ('start','end'))",
  recoveryNotes: "TEXT NOT NULL DEFAULT ''",
  recoveryModifier: 'INTEGER CHECK (recoveryModifier IS NULL OR recoveryModifier BETWEEN -30 AND 30)',
  configuredAtRound: 'INTEGER NOT NULL DEFAULT 0',
  configuredAtTurnCount: 'INTEGER NOT NULL DEFAULT 0',
  lastRecoveryBoundary: 'TEXT',
}
for (const [column, definition] of Object.entries(conditionMigrations)) {
  if (!existingConditionColumns.has(column)) database.exec(`ALTER TABLE combatant_conditions ADD COLUMN ${column} ${definition}`)
}

database.exec(`
  CREATE TABLE IF NOT EXISTS combatant_condition_events (
    id TEXT PRIMARY KEY,
    eventKey TEXT UNIQUE,
    encounterId TEXT NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
    combatantId TEXT NOT NULL REFERENCES encounter_combatants(id) ON DELETE CASCADE,
    conditionId TEXT,
    condition TEXT NOT NULL,
    eventType TEXT NOT NULL CHECK (eventType IN ('applied','duration_configured','duration_changed','recovery_save_attempted','recovery_save_succeeded','recovery_save_failed','expired','manually_removed','exhaustion_increased','exhaustion_decreased','dm_override')),
    exhaustionLevel INTEGER,
    sourceCombatantId TEXT,
    reason TEXT NOT NULL DEFAULT '',
    previousValue TEXT,
    newValue TEXT,
    rollDetails TEXT,
    createdAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_condition_events_encounter_recent
    ON combatant_condition_events(encounterId, createdAt DESC);
  CREATE TABLE IF NOT EXISTS encounter_turn_transitions (
    actionId TEXT PRIMARY KEY,
    encounterId TEXT NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
    result TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
`)
const attackDamageMigrations: Record<string, string> = {
  weaponDefinitionId: 'TEXT',
  weaponUse: "TEXT CHECK (weaponUse IS NULL OR weaponUse IN ('one_handed', 'two_handed'))",
  damageDiceCount: 'INTEGER CHECK (damageDiceCount IS NULL OR damageDiceCount BETWEEN 1 AND 20)',
  damageDieSize: 'INTEGER CHECK (damageDieSize IS NULL OR damageDieSize IN (4, 6, 8, 10, 12, 20))',
  versatileDamageDiceCount: 'INTEGER CHECK (versatileDamageDiceCount IS NULL OR versatileDamageDiceCount BETWEEN 1 AND 20)',
  versatileDamageDieSize: 'INTEGER CHECK (versatileDamageDieSize IS NULL OR versatileDamageDieSize IN (4, 6, 8, 10, 12, 20))',
  damageType: 'TEXT', damageAbilityModifier: 'INTEGER', enemyDamageFormula: 'TEXT', enemyDamageType: 'TEXT',
  damageAbility: "TEXT CHECK (damageAbility IS NULL OR damageAbility IN ('str', 'dex'))",
  conditionSnapshot: "TEXT NOT NULL DEFAULT '{}'",
}
for (const [column, definition] of Object.entries(attackDamageMigrations)) {
  if (!existingAttackColumns.has(column)) database.exec(`ALTER TABLE encounter_attacks ADD COLUMN ${column} ${definition}`)
}

database.exec(`
  CREATE TABLE IF NOT EXISTS encounter_survival_events (
    id TEXT PRIMARY KEY,
    actionId TEXT NOT NULL UNIQUE,
    campaignId TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    encounterId TEXT NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
    combatantId TEXT NOT NULL REFERENCES encounter_combatants(id) ON DELETE CASCADE,
    action TEXT NOT NULL CHECK (action IN ('death_save', 'stabilize', 'damage_at_zero', 'unconscious', 'recovery')),
    naturalRoll INTEGER CHECK (naturalRoll IS NULL OR naturalRoll BETWEEN 1 AND 20),
    successes INTEGER NOT NULL,
    failures INTEGER NOT NULL,
    survivalStatus TEXT NOT NULL CHECK (survivalStatus IN ('conscious', 'unconscious', 'stable', 'dead')),
    hpBefore INTEGER NOT NULL,
    hpAfter INTEGER NOT NULL,
    detail TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_survival_events_encounter
    ON encounter_survival_events(encounterId, createdAt DESC);
`)

// Existing player combatants at 0 HP enter the new unconscious state safely.
database.exec(`
  UPDATE encounter_combatants SET survivalStatus = 'unconscious'
    WHERE type = 'player' AND currentHp = 0 AND survivalStatus = 'conscious';
  INSERT OR IGNORE INTO combatant_conditions (id, combatantId, condition, level, createdAt)
    SELECT lower(hex(randomblob(16))), id, 'unconscious', NULL, updatedAt
    FROM encounter_combatants WHERE type = 'player' AND currentHp = 0 AND survivalStatus = 'unconscious';
`)

database.exec(`
  CREATE TABLE IF NOT EXISTS encounter_damage_rolls (
    id TEXT PRIMARY KEY,
    encounterId TEXT NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
    attackId TEXT NOT NULL REFERENCES encounter_attacks(id) ON DELETE CASCADE,
    attackerId TEXT NOT NULL,
    attackerName TEXT NOT NULL,
    targetId TEXT NOT NULL,
    targetName TEXT NOT NULL,
    weaponId TEXT,
    weaponName TEXT,
    source TEXT NOT NULL CHECK (source IN ('weapon', 'enemy')),
    formula TEXT NOT NULL,
    damageType TEXT NOT NULL CHECK (damageType IN ('acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder')),
    diceCount INTEGER NOT NULL CHECK (diceCount BETWEEN 1 AND 40),
    dieSize INTEGER NOT NULL CHECK (dieSize IN (4, 6, 8, 10, 12, 20)),
    diceResults TEXT NOT NULL,
    formulaModifier INTEGER NOT NULL,
    ability TEXT CHECK (ability IS NULL OR ability IN ('str', 'dex')),
    abilityModifier INTEGER NOT NULL,
    situationalModifier INTEGER NOT NULL,
    isCritical INTEGER NOT NULL CHECK (isCritical IN (0, 1)),
    total INTEGER NOT NULL CHECK (total >= 0),
    applied INTEGER NOT NULL DEFAULT 0 CHECK (applied IN (0, 1)),
    hpBefore INTEGER,
    hpAfter INTEGER,
    createdAt TEXT NOT NULL,
    appliedAt TEXT,
    CHECK ((applied = 0 AND hpBefore IS NULL AND hpAfter IS NULL AND appliedAt IS NULL)
      OR (applied = 1 AND hpBefore IS NOT NULL AND hpAfter IS NOT NULL AND appliedAt IS NOT NULL))
  );
  CREATE INDEX IF NOT EXISTS idx_encounter_damage_recent
    ON encounter_damage_rolls(encounterId, createdAt DESC);
  CREATE INDEX IF NOT EXISTS idx_encounter_damage_attack
    ON encounter_damage_rolls(attackId, createdAt DESC);
`)

// Spellcasting foundation: additive character-owned tables. No existing records are rebuilt.
database.exec(`
  CREATE TABLE IF NOT EXISTS character_spellcasting (
    characterId TEXT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    ability TEXT CHECK (ability IS NULL OR ability IN ('int', 'wis', 'cha')),
    notes TEXT NOT NULL DEFAULT '',
    updatedAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS character_spells (
    id TEXT PRIMARY KEY,
    ownerCharacterId TEXT REFERENCES characters(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
    level INTEGER NOT NULL CHECK (level BETWEEN 0 AND 9),
    school TEXT NOT NULL CHECK (length(trim(school)) BETWEEN 1 AND 40),
    castingTime TEXT NOT NULL CHECK (length(trim(castingTime)) BETWEEN 1 AND 80),
    castingTimeCategory TEXT NOT NULL DEFAULT 'special' CHECK (castingTimeCategory IN ('action','bonus_action','reaction','special')),
    rangeText TEXT NOT NULL CHECK (length(trim(rangeText)) BETWEEN 1 AND 80),
    components TEXT NOT NULL,
    materialDetails TEXT NOT NULL DEFAULT '',
    duration TEXT NOT NULL CHECK (length(trim(duration)) BETWEEN 1 AND 80),
    concentration INTEGER NOT NULL CHECK (concentration IN (0, 1)),
    ritual INTEGER NOT NULL CHECK (ritual IN (0, 1)),
    description TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 3000),
    sourceVersion TEXT NOT NULL,
    resolutionType TEXT NOT NULL DEFAULT 'none' CHECK (resolutionType IN ('none', 'attack', 'save')),
    savingThrowAbility TEXT CHECK (savingThrowAbility IS NULL OR savingThrowAbility IN ('str', 'dex', 'con', 'int', 'wis', 'cha')),
    attackType TEXT CHECK (attackType IS NULL OR attackType IN ('melee', 'ranged')),
    targetGuidance TEXT NOT NULL DEFAULT '',
    resolutionNotes TEXT NOT NULL DEFAULT '',
    effectType TEXT NOT NULL DEFAULT 'none' CHECK (effectType IN ('none', 'damage', 'healing')),
    effectFormula TEXT NOT NULL DEFAULT '',
    damageType TEXT CHECK (damageType IS NULL OR damageType IN ('acid','bludgeoning','cold','fire','force','lightning','necrotic','piercing','poison','psychic','radiant','slashing','thunder')),
    effectModifier INTEGER NOT NULL DEFAULT 0 CHECK (effectModifier BETWEEN -100 AND 100),
    includeSpellcastingModifier INTEGER NOT NULL DEFAULT 0 CHECK (includeSpellcastingModifier IN (0, 1)),
    saveSuccessEffect TEXT CHECK (saveSuccessEffect IS NULL OR saveSuccessEffect IN ('full','half','none')),
    upcastMode TEXT NOT NULL DEFAULT 'none' CHECK (upcastMode IN ('none','dice','modifier')),
    upcastDiceCount INTEGER NOT NULL DEFAULT 0 CHECK (upcastDiceCount BETWEEN 0 AND 20),
    upcastDieSize INTEGER CHECK (upcastDieSize IS NULL OR upcastDieSize IN (4,6,8,10,12,20)),
    upcastModifier INTEGER NOT NULL DEFAULT 0 CHECK (upcastModifier BETWEEN -100 AND 100),
    effectNotes TEXT NOT NULL DEFAULT '',
    createdAt TEXT NOT NULL,
    CHECK ((ownerCharacterId IS NULL AND sourceVersion = 'RealmForge Original Starter Set (CC0-1.0)') OR ownerCharacterId IS NOT NULL)
  );
  CREATE INDEX IF NOT EXISTS idx_character_spells_owner ON character_spells(ownerCharacterId, name COLLATE NOCASE);
  CREATE TABLE IF NOT EXISTS character_spellbook (
    characterId TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    spellId TEXT NOT NULL REFERENCES character_spells(id) ON DELETE CASCADE,
    prepared INTEGER NOT NULL DEFAULT 0 CHECK (prepared IN (0, 1)),
    alwaysPrepared INTEGER NOT NULL DEFAULT 0 CHECK (alwaysPrepared IN (0, 1)),
    addedAt TEXT NOT NULL,
    PRIMARY KEY (characterId, spellId)
  );
  CREATE INDEX IF NOT EXISTS idx_character_spellbook_character ON character_spellbook(characterId, prepared, spellId);
  CREATE TABLE IF NOT EXISTS character_spell_slots (
    characterId TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 9),
    maximum INTEGER NOT NULL CHECK (maximum BETWEEN 0 AND 99),
    remaining INTEGER NOT NULL CHECK (remaining BETWEEN 0 AND maximum),
    updatedAt TEXT NOT NULL,
    PRIMARY KEY (characterId, level)
  );
`)

const spellColumns = database.prepare('PRAGMA table_info(character_spells)').all() as unknown as { name: string }[]
const spellColumnNames = new Set(spellColumns.map((column) => column.name))
const spellResolutionMigrations: Record<string, string> = {
  castingTimeCategory: "TEXT NOT NULL DEFAULT 'special' CHECK (castingTimeCategory IN ('action','bonus_action','reaction','special'))",
  resolutionType: "TEXT NOT NULL DEFAULT 'none' CHECK (resolutionType IN ('none', 'attack', 'save'))",
  savingThrowAbility: "TEXT CHECK (savingThrowAbility IS NULL OR savingThrowAbility IN ('str', 'dex', 'con', 'int', 'wis', 'cha'))",
  attackType: "TEXT CHECK (attackType IS NULL OR attackType IN ('melee', 'ranged'))",
  targetGuidance: "TEXT NOT NULL DEFAULT ''",
  resolutionNotes: "TEXT NOT NULL DEFAULT ''",
  effectType: "TEXT NOT NULL DEFAULT 'none' CHECK (effectType IN ('none', 'damage', 'healing'))",
  effectFormula: "TEXT NOT NULL DEFAULT ''",
  damageType: "TEXT CHECK (damageType IS NULL OR damageType IN ('acid','bludgeoning','cold','fire','force','lightning','necrotic','piercing','poison','psychic','radiant','slashing','thunder'))",
  effectModifier: 'INTEGER NOT NULL DEFAULT 0 CHECK (effectModifier BETWEEN -100 AND 100)',
  includeSpellcastingModifier: 'INTEGER NOT NULL DEFAULT 0 CHECK (includeSpellcastingModifier IN (0, 1))',
  saveSuccessEffect: "TEXT CHECK (saveSuccessEffect IS NULL OR saveSuccessEffect IN ('full','half','none'))",
  upcastMode: "TEXT NOT NULL DEFAULT 'none' CHECK (upcastMode IN ('none','dice','modifier'))",
  upcastDiceCount: 'INTEGER NOT NULL DEFAULT 0 CHECK (upcastDiceCount BETWEEN 0 AND 20)',
  upcastDieSize: 'INTEGER CHECK (upcastDieSize IS NULL OR upcastDieSize IN (4,6,8,10,12,20))',
  upcastModifier: 'INTEGER NOT NULL DEFAULT 0 CHECK (upcastModifier BETWEEN -100 AND 100)',
  effectNotes: "TEXT NOT NULL DEFAULT ''",
}

for (const [column, definition] of Object.entries(spellResolutionMigrations)) {
  if (!spellColumnNames.has(column)) database.exec(`ALTER TABLE character_spells ADD COLUMN ${column} ${definition}`)
}

// One immutable row per idempotent spell resolution request. Full results and
// modifiers are stored as snapshots, so later character or condition edits do not alter history.
database.exec(`
  CREATE TABLE IF NOT EXISTS encounter_spell_resolutions (
    id TEXT PRIMARY KEY,
    requestId TEXT NOT NULL UNIQUE,
    requestHash TEXT NOT NULL,
    campaignId TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    encounterId TEXT NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
    casterCombatantId TEXT NOT NULL,
    casterName TEXT NOT NULL,
    casterCharacterId TEXT NOT NULL,
    spellId TEXT NOT NULL,
    spellName TEXT NOT NULL,
    resolutionType TEXT NOT NULL CHECK (resolutionType IN ('attack', 'save')),
    results TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_spell_resolutions_encounter ON encounter_spell_resolutions(encounterId, createdAt DESC);
`)

// Spell effect rolls are immutable snapshots. Application is a separate event
// and each roll can be applied at most once, even with a different retry key.
database.exec(`
  CREATE TABLE IF NOT EXISTS encounter_spell_effect_rolls (
    id TEXT PRIMARY KEY,
    requestId TEXT NOT NULL,
    requestHash TEXT NOT NULL,
    campaignId TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    encounterId TEXT NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
    casterCombatantId TEXT NOT NULL,
    casterName TEXT NOT NULL,
    casterCharacterId TEXT NOT NULL,
    spellId TEXT NOT NULL,
    spellName TEXT NOT NULL,
    effectType TEXT NOT NULL CHECK (effectType IN ('damage','healing')),
    resolutionId TEXT,
    resolutionType TEXT NOT NULL CHECK (resolutionType IN ('none','attack','save')),
    targetId TEXT NOT NULL,
    targetName TEXT NOT NULL,
    castLevel INTEGER NOT NULL CHECK (castLevel BETWEEN 0 AND 9),
    baseLevel INTEGER NOT NULL CHECK (baseLevel BETWEEN 0 AND 9),
    baseFormula TEXT NOT NULL,
    finalFormula TEXT NOT NULL,
    diceCount INTEGER NOT NULL CHECK (diceCount BETWEEN 0 AND 40),
    dieSize INTEGER CHECK (dieSize IS NULL OR dieSize IN (4,6,8,10,12,20)),
    diceResults TEXT NOT NULL,
    formulaModifier INTEGER NOT NULL,
    effectModifier INTEGER NOT NULL,
    ability TEXT,
    abilityModifier INTEGER NOT NULL,
    damageType TEXT,
    saveOutcome TEXT,
    saveSuccessEffect TEXT,
    attackOutcome TEXT,
    critical INTEGER NOT NULL CHECK (critical IN (0,1)),
    fullAmount INTEGER NOT NULL CHECK (fullAmount >= 0),
    appliedAmount INTEGER NOT NULL CHECK (appliedAmount >= 0),
    status TEXT NOT NULL CHECK (status IN ('rolled','no_effect','adjudication_required')),
    scaling TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    createdAt TEXT NOT NULL,
    UNIQUE (requestId, targetId)
  );
  CREATE INDEX IF NOT EXISTS idx_spell_effect_rolls_encounter ON encounter_spell_effect_rolls(encounterId, createdAt DESC);
  CREATE INDEX IF NOT EXISTS idx_spell_effect_rolls_resolution ON encounter_spell_effect_rolls(resolutionId);

  CREATE TABLE IF NOT EXISTS encounter_spell_effect_applications (
    id TEXT PRIMARY KEY,
    requestId TEXT NOT NULL UNIQUE,
    requestHash TEXT NOT NULL,
    rollId TEXT NOT NULL UNIQUE REFERENCES encounter_spell_effect_rolls(id) ON DELETE CASCADE,
    campaignId TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    encounterId TEXT NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
    targetId TEXT NOT NULL,
    targetName TEXT NOT NULL,
    effectType TEXT NOT NULL CHECK (effectType IN ('damage','healing')),
    amount INTEGER NOT NULL CHECK (amount >= 0),
    hpBefore INTEGER NOT NULL,
    hpAfter INTEGER NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    createdAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_spell_effect_applications_encounter ON encounter_spell_effect_applications(encounterId, createdAt DESC);
`)

// Casting events atomically snapshot the spell and record slot/action expenditure.
// Legacy resolution/effect rows remain valid with a NULL castingEventId.
database.exec(`
  CREATE TABLE IF NOT EXISTS encounter_spell_castings (
    id TEXT PRIMARY KEY, requestId TEXT NOT NULL UNIQUE, requestHash TEXT NOT NULL,
    campaignId TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    encounterId TEXT NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
    casterCombatantId TEXT NOT NULL, casterName TEXT NOT NULL, casterCharacterId TEXT NOT NULL,
    spellId TEXT NOT NULL, spellName TEXT NOT NULL, spellSnapshot TEXT NOT NULL,
    baseLevel INTEGER NOT NULL CHECK (baseLevel BETWEEN 0 AND 9), castLevel INTEGER NOT NULL CHECK (castLevel BETWEEN 0 AND 9),
    castingTimeCategory TEXT NOT NULL CHECK (castingTimeCategory IN ('action','bonus_action','reaction','special')),
    slotLevel INTEGER, actionResource TEXT CHECK (actionResource IS NULL OR actionResource IN ('action','bonusAction','reaction')),
    turnCount INTEGER, dmOverride INTEGER NOT NULL CHECK (dmOverride IN (0,1)), overrideReason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('cast','awaiting_adjudication','resolved')), createdAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_spell_castings_encounter ON encounter_spell_castings(encounterId, createdAt DESC);
  CREATE TABLE IF NOT EXISTS encounter_spell_slot_turns (
    encounterId TEXT NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
    turnOwnerCombatantId TEXT NOT NULL REFERENCES encounter_combatants(id) ON DELETE CASCADE,
    turnCount INTEGER NOT NULL CHECK (turnCount > 0), castingEventId TEXT NOT NULL UNIQUE REFERENCES encounter_spell_castings(id),
    PRIMARY KEY(encounterId,turnOwnerCombatantId,turnCount)
  );
  CREATE TRIGGER IF NOT EXISTS trg_spell_casting_no_update BEFORE UPDATE ON encounter_spell_castings BEGIN SELECT RAISE(ABORT,'Casting history is immutable.'); END;
  CREATE TRIGGER IF NOT EXISTS trg_spell_casting_no_delete BEFORE DELETE ON encounter_spell_castings BEGIN SELECT RAISE(ABORT,'Casting history cannot be deleted.'); END;
`)
for (const table of ['encounter_spell_resolutions', 'encounter_spell_effect_rolls']) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[]
  if (!columns.some((column) => column.name === 'castingEventId')) database.exec(`ALTER TABLE ${table} ADD COLUMN castingEventId TEXT REFERENCES encounter_spell_castings(id)`)
}

// Adventure foundation: additive tables keep all existing campaign and combat data intact.
database.exec(`
  CREATE TABLE IF NOT EXISTS adventures (
    id TEXT PRIMARY KEY,
    campaignId TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','completed','archived')),
    startingLocation TEXT NOT NULL DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_adventures_campaign_updated ON adventures(campaignId, updatedAt DESC);
  CREATE TABLE IF NOT EXISTS adventure_locations (
    id TEXT PRIMARY KEY,
    adventureId TEXT NOT NULL REFERENCES adventures(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
    description TEXT NOT NULL DEFAULT '',
    locationType TEXT NOT NULL DEFAULT '',
    dmNotes TEXT NOT NULL DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_adventure_locations_adventure ON adventure_locations(adventureId, name COLLATE NOCASE);
  CREATE TABLE IF NOT EXISTS adventure_location_connections (
    adventureId TEXT NOT NULL REFERENCES adventures(id) ON DELETE CASCADE,
    fromLocationId TEXT NOT NULL REFERENCES adventure_locations(id) ON DELETE CASCADE,
    toLocationId TEXT NOT NULL REFERENCES adventure_locations(id) ON DELETE CASCADE,
    createdAt TEXT NOT NULL,
    PRIMARY KEY (fromLocationId, toLocationId),
    CHECK (fromLocationId <> toLocationId)
  );
  CREATE TABLE IF NOT EXISTS adventure_npcs (
    id TEXT PRIMARY KEY,
    adventureId TEXT NOT NULL REFERENCES adventures(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
    description TEXT NOT NULL DEFAULT '',
    personality TEXT NOT NULL DEFAULT '',
    disposition TEXT NOT NULL DEFAULT '',
    currentLocationId TEXT REFERENCES adventure_locations(id) ON DELETE SET NULL,
    dmNotes TEXT NOT NULL DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_adventure_npcs_adventure ON adventure_npcs(adventureId, name COLLATE NOCASE);
  CREATE TABLE IF NOT EXISTS adventure_quests (
    id TEXT PRIMARY KEY,
    adventureId TEXT NOT NULL REFERENCES adventures(id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','active','completed','failed')),
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_adventure_quests_adventure ON adventure_quests(adventureId, updatedAt DESC);
  CREATE TABLE IF NOT EXISTS adventure_objectives (
    id TEXT PRIMARY KEY,
    questId TEXT NOT NULL REFERENCES adventure_quests(id) ON DELETE CASCADE,
    description TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 500),
    completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0,1)),
    sortOrder INTEGER NOT NULL DEFAULT 0 CHECK (sortOrder >= 0),
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_adventure_objectives_quest ON adventure_objectives(questId, sortOrder, createdAt);
  CREATE TABLE IF NOT EXISTS adventure_story_flags (
    adventureId TEXT NOT NULL REFERENCES adventures(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
    valueJson TEXT NOT NULL CHECK (length(valueJson) <= 2048),
    updatedAt TEXT NOT NULL,
    PRIMARY KEY (adventureId, name)
  );
  CREATE TABLE IF NOT EXISTS adventure_story_notes (
    id TEXT PRIMARY KEY,
    adventureId TEXT NOT NULL REFERENCES adventures(id) ON DELETE CASCADE,
    content TEXT NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 4000),
    createdAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_adventure_story_notes_adventure ON adventure_story_notes(adventureId, createdAt DESC);
`)

// Session progression is additive. Session commands and journal rows are kept
// separately so retries can be idempotent and history stays append-only.
database.exec(`
  CREATE TABLE IF NOT EXISTS adventure_sessions (
    id TEXT PRIMARY KEY,
    campaignId TEXT NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
    adventureId TEXT NOT NULL REFERENCES adventures(id) ON DELETE RESTRICT,
    characterId TEXT NOT NULL REFERENCES characters(id) ON DELETE RESTRICT,
    status TEXT NOT NULL CHECK (status IN ('active','paused','completed')),
    currentSceneId TEXT REFERENCES adventure_scenes(id) ON DELETE SET NULL,
    currentLocationId TEXT REFERENCES adventure_locations(id) ON DELETE SET NULL,
    startedAt TEXT NOT NULL,
    lastActivityAt TEXT NOT NULL,
    completedAt TEXT,
    startRequestId TEXT NOT NULL UNIQUE,
    startRequestHash TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_adventure_sessions_adventure ON adventure_sessions(adventureId, startedAt DESC);
  CREATE INDEX IF NOT EXISTS idx_adventure_sessions_campaign ON adventure_sessions(campaignId, startedAt DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_adventure_sessions_one_in_progress
    ON adventure_sessions(adventureId, characterId) WHERE status IN ('active','paused');
  CREATE TABLE IF NOT EXISTS adventure_scenes (
    id TEXT PRIMARY KEY,
    sessionId TEXT NOT NULL REFERENCES adventure_sessions(id) ON DELETE RESTRICT,
    locationId TEXT REFERENCES adventure_locations(id) ON DELETE SET NULL,
    title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('current','completed')),
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    createdAt TEXT NOT NULL,
    completedAt TEXT,
    UNIQUE (sessionId, sequence)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_adventure_scenes_one_current
    ON adventure_scenes(sessionId) WHERE status='current';
  CREATE INDEX IF NOT EXISTS idx_adventure_scenes_history ON adventure_scenes(sessionId, sequence DESC);
  CREATE TABLE IF NOT EXISTS adventure_session_decisions (
    id TEXT PRIMARY KEY,
    sessionId TEXT NOT NULL REFERENCES adventure_sessions(id) ON DELETE RESTRICT,
    sceneId TEXT NOT NULL REFERENCES adventure_scenes(id) ON DELETE RESTRICT,
    characterId TEXT NOT NULL REFERENCES characters(id) ON DELETE RESTRICT,
    decisionText TEXT NOT NULL CHECK (length(trim(decisionText)) BETWEEN 1 AND 2000),
    category TEXT,
    createdAt TEXT NOT NULL,
    requestId TEXT NOT NULL UNIQUE
  );
  CREATE INDEX IF NOT EXISTS idx_adventure_decisions_session ON adventure_session_decisions(sessionId, createdAt);
  CREATE INDEX IF NOT EXISTS idx_adventure_decisions_scene ON adventure_session_decisions(sceneId, createdAt);
  CREATE TABLE IF NOT EXISTS adventure_session_journal (
    id TEXT PRIMARY KEY,
    sessionId TEXT NOT NULL REFERENCES adventure_sessions(id) ON DELETE RESTRICT,
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    eventType TEXT NOT NULL CHECK (eventType IN ('session_started','session_paused','session_resumed','session_completed','scene_entered','scene_completed','player_decision_recorded','location_changed')),
    sceneId TEXT REFERENCES adventure_scenes(id) ON DELETE RESTRICT,
    createdAt TEXT NOT NULL,
    details TEXT NOT NULL CHECK (length(details) <= 4096),
    UNIQUE (sessionId, sequence)
  );
  CREATE INDEX IF NOT EXISTS idx_adventure_journal_session ON adventure_session_journal(sessionId, sequence);
  CREATE TABLE IF NOT EXISTS adventure_session_idempotency (
    requestId TEXT PRIMARY KEY,
    sessionId TEXT NOT NULL REFERENCES adventure_sessions(id) ON DELETE RESTRICT,
    requestHash TEXT NOT NULL,
    responseJson TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
  CREATE TRIGGER IF NOT EXISTS trg_adventure_journal_no_update BEFORE UPDATE ON adventure_session_journal BEGIN SELECT RAISE(ABORT,'Adventure journal entries are immutable.'); END;
  CREATE TRIGGER IF NOT EXISTS trg_adventure_journal_no_delete BEFORE DELETE ON adventure_session_journal BEGIN SELECT RAISE(ABORT,'Adventure journal entries cannot be deleted.'); END;
  CREATE TRIGGER IF NOT EXISTS trg_adventure_decisions_no_update BEFORE UPDATE ON adventure_session_decisions BEGIN SELECT RAISE(ABORT,'Player decisions are immutable.'); END;
  CREATE TRIGGER IF NOT EXISTS trg_adventure_decisions_no_delete BEFORE DELETE ON adventure_session_decisions BEGIN SELECT RAISE(ABORT,'Player decisions cannot be deleted.'); END;
`)

export = database
