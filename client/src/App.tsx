import { useCallback, useEffect, useState, type FormEvent } from 'react'
import DiceRoller from './DiceRoller'
import Checks from './Checks'
import CharacterSheet, { type SheetCharacter } from './CharacterSheet'
import Inventory from './Inventory'
import Combat from './Combat'
import Spellcasting from './Spellcasting'
import Adventures from './Adventures'
import SoloAdventure from './SoloAdventure'
import './App.css'
import './themes.css'
import { readTheme, saveTheme, type ThemeId } from './themePreferences.mjs'

type ServerState = 'checking' | 'online' | 'offline'
type CharacterStatus = 'active' | 'prepared' | 'dead' | 'retired'

interface Campaign {
  id: string
  name: string
  description: string
  setting: string
  createdAt: string
}

interface Character {
  id: string
  name: string
  species: string
  characterClass: string
  level: number
  str: number
  dex: number
  con: number
  int: number
  wis: number
  cha: number
  status: CharacterStatus
  createdAt: string
  updatedAt: string
}

interface CampaignPlayer {
  id: string
  playerId: string
  displayName: string
  createdAt: string
  characters: Character[]
}

interface CampaignForm {
  name: string
  description: string
  setting: string
}

interface CharacterForm {
  name: string
  species: string
  characterClass: string
  level: string
  status: 'prepared' | 'active'
  abilityScores: Record<'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha', string>
}

interface ApiError {
  error?: string
  fields?: Record<string, string>
}

const API_URL = 'http://localhost:3001/api'
const emptyCampaignForm: CampaignForm = { name: '', description: '', setting: '' }
const emptyCharacterForm: CharacterForm = {
  name: '', species: '', characterClass: '', level: '1', status: 'prepared',
  abilityScores: { str: '10', dex: '10', con: '10', int: '10', wis: '10', cha: '10' },
}
const abilityNames = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const

const navItems = [
  { label: 'Dashboard', icon: '⌂', active: true },
  { label: 'Campaigns', icon: '◈' },
  { label: 'Characters', icon: '♙' },
  { label: 'Dice Roller', icon: '⚄' },
  { label: 'Checks', icon: '⚔' },
  { label: 'Inventory', icon: '♜' },
  { label: 'Combat', icon: '⚔' },
  { label: 'Spellcasting', icon: '✧' },
  { label: 'Adventures', icon: '✦' },
  { label: 'Solo Adventure', icon: '➤' },
  { label: 'Settings', icon: '⚙' },
]
const themes: { id: ThemeId; name: string; detail: string }[] = [
  { id: 'classic', name: 'Classic Fantasy', detail: 'Parchment, bronze, and warm neutrals' },
  { id: 'modern', name: 'Modern Dark Fantasy', detail: 'Charcoal, muted gold, and clean panels' },
  { id: 'gothic', name: 'Gothic Medieval', detail: 'Black, burgundy, and silver' },
  { id: 'tactical', name: 'Tactical Command', detail: 'Navy, steel, teal, and high-contrast status' },
]

async function readPayload<T>(response: Response): Promise<T & ApiError> {
  return await response.json() as T & ApiError
}

