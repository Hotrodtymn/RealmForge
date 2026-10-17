import { useEffect, useState, type FormEvent } from 'react'
import { compatibleEquipmentSlots, equipmentSlotLabels, type EquipmentSlot } from './equipment'
import { ARMOR_DEFINITIONS, WEAPON_DEFINITIONS } from './combatStats'
import './Inventory.css'

const API_URL = 'http://localhost:3001/api'

interface Campaign {
  id: string
  name: string
}

interface Player {
  playerId: string
  displayName: string
}

interface Character {
  id: string
  name: string
  status: string
}

const categories = [
  ['weapon', 'Weapon'],
  ['armor', 'Armor'],
  ['shield', 'Shield'],
  ['adventuring_gear', 'Adventuring gear'],
  ['consumable', 'Consumable'],
  ['treasure', 'Treasure'],
  ['other', 'Other'],
] as const

type InventoryCategory = (typeof categories)[number][0]

interface InventoryItem {
  id: string
  characterId: string
  name: string
  category: InventoryCategory
  quantity: number
  weight: number | null
  notes: string
  equipped: boolean
  equipmentSlot: EquipmentSlot | null
  armorDefinitionId: string | null
  weaponDefinitionId: string | null
  weaponAbility: 'str' | 'dex' | null
  manualAttackBonus: number | null
  createdAt: string
  updatedAt: string
}

interface ItemForm {
  name: string
  category: InventoryCategory
  quantity: string
  weight: string
  notes: string
  armorDefinitionId: string
  weaponDefinitionId: string
  weaponAbility: '' | 'str' | 'dex'
  manualAttackBonus: string
}

interface EquipmentConflict {
  itemId: string
  slot: EquipmentSlot
  conflict: InventoryItem
}

interface Props {
  campaigns: Campaign[]
}

const blankForm: ItemForm = { name: '', category: 'other', quantity: '1', weight: '', notes: '', armorDefinitionId: '', weaponDefinitionId: '', weaponAbility: '', manualAttackBonus: '' }
const categoryLabel = (category: InventoryCategory) => categories.find(([key]) => key === category)?.[1] ?? 'Other'

async function payload<T>(response: Response): Promise<T & { error?: string; fields?: Record<string, string> }> {
  return await response.json() as T & { error?: string; fields?: Record<string, string> }
}

