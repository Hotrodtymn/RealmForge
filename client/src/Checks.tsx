import { useEffect, useState, type FormEvent } from 'react'
import { ABILITIES, abilityModifier, proficiencyBonus } from './characterRules'
import { appendCheckHistory, checkOptions, resolveCheck, type CheckKind, type ResolvedCheck } from './checkRules'
import type { RollMode } from './dice'
import './Checks.css'

const API_URL = 'http://localhost:3001/api'

interface Campaign {
  id: string
  name: string
}

interface RosterPlayer {
  playerId: string
  displayName: string
  characters: { id: string; name: string; status: string }[]
}

interface CharacterChoice {
  campaignId: string
  campaignName: string
  playerId: string
  playerName: string
  characterId: string
  characterName: string
  status: string
}

interface SavedCharacter {
  id: string
  name: string
  level: number
  status: 'active' | 'prepared' | 'dead' | 'retired'
  str: number
  dex: number
  con: number
  int: number
  wis: number
  cha: number
  savingThrowProficiencies: string[]
  skillProficiencies: string[]
  createdAt: string
  updatedAt: string
}

interface Props {
  campaigns: Campaign[]
}

const signed = (value: number) => value >= 0 ? `+${value}` : `${value}`

export default function Checks({ campaigns }: Props) {
  const [campaignId, setCampaignId] = useState('')
  const [choices, setChoices] = useState<CharacterChoice[]>([])
  const [characterId, setCharacterId] = useState('')
  const [character, setCharacter] = useState<SavedCharacter | null>(null)
  const [rosterLoading, setRosterLoading] = useState(false)
  const [sheetLoading, setSheetLoading] = useState(false)
  const [error, setError] = useState('')
  const [kind, setKind] = useState<CheckKind>('skill')
  const [checkKey, setCheckKey] = useState('acrobatics')
  const [mode, setMode] = useState<RollMode>('normal')
  const [situationalModifier, setSituationalModifier] = useState('0')
  const [dc, setDc] = useState('')
  const [latest, setLatest] = useState<ResolvedCheck | null>(null)
  const [history, setHistory] = useState<ResolvedCheck[]>([])

  useEffect(() => {
    if (!campaigns.length) {
      setCampaignId('')
      setChoices([])
      setCharacterId('')
      setCharacter(null)
      return
    }
    if (!campaigns.some((campaign) => campaign.id === campaignId)) setCampaignId(campaigns[0]!.id)
  }, [campaigns, campaignId])

  useEffect(() => {
    if (!campaignId) return
    let cancelled = false
    const campaign = campaigns.find((item) => item.id === campaignId)
    if (!campaign) return
    const campaignName = campaign.name
    setRosterLoading(true)
    setError('')
    setChoices([])
    setCharacter(null)
    setCharacterId('')
    setLatest(null)
    async function loadRoster() {
      try {
        const playersResponse = await fetch(`${API_URL}/campaigns/${campaignId}/players`)
        const playersPayload = await playersResponse.json() as { players?: Omit<RosterPlayer, 'characters'>[]; error?: string }
        if (!playersResponse.ok) throw new Error(playersPayload.error || 'Could not load campaign players.')
        const roster = await Promise.all((playersPayload.players ?? []).map(async (player) => {
          const response = await fetch(`${API_URL}/campaigns/${campaignId}/players/${player.playerId}/characters`)
          const payload = await response.json() as { characters?: RosterPlayer['characters']; error?: string }
          if (!response.ok) throw new Error(payload.error || `Could not load ${player.displayName}’s characters.`)
          return { player, characters: payload.characters ?? [] }
        }))
        if (cancelled) return
        const loadedChoices = roster.flatMap(({ player, characters }) => characters.map((entry) => ({
          campaignId, campaignName, playerId: player.playerId, playerName: player.displayName,
          characterId: entry.id, characterName: entry.name, status: entry.status,
        })))
        setChoices(loadedChoices)
        setCharacterId(loadedChoices[0]?.characterId ?? '')
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load campaign characters.')
      } finally {
        if (!cancelled) setRosterLoading(false)
      }
    }
    void loadRoster()
    return () => { cancelled = true }
  }, [campaignId, campaigns])

  const selected = choices.find((choice) => choice.characterId === characterId)

  useEffect(() => {
    const choice = selected
    if (!choice) {
      setCharacter(null)
      setSheetLoading(false)
      return
    }
    const { campaignId: selectedCampaignId, playerId: selectedPlayerId, characterId: selectedCharacterId } = choice
    let cancelled = false
    setSheetLoading(true)
    setError('')
    setCharacter(null)
    setLatest(null)
    async function loadSheet() {
      try {
        const response = await fetch(`${API_URL}/campaigns/${selectedCampaignId}/players/${selectedPlayerId}/characters/${selectedCharacterId}/sheet`)
        const payload = await response.json() as { sheet?: SavedCharacter; error?: string }
        if (!response.ok || !payload.sheet) throw new Error(payload.error || 'Could not load the character’s saved statistics.')
        if (cancelled) return
        setCharacter(payload.sheet)
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load the character’s saved statistics.')
      } finally {
        if (!cancelled) setSheetLoading(false)
      }
    }
    void loadSheet()
    return () => { cancelled = true }
  }, [selected?.campaignId, selected?.playerId, selected?.characterId])

  const options = checkOptions(kind)
  const activeCheck = options.find((item) => item.key === checkKey) ?? options[0]

  useEffect(() => {
    if (!options.some((option) => option.key === checkKey)) setCheckKey(options[0]!.key)
  }, [kind, checkKey, options])

  const checkProficient = Boolean(character && activeCheck && (kind === 'skill'
    ? character.skillProficiencies.includes(activeCheck.key)
    : character.savingThrowProficiencies.includes(activeCheck.key)))
  const activeScore = character && activeCheck ? character[activeCheck.ability] : null
  const activeModifier = activeScore === null || activeScore === undefined ? null : abilityModifier(activeScore)
  const activeProficiency = character ? (checkProficient ? proficiencyBonus(character.level) : 0) : null
  const calculatedBonus = activeModifier === null || activeProficiency === null ? null : activeModifier + activeProficiency

  function roll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!character || !activeCheck) {
      setError('Select a character before rolling a check.')
      return
    }
    if (dc.trim() !== '' && !/^-?\d+$/.test(dc.trim())) {
      setError('DC must be a whole number from 1 to 100.')
      return
    }
    setError('')
    try {
      const resolved = resolveCheck({
        character: {
          id: character.id,
          name: character.name,
          level: character.level,
          abilityScores: {
            str: character.str, dex: character.dex, con: character.con,
            int: character.int, wis: character.wis, cha: character.cha,
          },
          savingThrowProficiencies: [...character.savingThrowProficiencies],
          skillProficiencies: [...character.skillProficiencies],
        },
        kind,
        key: activeCheck.key,
        mode,
        situationalModifier: Number(situationalModifier.trim() || 0),
        ...(dc.trim() === '' ? {} : { dc: Number(dc) }),
      })
      setLatest(resolved)
      setHistory((previous) => appendCheckHistory(previous, resolved))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not resolve this check.')
    }
  }

  return (
    <section className="checks-view" aria-labelledby="checks-heading">
      <header className="checks-page-heading">
        <div className="eyebrow"><span className="eyebrow-line" />TEST YOUR FATE</div>
        <h1 id="checks-heading">Skill Checks &amp; <em>Saving Throws</em></h1>
        <p>Use a character’s saved statistics to resolve a d20 check.</p>
      </header>

      {campaigns.length === 0 ? <div className="checks-empty"><span aria-hidden="true">✧</span><h2>No campaign characters yet</h2><p>Create a campaign, add players, and create a character to make checks.</p></div> : (
        <div className="checks-layout">
          <form className="checks-controls" onSubmit={roll}>
            <div className="checks-section-heading"><div className="eyebrow small"><span className="eyebrow-line" />CHOOSE YOUR CHECK</div><span aria-hidden="true">⚄</span></div>
            <label className="checks-field"><span>Campaign</span><select value={campaignId} onChange={(event) => setCampaignId(event.target.value)}>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label>
            <label className="checks-field"><span>Character</span><select value={characterId} onChange={(event) => setCharacterId(event.target.value)} disabled={rosterLoading || choices.length === 0}><option value="">{rosterLoading ? 'Loading roster…' : choices.length ? 'Select a character' : 'No characters in this campaign'}</option>{choices.map((choice) => <option key={choice.characterId} value={choice.characterId}>{choice.playerName} · {choice.characterName} ({choice.status})</option>)}</select></label>
            <div className="checks-radio-row" role="group" aria-label="Check category">
              <button type="button" className={kind === 'skill' ? 'selected' : ''} aria-pressed={kind === 'skill'} onClick={() => setKind('skill')}>Skill</button>
              <button type="button" className={kind === 'saving_throw' ? 'selected' : ''} aria-pressed={kind === 'saving_throw'} onClick={() => setKind('saving_throw')}>Saving throw</button>
            </div>
            <label className="checks-field"><span>{kind === 'skill' ? 'Skill' : 'Saving throw'}</span><select value={activeCheck?.key ?? ''} onChange={(event) => setCheckKey(event.target.value)}>{options.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>

            <div className="check-summary" aria-live="polite">
              {sheetLoading ? <span>Reading saved character statistics…</span> : character && activeCheck && activeModifier !== null ? <>
                <div><span>ABILITY</span><strong>{ABILITIES.find(({ key }) => key === activeCheck.ability)?.name} ({activeCheck.ability.toUpperCase()})</strong></div>
                <div><span>ABILITY MODIFIER</span><strong>{signed(activeModifier)}</strong></div>
                <div><span>PROFICIENCY</span><strong>{checkProficient ? `Proficient · ${signed(activeProficiency ?? 0)}` : 'Not proficient'}</strong></div>
                <div className="check-summary-bonus"><span>CHECK BONUS</span><strong>{signed(calculatedBonus ?? 0)}</strong></div>
              </> : <span>Select a character to load saved ability scores and proficiencies.</span>}
            </div>

            <div className="checks-input-row">
              <label className="checks-field"><span>Situational modifier <small>optional</small></span><input type="number" min="-100" max="100" step="1" value={situationalModifier} onChange={(event) => setSituationalModifier(event.target.value)} /></label>
              <label className="checks-field"><span>Difficulty Class <small>optional</small></span><input type="number" min="1" max="100" step="1" placeholder="No DC" value={dc} onChange={(event) => setDc(event.target.value)} /></label>
            </div>
            <label className="checks-field"><span>Roll mode</span><select value={mode} onChange={(event) => setMode(event.target.value as RollMode)}><option value="normal">Normal</option><option value="advantage">Advantage</option><option value="disadvantage">Disadvantage</option></select></label>
            <p className="checks-mode-note">Advantage and Disadvantage each roll two d20s and keep one result.</p>
            {error && <div className="checks-error" role="alert">{error}</div>}
            <button className="checks-roll-button" type="submit" disabled={!character || sheetLoading}>Roll Check <span aria-hidden="true">↗</span></button>
          </form>

          <div className="checks-results-column">
            <section className="checks-result-panel" aria-live="polite" aria-label="Latest check result">
              <div className="checks-section-heading"><div className="eyebrow small"><span className="eyebrow-line" />THE RESULT</div>{latest && <span className="checks-mode-label">{latest.mode}</span>}</div>
              {latest ? <>
                <div className="checks-character-label">{latest.characterName} · {latest.checkLabel}</div>
                <div className="checks-total">{latest.total}</div><div className="checks-total-label">FINAL TOTAL</div>
                <div className="checks-dice" aria-label="Natural d20 results">{latest.diceResults.map((value, index) => {
                  const kept = latest.keptIndices.includes(index)
                  return <div className={`checks-die${kept ? ' kept' : ' set-aside'}`} key={`${index}-${value}`}><span>Natural d20</span><strong>{value}</strong>{latest.mode !== 'normal' && <small>{kept ? 'KEPT' : 'SET ASIDE'}</small>}</div>
                })}</div>
                <p className="checks-breakdown">{latest.breakdown}</p>
                {latest.dc !== undefined && <div className={`checks-outcome ${latest.outcome}`}>DC {latest.dc} · {latest.outcome === 'success' ? 'Meets or exceeds the DC' : 'Below the DC'}</div>}
              </> : <div className="checks-result-placeholder"><span aria-hidden="true">✧</span><h2>Awaiting the roll</h2><p>The natural d20 and final modifier breakdown will appear here.</p></div>}
            </section>

            <section className="checks-history-panel" aria-labelledby="checks-history-heading">
              <div className="checks-history-heading"><div><div className="eyebrow small"><span className="eyebrow-line" />RECENT FATE</div><h2 id="checks-history-heading">Check History</h2></div><button type="button" className="checks-clear-button" onClick={() => setHistory([])} disabled={!history.length}>Clear history</button></div>
              {history.length ? <ol className="checks-history-list">{history.map((entry) => <li className="checks-history-entry" key={entry.id}>
                <div className="checks-history-top"><strong>{entry.characterName}</strong><span>{entry.kind === 'skill' ? 'Skill' : 'Saving throw'} · {entry.checkLabel}</span><b>{entry.total}</b></div>
                <span className="checks-history-meta">{entry.mode} · d20 {entry.diceResults.join(' / ')}{entry.diceResults.length > 1 ? ` (kept ${entry.keptResult})` : ''}{entry.dc !== undefined ? ` · DC ${entry.dc} ${entry.outcome}` : ''}</span>
                <span className="checks-history-breakdown">{entry.breakdown}</span>
              </li>)}</ol> : <p className="checks-history-empty">Your latest 20 checks remain in this browser session.</p>}
            </section>
          </div>
        </div>
      )}
    </section>
  )
}