function App() {
  const [theme, setTheme] = useState<ThemeId>(readTheme)
  const [serverState, setServerState] = useState<ServerState>('checking')
  const [notice, setNotice] = useState('')
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [campaignsLoading, setCampaignsLoading] = useState(true)
  const [campaignsError, setCampaignsError] = useState('')
  const [campaignFormOpen, setCampaignFormOpen] = useState(false)
  const [campaignForm, setCampaignForm] = useState<CampaignForm>(emptyCampaignForm)
  const [campaignFormErrors, setCampaignFormErrors] = useState<Record<string, string>>({})
  const [campaignSubmitError, setCampaignSubmitError] = useState('')
  const [campaignSubmitting, setCampaignSubmitting] = useState(false)
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null)
  const [players, setPlayers] = useState<CampaignPlayer[]>([])
  const [rosterLoading, setRosterLoading] = useState(false)
  const [rosterError, setRosterError] = useState('')
  const [rosterNotice, setRosterNotice] = useState('')
  const [playerFormOpen, setPlayerFormOpen] = useState(false)
  const [playerName, setPlayerName] = useState('')
  const [playerError, setPlayerError] = useState('')
  const [playerSubmitting, setPlayerSubmitting] = useState(false)
  const [characterFormPlayerId, setCharacterFormPlayerId] = useState<string | null>(null)
  const [characterForm, setCharacterForm] = useState<CharacterForm>(emptyCharacterForm)
  const [characterFormErrors, setCharacterFormErrors] = useState<Record<string, string>>({})
  const [characterSubmitError, setCharacterSubmitError] = useState('')
  const [characterSubmitting, setCharacterSubmitting] = useState(false)
  const [diceRollerOpen, setDiceRollerOpen] = useState(false)
  const [checksOpen, setChecksOpen] = useState(false)
  const [inventoryOpen, setInventoryOpen] = useState(false)
  const [combatOpen, setCombatOpen] = useState(false)
  const [spellcastingOpen, setSpellcastingOpen] = useState(false)
  const [adventuresOpen, setAdventuresOpen] = useState(false)
  const [soloAdventureOpen, setSoloAdventureOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [openSheetId, setOpenSheetId] = useState<string | null>(null)

  useEffect(() => { saveTheme(theme) }, [theme])

  const checkServer = useCallback(async () => {
    setServerState('checking')
    try {
      const response = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(5000) })
      if (!response.ok) throw new Error(`Health check returned ${response.status}`)
      setServerState('online')
    } catch {
      setServerState('offline')
    }
  }, [])

  const loadCampaigns = useCallback(async () => {
    setCampaignsLoading(true)
    setCampaignsError('')
    try {
      const response = await fetch(`${API_URL}/campaigns`)
      const payload = await readPayload<{ campaigns?: Campaign[] }>(response)
      if (!response.ok) throw new Error(payload.error || `Could not load campaigns (${response.status}).`)
      setCampaigns(Array.isArray(payload.campaigns) ? payload.campaigns : [])
    } catch (error) {
      setCampaignsError(error instanceof Error ? error.message : 'Could not connect to the RealmForge server.')
    } finally {
      setCampaignsLoading(false)
    }
  }, [])

  const loadRoster = useCallback(async (campaign: Campaign) => {
    setRosterLoading(true)
    setRosterError('')
    try {
      const response = await fetch(`${API_URL}/campaigns/${campaign.id}/players`)
      const payload = await readPayload<{ players?: Omit<CampaignPlayer, 'characters'>[] }>(response)
      if (!response.ok) throw new Error(payload.error || `Could not load roster (${response.status}).`)
      const roster = await Promise.all((payload.players ?? []).map(async (player) => {
        const charactersResponse = await fetch(`${API_URL}/campaigns/${campaign.id}/players/${player.playerId}/characters`)
        const charactersPayload = await readPayload<{ characters?: Character[] }>(charactersResponse)
        if (!charactersResponse.ok) throw new Error(charactersPayload.error || 'Could not load a player’s characters.')
        return { ...player, characters: charactersPayload.characters ?? [] }
      }))
      setPlayers(roster)
    } catch (error) {
      setRosterError(error instanceof Error ? error.message : 'Could not connect to the RealmForge server.')
    } finally {
      setRosterLoading(false)
    }
  }, [])

  useEffect(() => {
    void checkServer()
    void loadCampaigns()
  }, [checkServer, loadCampaigns])

  const openCampaignForm = () => {
    setCampaignForm(emptyCampaignForm)
    setCampaignFormErrors({})
    setCampaignSubmitError('')
    setCampaignFormOpen(true)
  }

  const submitCampaign = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setCampaignSubmitting(true)
    setCampaignFormErrors({})
    setCampaignSubmitError('')
    try {
      const response = await fetch(`${API_URL}/campaigns`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(campaignForm),
      })
      const payload = await readPayload<{ campaign?: Campaign }>(response)
      if (!response.ok) {
        if (payload.fields) setCampaignFormErrors(payload.fields)
        else setCampaignSubmitError(payload.error || `Could not save campaign (${response.status}).`)
        return
      }
      setCampaignFormOpen(false)
      await loadCampaigns()
    } catch (error) {
      setCampaignSubmitError(error instanceof Error ? error.message : 'Could not connect to the RealmForge server.')
    } finally {
      setCampaignSubmitting(false)
    }
  }

  const openRoster = (campaign: Campaign) => {
    setSelectedCampaign(campaign)
    setDiceRollerOpen(false)
    setChecksOpen(false)
    setInventoryOpen(false)
    setCombatOpen(false)
    setSpellcastingOpen(false)
    setAdventuresOpen(false)
    setSettingsOpen(false)
    setPlayers([])
    setSoloAdventureOpen(false)
    setRosterNotice('')
    setPlayerFormOpen(false)
    setCharacterFormPlayerId(null)
    setOpenSheetId(null)
    void loadRoster(campaign)
  }

  const submitPlayer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedCampaign) return
    setPlayerSubmitting(true)
    setPlayerError('')
    try {
      const response = await fetch(`${API_URL}/campaigns/${selectedCampaign.id}/players`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: playerName }),
      })
      const payload = await readPayload<{ player?: CampaignPlayer }>(response)
      if (!response.ok) {
        setPlayerError(payload.error || 'Could not add player.')
        return
      }
      setPlayerName('')
      setPlayerFormOpen(false)
      setRosterNotice('Player added to the campaign roster.')
      await loadRoster(selectedCampaign)
    } catch (error) {
      setPlayerError(error instanceof Error ? error.message : 'Could not connect to the RealmForge server.')
    } finally {
      setPlayerSubmitting(false)
    }
  }

  const submitCharacter = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedCampaign || !characterFormPlayerId) return
    setCharacterSubmitting(true)
    setCharacterFormErrors({})
    setCharacterSubmitError('')
    const body = {
      name: characterForm.name,
      species: characterForm.species,
      class: characterForm.characterClass,
      level: Number(characterForm.level),
      status: characterForm.status,
      abilityScores: Object.fromEntries(abilityNames.map((score) => [score, Number(characterForm.abilityScores[score])])),
    }

    try {
      const response = await fetch(`${API_URL}/campaigns/${selectedCampaign.id}/players/${characterFormPlayerId}/characters`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const payload = await readPayload<{ character?: Character }>(response)
      if (!response.ok) {
        if (payload.fields) setCharacterFormErrors(payload.fields)
        else setCharacterSubmitError(payload.error || 'Could not create character.')
        return
      }
      setCharacterFormPlayerId(null)
      setCharacterForm(emptyCharacterForm)
      setRosterNotice('Character created and added to the roster.')
      await loadRoster(selectedCampaign)
    } catch (error) {
      setCharacterSubmitError(error instanceof Error ? error.message : 'Could not connect to the RealmForge server.')
    } finally {
      setCharacterSubmitting(false)
    }
  }

  const changeCharacterStatus = async (playerId: string, character: Character, action: 'activate' | 'dead' | 'retire') => {
    if (!selectedCampaign) return
    if (action === 'dead' && !window.confirm(`Mark ${character.name} as dead? Their character record will be preserved.`)) return
    if (action === 'retire' && !window.confirm(`Retire ${character.name}? Their character record will remain in the roster.`)) return

    setRosterError('')
    setRosterNotice('')
    try {
      const response = await fetch(`${API_URL}/campaigns/${selectedCampaign.id}/players/${playerId}/characters/${character.id}/${action}`, { method: 'POST' })
      const payload = await readPayload<{ character?: Character }>(response)
      if (!response.ok) throw new Error(payload.error || `Could not ${action} character.`)
      const successMessage = action === 'activate'
        ? `${character.name} is now active.`
        : action === 'dead' ? `${character.name} has been marked dead. The record is preserved.` : `${character.name} has been retired.`
      setRosterNotice(successMessage)
      await loadRoster(selectedCampaign)
    } catch (error) {
      setRosterError(error instanceof Error ? error.message : 'Could not update character status.')
    }
  }

  return (
    <div className="app-shell" data-theme={theme}>
      <aside className="sidebar">
        <a className="brand" href="#dashboard" aria-label="RealmForge home">
          <span className="brand-mark" aria-hidden="true"><span>✦</span></span>
          <span className="brand-name">Realm<span>Forge</span></span>
        </a>
        <div className="nav-caption">WORKSPACE</div>
        <nav className="main-nav" aria-label="Main navigation">
          {navItems.map((item) => (
            <a
              className={`nav-link${(item.label === 'Dice Roller' && diceRollerOpen) || (item.label === 'Checks' && checksOpen) || (item.label === 'Inventory' && inventoryOpen) || (item.label === 'Combat' && combatOpen) || (item.label === 'Spellcasting' && spellcastingOpen) || (item.label === 'Adventures' && adventuresOpen) || (item.label === 'Solo Adventure' && soloAdventureOpen) || (item.label === 'Settings' && settingsOpen) || (item.active && !selectedCampaign && !diceRollerOpen && !checksOpen && !inventoryOpen && !combatOpen && !spellcastingOpen && !adventuresOpen && !soloAdventureOpen && !settingsOpen) ? ' active' : ''}`}
              href={item.label === 'Dice Roller' ? '#dice-roller' : item.label === 'Checks' ? '#checks-heading' : item.label === 'Inventory' ? '#inventory-heading' : item.label === 'Combat' ? '#combat-heading' : item.label === 'Spellcasting' ? '#spellcasting-heading' : item.label === 'Adventures' ? '#adventures-heading' : item.label === 'Solo Adventure' ? '#solo-heading' : item.label === 'Settings' ? '#theme-settings-heading' : item.active ? '#dashboard' : item.label === 'Campaigns' ? '#campaign-heading' : '#'}
              key={item.label}
              aria-label={item.label}
              title={item.label}
              aria-current={(item.label === 'Dice Roller' && diceRollerOpen) || (item.label === 'Checks' && checksOpen) || (item.label === 'Inventory' && inventoryOpen) || (item.label === 'Combat' && combatOpen) || (item.label === 'Spellcasting' && spellcastingOpen) || (item.label === 'Adventures' && adventuresOpen) || (item.label === 'Solo Adventure' && soloAdventureOpen) || (item.label === 'Settings' && settingsOpen) || (item.active && !selectedCampaign && !diceRollerOpen && !checksOpen && !inventoryOpen && !combatOpen && !spellcastingOpen && !adventuresOpen && !soloAdventureOpen && !settingsOpen) ? 'page' : undefined}
              onClick={(event) => {
                if (item.label !== 'Spellcasting') setSpellcastingOpen(false)
                if (item.label === 'Adventures') {
                  event.preventDefault(); setSelectedCampaign(null); setDiceRollerOpen(false); setChecksOpen(false); setInventoryOpen(false); setCombatOpen(false); setSpellcastingOpen(false); setAdventuresOpen(true); setSoloAdventureOpen(false); setSettingsOpen(false)
                  return
                }
                if (item.label === 'Solo Adventure') {
                  event.preventDefault(); setSelectedCampaign(null); setDiceRollerOpen(false); setChecksOpen(false); setInventoryOpen(false); setCombatOpen(false); setSpellcastingOpen(false); setAdventuresOpen(false); setSoloAdventureOpen(true); setSettingsOpen(false)
                  return
                }
                if (item.label === 'Spellcasting') {
                  event.preventDefault(); setSelectedCampaign(null); setDiceRollerOpen(false); setChecksOpen(false); setInventoryOpen(false); setCombatOpen(false); setSpellcastingOpen(true); setAdventuresOpen(false); setSoloAdventureOpen(false); setSettingsOpen(false)
                  return
                }
                if (item.label === 'Dice Roller') {
                  event.preventDefault()
                  setSelectedCampaign(null)
                  setDiceRollerOpen(true)
                  setChecksOpen(false)
                  setInventoryOpen(false)
                  setCombatOpen(false)
                  setSpellcastingOpen(false)
                  setAdventuresOpen(false)
                  setSoloAdventureOpen(false)
                  setSettingsOpen(false)
                  return
                }
                if (item.label === 'Checks') {
                  event.preventDefault()
                  setSelectedCampaign(null)
                  setDiceRollerOpen(false)
                  setChecksOpen(true)
                  setInventoryOpen(false)
                  setCombatOpen(false)
                  setSpellcastingOpen(false)
                  setAdventuresOpen(false)
                  setSoloAdventureOpen(false)
                  setSettingsOpen(false)
                  return
                }
                if (item.label === 'Combat') {
                  event.preventDefault()
                  setSelectedCampaign(null)
                  setDiceRollerOpen(false)
                  setChecksOpen(false)
                  setInventoryOpen(false)
                  setCombatOpen(true)
                  setSpellcastingOpen(false)
                  setAdventuresOpen(false)
                  setSoloAdventureOpen(false)
                  setSettingsOpen(false)
                  return
                }
                if (item.label === 'Inventory') {
                  event.preventDefault()
                  setSelectedCampaign(null)
                  setDiceRollerOpen(false)
                  setChecksOpen(false)
                  setInventoryOpen(true)
                  setCombatOpen(false)
                  setSpellcastingOpen(false)
                  setAdventuresOpen(false)
                  setSoloAdventureOpen(false)
                  setSettingsOpen(false)
                  return
                }
                if (item.label === 'Campaigns') {
                  event.preventDefault()
                  setSelectedCampaign(null)
                  setDiceRollerOpen(false)
                  setChecksOpen(false)
                  setInventoryOpen(false)
                  setCombatOpen(false)
                  setSpellcastingOpen(false)
                  setAdventuresOpen(false)
                  setSoloAdventureOpen(false)
                  setSettingsOpen(false)
                  return
                }
                if (item.label === 'Dashboard') {
                  setSelectedCampaign(null)
                  setDiceRollerOpen(false)
                  setChecksOpen(false)
                  setInventoryOpen(false)
                  setCombatOpen(false)
                  setSpellcastingOpen(false)
                  setAdventuresOpen(false)
                  setSoloAdventureOpen(false)
                  setSettingsOpen(false)
                  return
                }
                if (item.label === 'Settings') {
                  event.preventDefault()
                  setSelectedCampaign(null); setDiceRollerOpen(false); setChecksOpen(false); setInventoryOpen(false); setCombatOpen(false); setSpellcastingOpen(false); setAdventuresOpen(false); setSoloAdventureOpen(false); setSettingsOpen(true)
                  return
                }
                if (!item.active) {
                  event.preventDefault()
                  setNotice(`${item.label} will be available in a future update.`)
                }
              }}
            >
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>
              {item.label}
              {item.label === 'Campaigns' && <span className="nav-count">{campaigns.length}</span>}
            </a>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-rule" />
          <div className="table-card">
            <div className="table-card-icon">♜</div>
            <div><div className="table-card-title">Your table awaits</div><div className="table-card-copy">Gather your party and begin.</div></div>
            <span className="table-card-star">✧</span>
          </div>
          <div className="profile">
            <div className="avatar">A</div>
            <div className="profile-copy"><strong>Adventurer</strong><span>Dungeon Master</span></div>
            <span className="profile-more">···</span>
          </div>
        </div>
      </aside>

      <main className="main-content" id="dashboard">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><span className="crumb-divider">/</span><strong>{settingsOpen ? 'Settings' : soloAdventureOpen ? 'Solo Adventure' : adventuresOpen ? 'Adventures' : spellcastingOpen ? 'Spellcasting' : combatOpen ? 'Combat' : inventoryOpen ? 'Inventory' : checksOpen ? 'Checks' : diceRollerOpen ? 'Dice Roller' : selectedCampaign ? 'Campaign Roster' : 'Dashboard'}</strong></div>
          <div className={`server-status ${serverState}`} role="status" aria-live="polite">
            <span className="status-dot" />
            <span>{serverState === 'checking' ? 'Checking server' : serverState === 'online' ? 'Server online' : 'Server offline'}</span>
            {serverState === 'offline' && <button className="retry-button" onClick={() => void checkServer()}>Retry</button>}
          </div>
        </header>

        {notice && <div className="global-notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss notice">×</button></div>}

        <div className="content-wrap">
          {settingsOpen ? <section className="theme-settings" aria-labelledby="theme-settings-heading"><div className="eyebrow"><span className="eyebrow-line" />APPEARANCE</div><h1 id="theme-settings-heading">Choose your realm</h1><p>Preview four palettes across the campaign workspace. Your choice is saved on this device.</p><div className="theme-options" role="group" aria-label="RealmForge visual theme">{themes.map((entry) => <button type="button" aria-pressed={theme === entry.id} className={`theme-option ${entry.id}${theme === entry.id ? ' selected' : ''}`} key={entry.id} onClick={() => setTheme(entry.id)}><span className="theme-swatches" aria-hidden="true"><i /><i /><i /></span><strong>{entry.name}</strong><small>{entry.detail}</small>{theme === entry.id && <span className="theme-selected">Selected</span>}</button>)}</div><p className="theme-note">Modern Dark Fantasy is the default theme. Theme selection does not affect campaign data.</p></section> : soloAdventureOpen ? <SoloAdventure campaigns={campaigns} onReturnToManagement={() => { setSoloAdventureOpen(false); setAdventuresOpen(true) }} onOpenRoster={(id) => { const target = campaigns.find((item) => item.id === id); if (target) openRoster(target) }} /> : adventuresOpen ? <Adventures campaigns={campaigns} /> : spellcastingOpen ? <Spellcasting campaigns={campaigns} /> : combatOpen ? <Combat campaigns={campaigns} /> : inventoryOpen ? <Inventory campaigns={campaigns} /> : checksOpen ? <Checks campaigns={campaigns} /> : diceRollerOpen ? <DiceRoller /> : !selectedCampaign ? (
            <>
              <section className="welcome-section">
                <div className="welcome-copy">
                  <div className="eyebrow"><span className="eyebrow-line" />YOUR ADVENTURE STARTS HERE</div>
                  <h1>Welcome, <em>Adventurer.</em></h1>
                  <p>Your next great story is waiting to be told. Set the scene, gather your party, and let the legend begin.</p>
                </div>
                <div className="welcome-art" aria-hidden="true"><div className="moon-glow" /><div className="moon" /><div className="mountain mountain-back" /><div className="mountain mountain-front" /><div className="art-sigil">✦</div></div>
              </section>

              <section className="campaign-section" aria-labelledby="campaign-heading">
                <div className="section-heading">
                  <div><div className="eyebrow small"><span className="eyebrow-line" />THE CHRONICLES</div><h2 id="campaign-heading">Your Campaigns</h2></div>
                  <div className="section-actions"><span className="campaign-total">{campaigns.length} <span>CAMPAIGNS</span></span><button className="section-create-button" onClick={openCampaignForm}>＋ <span>Create Campaign</span></button></div>
                </div>
                {campaignsError ? (
                  <div className="campaign-message error-panel" role="alert"><span>{campaignsError}</span><button className="text-button" onClick={() => void loadCampaigns()}>Try again</button></div>
                ) : campaignsLoading ? (
                  <div className="campaign-message">Opening the campaign archive…</div>
                ) : campaigns.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-art" aria-hidden="true"><div className="orbital orbital-one" /><div className="orbital orbital-two" /><div className="book-shadow" /><div className="spellbook"><span className="book-corner top-left" /><span className="book-corner top-right" /><span className="book-corner bottom-left" /><span className="book-corner bottom-right" /><span className="book-rune">✧</span><span className="book-line" /><span className="book-line short" /></div><span className="spark spark-one">✦</span><span className="spark spark-two">✧</span><span className="spark spark-three">·</span></div>
                    <div className="empty-copy"><div className="empty-kicker">A BLANK PAGE. A THOUSAND POSSIBILITIES.</div><h3>No campaigns yet</h3><p>Every legend begins somewhere. Create your first campaign and give your next adventure a world of its own.</p><button className="create-button" onClick={openCampaignForm}><span className="button-plus">＋</span>Create Campaign<span className="button-arrow">↗</span></button></div>
                  </div>
                ) : (
                  <div className="campaign-grid">
                    {campaigns.map((campaign) => (
                      <article className="campaign-card" key={campaign.id}>
                        <div className="campaign-card-mark" aria-hidden="true">✦</div>
                        <div className="campaign-card-content">
                          <div className="campaign-card-meta">CAMPAIGN <span>·</span> {new Date(campaign.createdAt).toLocaleDateString()}</div>
                          <h3>{campaign.name}</h3>
                          {campaign.setting && <div className="campaign-setting">{campaign.setting}</div>}
                          <p>{campaign.description || 'A new adventure waits to be written.'}</p>
                          <button className="manage-roster-button" onClick={() => openRoster(campaign)}>Manage roster <span>↗</span></button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
              <footer className="page-footer"><span>FORGED FOR ADVENTURE</span><span className="footer-sigil">✦</span><span>YOUR STORY, YOUR WORLD</span></footer>
            </>
          ) : (
            <section className="campaign-section roster-section" aria-labelledby="campaign-heading">
              <div className="roster-back-row"><button className="back-button" onClick={() => setSelectedCampaign(null)}>← All campaigns</button><span className="eyebrow small"><span className="eyebrow-line" />CAMPAIGN ROSTER</span></div>
              <div className="roster-title-row"><div><h2 id="campaign-heading">{selectedCampaign.name}</h2><p className="roster-subtitle">{selectedCampaign.setting || 'Campaign'} · {players.length} {players.length === 1 ? 'player' : 'players'}</p></div><button className="section-create-button" onClick={() => { setPlayerFormOpen(true); setPlayerError('') }}>＋ <span>Add Player</span></button></div>

              {rosterNotice && <div className="roster-feedback success" role="status">✦ {rosterNotice}</div>}
              {rosterError && <div className="roster-feedback failure" role="alert">{rosterError}<button className="text-button" onClick={() => void loadRoster(selectedCampaign)}>Try again</button></div>}

              {playerFormOpen && (
                <form className="player-add-form" onSubmit={(event) => void submitPlayer(event)}>
                  <label className="compact-field"><span>Player display name</span><input autoFocus maxLength={80} value={playerName} onChange={(event) => setPlayerName(event.target.value)} placeholder="Enter a player name" /></label>
                  {playerError && <div className="field-error" role="alert">{playerError}</div>}
                  <div className="inline-actions"><button className="cancel-button" type="button" onClick={() => setPlayerFormOpen(false)} disabled={playerSubmitting}>Cancel</button><button className="section-create-button" type="submit" disabled={playerSubmitting}>{playerSubmitting ? 'Adding…' : 'Add player'}</button></div>
                </form>
              )}

              {rosterLoading ? <div className="campaign-message">Gathering the party roster…</div> : players.length === 0 && !rosterError ? (
                <div className="roster-empty"><span className="roster-empty-sigil">♙</span><h3>No players have joined yet</h3><p>Add players by display name. They can create several characters for this campaign.</p><button className="create-button" onClick={() => setPlayerFormOpen(true)}>＋ Add the first player</button></div>
              ) : (
                <div className="player-list">
                  {players.map((player) => (
                    <article className="player-card" key={player.id}>
                      <header className="player-card-header"><div className="player-avatar">{player.displayName.trim().charAt(0).toUpperCase()}</div><div className="player-heading"><h3>{player.displayName}</h3><span>{player.characters.length} {player.characters.length === 1 ? 'character' : 'characters'}</span></div><button className="text-button" onClick={() => { setCharacterFormPlayerId(characterFormPlayerId === player.playerId ? null : player.playerId); setCharacterForm(emptyCharacterForm); setCharacterFormErrors({}); setCharacterSubmitError('') }}>{characterFormPlayerId === player.playerId ? 'Close form' : '＋ New character'}</button></header>
                      {player.characters.length === 0 ? <p className="player-no-characters">No characters yet. Create one to begin their story.</p> : (
                        <div className="character-list">
                          {player.characters.map((character) => (
                            <section className={`character-card status-${character.status}`} key={character.id}>
                              <div className="character-main"><div className="character-title-line"><h4>{character.name}</h4><span className={`status-badge ${character.status}`}>{character.status}</span></div><p className="character-description">Level {character.level} {character.species} {character.characterClass}</p><div className="ability-row" aria-label="Ability scores">{abilityNames.map((score) => <span key={score}><b>{score.toUpperCase()}</b>{character[score]}</span>)}</div></div>
                              <div className="character-actions">
                                <button
                                  id={`character-sheet-trigger-${character.id}`}
                                  className="character-action sheet-open"
                                  type="button"
                                  aria-haspopup="dialog"
                                  aria-expanded={openSheetId === character.id}
                                  onClick={() => setOpenSheetId(openSheetId === character.id ? null : character.id)}
                                >Character sheet</button>
                                {character.status === 'prepared' && <button className="character-action activate" onClick={() => void changeCharacterStatus(player.playerId, character, 'activate')}>Activate</button>}
                                {(character.status === 'active' || character.status === 'prepared') && <><button className="character-action" onClick={() => void changeCharacterStatus(player.playerId, character, 'dead')}>Mark dead</button><button className="character-action retire" onClick={() => void changeCharacterStatus(player.playerId, character, 'retire')}>Retire</button></>}
                              </div>
                              {openSheetId === character.id && selectedCampaign && <CharacterSheet
                                campaignId={selectedCampaign.id}
                                playerId={player.playerId}
                                characterId={character.id}
                                onClose={() => {
                                  setOpenSheetId(null)
                                  window.requestAnimationFrame(() => document.getElementById(`character-sheet-trigger-${character.id}`)?.focus())
                                }}
                                onSaved={(updated: SheetCharacter) => setPlayers((current) => current.map((entry) => entry.playerId === player.playerId
                                  ? { ...entry, characters: entry.characters.map((item) => item.id === updated.id ? { ...item, level: updated.level, str: updated.str, dex: updated.dex, con: updated.con, int: updated.int, wis: updated.wis, cha: updated.cha } : item) }
                                  : entry))}
                              />}
                            </section>
                          ))}
                        </div>
                      )}

                      {characterFormPlayerId === player.playerId && (
                        <form className="character-form" onSubmit={(event) => void submitCharacter(event)}>
                          <div className="character-form-heading"><div className="eyebrow small"><span className="eyebrow-line" />NEW CHARACTER</div><h4>Create for {player.displayName}</h4></div>
                          <div className="character-fields">
                            <label className="compact-field"><span>Name</span><input maxLength={80} value={characterForm.name} onChange={(event) => setCharacterForm({ ...characterForm, name: event.target.value })} placeholder="Character name" />{characterFormErrors.name && <small className="field-error">{characterFormErrors.name}</small>}</label>
                            <label className="compact-field"><span>Species</span><input maxLength={60} value={characterForm.species} onChange={(event) => setCharacterForm({ ...characterForm, species: event.target.value })} placeholder="Species" />{characterFormErrors.species && <small className="field-error">{characterFormErrors.species}</small>}</label>
                            <label className="compact-field"><span>Class</span><input maxLength={60} value={characterForm.characterClass} onChange={(event) => setCharacterForm({ ...characterForm, characterClass: event.target.value })} placeholder="Class" />{characterFormErrors.class && <small className="field-error">{characterFormErrors.class}</small>}</label>
                            <label className="compact-field level-field"><span>Level</span><input type="number" min="1" max="20" step="1" value={characterForm.level} onChange={(event) => setCharacterForm({ ...characterForm, level: event.target.value })} />{characterFormErrors.level && <small className="field-error">{characterFormErrors.level}</small>}</label>
                          </div>
                          <div className="scores-heading">ABILITY SCORES <span>1–30</span></div>
                          <div className="score-fields">{abilityNames.map((score) => <label className="score-field" key={score}><span>{score.toUpperCase()}</span><input type="number" min="1" max="30" step="1" value={characterForm.abilityScores[score]} onChange={(event) => setCharacterForm({ ...characterForm, abilityScores: { ...characterForm.abilityScores, [score]: event.target.value } })} />{characterFormErrors[score] && <small className="field-error">{characterFormErrors[score]}</small>}</label>)}</div>
                          {characterFormErrors.abilityScores && <div className="field-error">{characterFormErrors.abilityScores}</div>}
                          <div className="character-form-bottom"><label className="compact-field status-select"><span>Starting status</span><select value={characterForm.status} onChange={(event) => setCharacterForm({ ...characterForm, status: event.target.value as 'prepared' | 'active' })}><option value="prepared">Prepared (default)</option><option value="active">Active</option></select></label><div className="inline-actions"><button className="cancel-button" type="button" onClick={() => setCharacterFormPlayerId(null)} disabled={characterSubmitting}>Cancel</button><button className="create-button" type="submit" disabled={characterSubmitting}>{characterSubmitting ? 'Saving…' : 'Create character'}</button></div></div>
                          {characterSubmitError && <div className="form-error" role="alert">{characterSubmitError}</div>}
                        </form>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </main>

      {campaignFormOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !campaignSubmitting) setCampaignFormOpen(false) }}>
          <section className="campaign-modal" role="dialog" aria-modal="true" aria-labelledby="form-heading">
            <button className="modal-close" onClick={() => setCampaignFormOpen(false)} aria-label="Close campaign form" disabled={campaignSubmitting}>×</button>
            <div className="eyebrow small"><span className="eyebrow-line" />BEGIN A NEW CHRONICLE</div><h2 id="form-heading">Create a Campaign</h2><p className="modal-intro">Give your adventure a name, a world, and a place to begin.</p>
            <form onSubmit={(event) => void submitCampaign(event)} noValidate>
              <label className="form-field"><span>Campaign name <i>*</i></span><input autoFocus maxLength={100} value={campaignForm.name} onChange={(event) => setCampaignForm({ ...campaignForm, name: event.target.value })} aria-invalid={Boolean(campaignFormErrors.name)} placeholder="The Shattered Crown" />{campaignFormErrors.name && <small className="field-error">{campaignFormErrors.name}</small>}</label>
              <label className="form-field"><span>Description</span><textarea maxLength={2000} rows={3} value={campaignForm.description} onChange={(event) => setCampaignForm({ ...campaignForm, description: event.target.value })} aria-invalid={Boolean(campaignFormErrors.description)} placeholder="A brief glimpse of the adventure…" />{campaignFormErrors.description && <small className="field-error">{campaignFormErrors.description}</small>}</label>
              <label className="form-field"><span>Setting</span><input maxLength={120} value={campaignForm.setting} onChange={(event) => setCampaignForm({ ...campaignForm, setting: event.target.value })} aria-invalid={Boolean(campaignFormErrors.setting)} placeholder="Forgotten Realms, homebrew…" />{campaignFormErrors.setting && <small className="field-error">{campaignFormErrors.setting}</small>}</label>
              {campaignSubmitError && <div className="form-error" role="alert">{campaignSubmitError}</div>}
              <div className="modal-actions"><button className="cancel-button" type="button" onClick={() => setCampaignFormOpen(false)} disabled={campaignSubmitting}>Cancel</button><button className="create-button" type="submit" disabled={campaignSubmitting}><span className="button-plus">＋</span>{campaignSubmitting ? 'Creating…' : 'Create Campaign'}<span className="button-arrow">↗</span></button></div>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}

export default App