export default function Inventory({ campaigns }: Props) {
  const [campaignId, setCampaignId] = useState('')
  const [players, setPlayers] = useState<Player[]>([])
  const [playerId, setPlayerId] = useState('')
  const [characters, setCharacters] = useState<Character[]>([])
  const [characterId, setCharacterId] = useState('')
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loadingPlayers, setLoadingPlayers] = useState(false)
  const [loadingCharacters, setLoadingCharacters] = useState(false)
  const [loadingItems, setLoadingItems] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ItemForm>(blankForm)
  const [saving, setSaving] = useState(false)
  const [slotSelections, setSlotSelections] = useState<Record<string, EquipmentSlot>>({})
  const [equipmentConflict, setEquipmentConflict] = useState<EquipmentConflict | null>(null)

  useEffect(() => {
    if (!campaigns.length) {
      setCampaignId('')
      setPlayers([])
      setPlayerId('')
      setCharacters([])
      setCharacterId('')
      setItems([])
      return
    }
    if (!campaigns.some((campaign) => campaign.id === campaignId)) setCampaignId(campaigns[0]!.id)
  }, [campaigns, campaignId])

  useEffect(() => {
    if (!campaignId) return
    let cancelled = false
    setLoadingPlayers(true)
    setError('')
    setPlayers([])
    setPlayerId('')
    setCharacters([])
    setCharacterId('')
    setItems([])
    async function loadPlayers() {
      try {
        const response = await fetch(`${API_URL}/campaigns/${campaignId}/players`)
        const result = await payload<{ players?: Player[] }>(response)
        if (!response.ok) throw new Error(result.error || 'Could not load campaign players.')
        if (!cancelled) {
          const loaded = result.players ?? []
          setPlayers(loaded)
          setPlayerId(loaded[0]?.playerId ?? '')
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load campaign players.')
      } finally {
        if (!cancelled) setLoadingPlayers(false)
      }
    }
    void loadPlayers()
    return () => { cancelled = true }
  }, [campaignId])

  useEffect(() => {
    if (!campaignId || !playerId || !players.some((player) => player.playerId === playerId)) return
    let cancelled = false
    setLoadingCharacters(true)
    setCharacters([])
    setCharacterId('')
    setItems([])
    async function loadCharacters() {
      try {
        const response = await fetch(`${API_URL}/campaigns/${campaignId}/players/${playerId}/characters`)
        const result = await payload<{ characters?: Character[] }>(response)
        if (!response.ok) throw new Error(result.error || 'Could not load this player’s characters.')
        if (!cancelled) {
          const loaded = result.characters ?? []
          setCharacters(loaded)
          setCharacterId(loaded[0]?.id ?? '')
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load this player’s characters.')
      } finally {
        if (!cancelled) setLoadingCharacters(false)
      }
    }
    void loadCharacters()
    return () => { cancelled = true }
  }, [campaignId, playerId, players])

  useEffect(() => {
    if (!campaignId || !playerId || !characters.some((character) => character.id === characterId)) return
    let cancelled = false
    setLoadingItems(true)
    setItems([])
    setError('')
    async function loadItems() {
      try {
        const response = await fetch(`${API_URL}/campaigns/${campaignId}/players/${playerId}/characters/${characterId}/inventory`)
        const result = await payload<{ items?: InventoryItem[] }>(response)
        if (!response.ok) throw new Error(result.error || 'Could not load this character’s inventory.')
        if (!cancelled) setItems(result.items ?? [])
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load this character’s inventory.')
      } finally {
        if (!cancelled) setLoadingItems(false)
      }
    }
    void loadItems()
    return () => { cancelled = true }
  }, [campaignId, playerId, characterId, characters])

  const selectedCampaign = campaigns.find((campaign) => campaign.id === campaignId)
  const selectedPlayer = players.find((player) => player.playerId === playerId)
  const selectedCharacter = characters.find((character) => character.id === characterId)
  const itemCount = items.reduce((total, item) => total + item.quantity, 0)
  const unknownWeightQuantity = items.filter((item) => item.weight === null).reduce((total, item) => total + item.quantity, 0)
  const knownWeight = items.reduce((total, item) => total + (item.weight === null ? 0 : item.weight * item.quantity), 0)
  const weightText = unknownWeightQuantity
    ? `At least ${knownWeight.toLocaleString(undefined, { maximumFractionDigits: 2 })} lb · incomplete (${unknownWeightQuantity} item${unknownWeightQuantity === 1 ? '' : 's'} without weight)`
    : `${knownWeight.toLocaleString(undefined, { maximumFractionDigits: 2 })} lb`

  function openAddForm() {
    setEditingId(null)
    setForm(blankForm)
    setError('')
    setNotice('')
    setFormOpen(true)
  }

  function openEditForm(item: InventoryItem) {
    setEditingId(item.id)
    setForm({
      name: item.name,
      category: item.category,
      quantity: String(item.quantity),
      weight: item.weight === null ? '' : String(item.weight),
      notes: item.notes,
      armorDefinitionId: item.armorDefinitionId ?? '', weaponDefinitionId: item.weaponDefinitionId ?? '',
      weaponAbility: item.weaponAbility ?? '', manualAttackBonus: item.manualAttackBonus === null ? '' : String(item.manualAttackBonus),
    })
    setError('')
    setNotice('')
    setFormOpen(true)
  }

  async function refreshItems(): Promise<void> {
    if (!campaignId || !playerId || !characterId) return
    const response = await fetch(`${API_URL}/campaigns/${campaignId}/players/${playerId}/characters/${characterId}/inventory`)
    const result = await payload<{ items?: InventoryItem[] }>(response)
    if (!response.ok) throw new Error(result.error || 'Could not refresh this inventory.')
    setItems(result.items ?? [])
  }

  async function submitItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!campaignId || !playerId || !characterId) return
    setSaving(true)
    setError('')
    setNotice('')
    const body = {
      name: form.name,
      category: form.category,
      quantity: Number(form.quantity),
      weight: form.weight.trim() === '' ? null : Number(form.weight),
      notes: form.notes,
      equipped: items.find((item) => item.id === editingId)?.equipped ?? false,
      armorDefinitionId: form.armorDefinitionId || null,
      weaponDefinitionId: form.weaponDefinitionId || null,
      weaponAbility: form.weaponAbility || null,
      manualAttackBonus: form.manualAttackBonus.trim() === '' ? null : Number(form.manualAttackBonus),
    }
    const route = `${API_URL}/campaigns/${campaignId}/players/${playerId}/characters/${characterId}/inventory${editingId ? `/${editingId}` : ''}`
    try {
      const response = await fetch(route, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const result = await payload<{ item?: InventoryItem }>(response)
      if (!response.ok) {
        const details = result.fields ? Object.values(result.fields).join(' ') : ''
        throw new Error([result.error, details].filter(Boolean).join(': ') || 'Could not save this item.')
      }
      setFormOpen(false)
      setNotice(editingId ? 'Inventory item updated.' : 'Item added to inventory.')
      await refreshItems()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this item.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteItem(item: InventoryItem) {
    if (!window.confirm(`Delete ${item.name} from this character’s inventory?`)) return
    setError('')
    setNotice('')
    try {
      const response = await fetch(`${API_URL}/campaigns/${campaignId}/players/${playerId}/characters/${characterId}/inventory/${item.id}`, { method: 'DELETE' })
      const result = await payload<{ deleted?: boolean }>(response)
      if (!response.ok) throw new Error(result.error || 'Could not delete this item.')
      setNotice(`${item.name} removed from inventory.`)
      await refreshItems()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete this item.')
    }
  }

  async function assignEquipment(itemId: string, slot: EquipmentSlot, replace = false) {
    setError('')
    setNotice('')
    try {
      const response = await fetch(`${API_URL}/campaigns/${campaignId}/players/${playerId}/characters/${characterId}/inventory/${itemId}/equip`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slot, replace }),
      })
      const result = await payload<{ item?: InventoryItem; conflict?: InventoryItem }>(response)
      if (response.status === 409 && result.conflict) {
        setEquipmentConflict({ itemId, slot, conflict: result.conflict })
        return
      }
      if (!response.ok) throw new Error(result.error || 'Could not equip this item.')
      setEquipmentConflict(null)
      setNotice(`${items.find((item) => item.id === itemId)?.name ?? 'Item'} equipped in ${equipmentSlotLabels[slot]}.`)
      await refreshItems()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not equip this item.')
    }
  }

  async function removeEquipment(item: InventoryItem) {
    setError('')
    setNotice('')
    try {
      const response = await fetch(`${API_URL}/campaigns/${campaignId}/players/${playerId}/characters/${characterId}/inventory/${item.id}/unequip`, { method: 'POST' })
      const result = await payload<{ item?: InventoryItem }>(response)
      if (!response.ok) throw new Error(result.error || 'Could not unequip this item.')
      setEquipmentConflict(null)
      setNotice(`${item.name} moved back to the pack.`)
      await refreshItems()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not unequip this item.')
    }
  }

  return (
    <section className="inventory-view" aria-labelledby="inventory-heading">
      <header className="inventory-page-heading">
        <div className="eyebrow"><span className="eyebrow-line" />PACK YOUR ADVENTURE</div>
        <h1 id="inventory-heading">Character <em>Inventory</em></h1>
        <p>Keep track of what each adventurer carries.</p>
      </header>

      {campaigns.length === 0 ? <div className="inventory-empty"><span aria-hidden="true">⚒</span><h2>No campaigns available</h2><p>Create a campaign, add a player, and make a character before managing inventory.</p></div> : (
        <>
          <div className="inventory-selectors">
            <label className="inventory-field"><span>Campaign</span><select value={campaignId} onChange={(event) => setCampaignId(event.target.value)}>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label>
            <label className="inventory-field"><span>Player</span><select value={playerId} onChange={(event) => setPlayerId(event.target.value)} disabled={loadingPlayers || players.length === 0}><option value="">{loadingPlayers ? 'Loading players…' : players.length ? 'Select a player' : 'No players in campaign'}</option>{players.map((player) => <option key={player.playerId} value={player.playerId}>{player.displayName}</option>)}</select></label>
            <label className="inventory-field"><span>Character</span><select value={characterId} onChange={(event) => setCharacterId(event.target.value)} disabled={loadingCharacters || characters.length === 0}><option value="">{loadingCharacters ? 'Loading characters…' : characters.length ? 'Select a character' : 'No characters for this player'}</option>{characters.map((character) => <option key={character.id} value={character.id}>{character.name} · {character.status}</option>)}</select></label>
          </div>

          {error && <div className="inventory-feedback error" role="alert">{error}<button type="button" className="inventory-text-button" onClick={() => void refreshItems()}>Retry</button></div>}
          {notice && <div className="inventory-feedback success" role="status">✦ {notice}</div>}

          <section className="inventory-panel" aria-label="Selected character inventory">
            <div className="inventory-panel-heading">
              <div><div className="eyebrow small"><span className="eyebrow-line" />THE PACK</div><h2>{selectedCharacter?.name ?? 'Select a character'}</h2><p>{selectedCampaign?.name ?? ''}{selectedPlayer ? ` · ${selectedPlayer.displayName}` : ''}</p></div>
              <button className="inventory-add-button" type="button" onClick={openAddForm} disabled={!selectedCharacter}>＋ Add item</button>
            </div>

            {selectedCharacter && <div className="inventory-summary"><div><span>ITEM COUNT</span><strong>{itemCount}</strong></div><div><span>CARRIED WEIGHT</span><strong>{weightText}</strong></div></div>}

            {formOpen && selectedCharacter && <form className="inventory-form" onSubmit={(event) => void submitItem(event)}>
              <div className="inventory-form-heading"><div><div className="eyebrow small"><span className="eyebrow-line" />{editingId ? 'EDIT ITEM' : 'NEW ITEM'}</div><h3>{editingId ? 'Update this entry' : 'Add to the pack'}</h3></div><button className="inventory-close-form" type="button" aria-label="Close item form" disabled={saving} onClick={() => setFormOpen(false)}>×</button></div>
              <div className="inventory-form-grid">
                <label className="inventory-field"><span>Name <i>required</i></span><input autoFocus maxLength={120} required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Item name" /></label>
                <label className="inventory-field"><span>Category</span><select value={form.category} onChange={(event) => { const category = event.target.value as InventoryCategory; setForm({ ...form, category, armorDefinitionId: category === 'armor' ? form.armorDefinitionId : '', weaponDefinitionId: category === 'weapon' ? form.weaponDefinitionId : '', weaponAbility: category === 'weapon' ? form.weaponAbility : '', manualAttackBonus: category === 'weapon' ? form.manualAttackBonus : '' }) }}>{categories.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                <label className="inventory-field"><span>Quantity</span><input type="number" min="1" step="1" required value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></label>
                <label className="inventory-field"><span>Weight per item <small>lb · optional</small></span><input type="number" min="0" step="any" value={form.weight} onChange={(event) => setForm({ ...form, weight: event.target.value })} placeholder="Unknown" /></label>
                <label className="inventory-field inventory-notes-field"><span>Notes <small>optional</small></span><textarea rows={2} maxLength={2000} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Details about this item" /></label>
                {form.category === 'armor' && <label className="inventory-field"><span>Armor type <small>structured rules</small></span><select value={form.armorDefinitionId} onChange={(event) => setForm({ ...form, armorDefinitionId: event.target.value })}><option value="">Not configured</option>{ARMOR_DEFINITIONS.map((armor) => <option key={armor.id} value={armor.id}>{armor.name} · AC {armor.baseAc} · {armor.weightClass}</option>)}</select></label>}
                {form.category === 'weapon' && <>
                  <label className="inventory-field"><span>Weapon type <small>structured rules</small></span><select value={form.weaponDefinitionId} onChange={(event) => { const definitionId = event.target.value; const definition = WEAPON_DEFINITIONS.find((weapon) => weapon.id === definitionId); setForm({ ...form, weaponDefinitionId: definitionId, weaponAbility: definition?.finesse ? (form.weaponAbility || 'str') : '' }) }}><option value="">Not configured</option>{WEAPON_DEFINITIONS.map((weapon) => <option key={weapon.id} value={weapon.id}>{weapon.name}{weapon.finesse ? ' · finesse' : ` · ${weapon.attackAbility.toUpperCase()}`}</option>)}</select></label>
                  {WEAPON_DEFINITIONS.find((weapon) => weapon.id === form.weaponDefinitionId)?.finesse && <label className="inventory-field"><span>Finesse attack ability</span><select value={form.weaponAbility || 'str'} onChange={(event) => setForm({ ...form, weaponAbility: event.target.value as 'str' | 'dex' })}><option value="str">Strength</option><option value="dex">Dexterity</option></select></label>}
                  <label className="inventory-field"><span>Manual attack bonus <small>optional override</small></span><input type="number" min="-20" max="50" step="1" value={form.manualAttackBonus} onChange={(event) => setForm({ ...form, manualAttackBonus: event.target.value })} placeholder="Calculated" /></label>
                </>}
              </div>
              <div className="inventory-form-actions"><button type="button" className="inventory-cancel-button" onClick={() => setFormOpen(false)} disabled={saving}>Cancel</button><button type="submit" className="inventory-add-button" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save changes' : 'Add item'}</button></div>
            </form>}

            {loadingItems || loadingPlayers || loadingCharacters ? <div className="inventory-list-message">Opening the character’s pack…</div> : !selectedCharacter ? <div className="inventory-list-message">Select a campaign, player, and character to view their inventory.</div> : items.length === 0 ? (
              <div className="inventory-empty-list"><span aria-hidden="true">✧</span><h3>The pack is empty</h3><p>Add the first item this character carries.</p><button type="button" className="inventory-add-button" onClick={openAddForm}>＋ Add first item</button></div>
            ) : (
              <div className="inventory-list">
                {items.map((item) => <article className="inventory-item" key={item.id}>
                  <div className="inventory-item-main"><div className="inventory-item-title"><h3>{item.name}</h3>{item.equipmentSlot ? <span className="inventory-equipped-badge">{equipmentSlotLabels[item.equipmentSlot]}</span> : item.equipped && <span className="inventory-equipped-badge">EQUIPPED · SLOT UNASSIGNED</span>}</div><div className="inventory-item-meta"><span>{categoryLabel(item.category)}</span><span>Qty {item.quantity}</span><span>{item.weight === null ? 'Weight unknown' : `${item.weight.toLocaleString()} lb each`}</span>{item.category === 'armor' && <span>{ARMOR_DEFINITIONS.find((armor) => armor.id === item.armorDefinitionId)?.name ?? 'Not configured'}</span>}{item.category === 'weapon' && <span>{WEAPON_DEFINITIONS.find((weapon) => weapon.id === item.weaponDefinitionId)?.name ?? 'Not configured'}</span>}</div>{item.notes && <p className="inventory-item-notes">{item.notes}</p>}</div>
                  <div className="inventory-item-actions">
                    {item.equipmentSlot ? <button type="button" className="inventory-text-button" onClick={() => void removeEquipment(item)}>Unequip</button> : compatibleEquipmentSlots(item.category).length > 0 && <><label className="inventory-slot-control"><span className="visually-hidden">Slot for {item.name}</span><select value={slotSelections[item.id] ?? compatibleEquipmentSlots(item.category)[0]} onChange={(event) => setSlotSelections({ ...slotSelections, [item.id]: event.target.value as EquipmentSlot })}>{compatibleEquipmentSlots(item.category).map((slot) => <option key={slot} value={slot}>{equipmentSlotLabels[slot]}</option>)}</select></label><button type="button" className="inventory-text-button" onClick={() => void assignEquipment(item.id, slotSelections[item.id] ?? compatibleEquipmentSlots(item.category)[0]!)}>Equip</button></>}
                    <button type="button" className="inventory-text-button" onClick={() => openEditForm(item)}>Edit</button><button type="button" className="inventory-delete-button" onClick={() => void deleteItem(item)}>Delete</button>
                  </div>
                </article>)}
              </div>
            )}
            {equipmentConflict && <div className="inventory-conflict" role="alert"><div><strong>{equipmentConflict.conflict.name}</strong> already occupies the {equipmentSlotLabels[equipmentConflict.slot]} slot. Keep it equipped, or explicitly move it back to the pack.</div><div className="inventory-conflict-actions"><button type="button" className="inventory-cancel-button" onClick={() => setEquipmentConflict(null)}>Keep existing item</button><button type="button" className="inventory-add-button" onClick={() => void assignEquipment(equipmentConflict.itemId, equipmentConflict.slot, true)}>Unequip {equipmentConflict.conflict.name} and equip selected item</button></div></div>}
          </section>
        </>
      )}
    </section>
  )
}
