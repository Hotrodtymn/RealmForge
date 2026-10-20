import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { eligibleLaunchCharacters, launchSessionRequest, postOpeningSession, requestWorldPreview, saveWorldPreview } from './launchCampaignFlow.mjs'
import LaunchWorldPreview from './LaunchWorldPreview'
import './LaunchCampaign.css'

type Campaign = { id: string; name: string; description: string; setting: string; createdAt: string }
type Character = { id: string; name: string; species: string; characterClass: string; level: number; status: string; playerId: string; playerName: string }
type Player = { id: string; playerId: string; displayName: string; characters?: Character[] }
type Preview = {
  campaign: { title: string; premise: string; setting: string }
  locations: { key: string; name: string; kind: string; description: string; isStartingLocation: boolean }[]
  npcs: { key: string; name: string; role: string; personality: string; motivation: string }[]
  mainQuest: { title: string; description: string; objectives: { key: string; description: string }[] }
  mysteryOrThreat: string
  openingScene: { title: string; description: string }
  possibleResolution: string
}
type OpeningScene = { id: string; locationId: string | null; locationName: string | null; title: string; description: string }
type Saved = { campaign: Campaign; adventure: { id: string; title: string }; referenceMap?: { openingScene?: string } }
type Payload = { error?: string; preview?: Preview; previewToken?: string; saved?: Saved; campaign?: Campaign; adventure?: Saved['adventure']; session?: { id: string }; fields?: Record<string, string> }
const API = 'http://localhost:3001/api'
const jsonHeaders = { 'Content-Type': 'application/json' }
async function read<T>(response: Response): Promise<T & Payload> { return await response.json() as T & Payload }

export default function LaunchCampaign({ onManualCampaign, onEnterAdventure, onCampaignSaved }: {
  onManualCampaign: () => void
  onEnterAdventure: (selection: { campaignId: string; adventureId: string; sessionId: string }) => void
  onCampaignSaved: (campaign: Campaign) => void
}) {
  const [mode, setMode] = useState<'ai' | 'human' | 'assisted'>('ai')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewToken, setPreviewToken] = useState('')
  const [generationBusy, setGenerationBusy] = useState(false)
  const [saveBusy, setSaveBusy] = useState(false)
  const [sessionBusy, setSessionBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saved, setSaved] = useState<Saved | null>(null)
  const [openingScene, setOpeningScene] = useState<OpeningScene | null>(null)
  const [players, setPlayers] = useState<Player[]>([])
  const [charactersLoading, setCharactersLoading] = useState(false)
  const [selectedCharacterId, setSelectedCharacterId] = useState('')
  const [playerName, setPlayerName] = useState('')
  const [characterForm, setCharacterForm] = useState({ name: '', species: '', characterClass: '' })
  const [rosterBusy, setRosterBusy] = useState(false)
  const [session, setSession] = useState<{ id: string } | null>(null)
  const requestController = useRef<AbortController | null>(null)
  const sessionRequestId = useRef('')
  const characters = useMemo(() => eligibleLaunchCharacters(players), [players])

  useEffect(() => () => { requestController.current?.abort() }, [])

  const loadSavedWorld = async (campaignId: string, adventureId: string, openingId?: string) => {
    const response = await fetch(`${API}/campaigns/${campaignId}/adventures/${adventureId}`)
    const result = await read<{ openingScenes?: OpeningScene[] }>(response)
    if (!response.ok) throw new Error(result.error || 'The campaign was saved, but its opening scene could not be loaded. Retry this step.')
    const scene = result.openingScenes?.find((entry) => entry.id === openingId) ?? result.openingScenes?.[0]
    if (!scene) throw new Error('The saved adventure has no opening scene template. The campaign is safe; review it in Adventures.')
    setOpeningScene(scene)
  }

  const loadRoster = async (campaignId: string) => {
    setCharactersLoading(true)
    try {
      const response = await fetch(`${API}/campaigns/${campaignId}/players`)
      const result = await read<{ players?: Player[] }>(response)
      if (!response.ok) throw new Error(result.error || 'Could not load campaign players.')
      const roster = await Promise.all((result.players ?? []).map(async (player) => {
        const characterResponse = await fetch(`${API}/campaigns/${campaignId}/players/${player.playerId}/characters`)
        const characterResult = await read<{ characters?: Character[] }>(characterResponse)
        if (!characterResponse.ok) throw new Error(characterResult.error || 'Could not load campaign characters.')
        return { ...player, characters: characterResult.characters ?? [] }
      }))
      setPlayers(roster)
      const eligible = eligibleLaunchCharacters(roster)
      setSelectedCharacterId((current) => eligible.some((character) => character.id === current) ? current : eligible.find((character) => character.status === 'active')?.id ?? eligible[0]?.id ?? '')
    } finally { setCharactersLoading(false) }
  }

  const generate = async () => {
    setError(''); setNotice(''); setPreview(null); setPreviewToken(''); setSaved(null); setOpeningScene(null); setSession(null); sessionRequestId.current = ''
    const controller = new AbortController()
    requestController.current = controller
    const timeout = window.setTimeout(() => controller.abort(new DOMException('Generation timed out after six minutes.', 'TimeoutError')), 360_000)
    setGenerationBusy(true)
    try {
      const result = await requestWorldPreview(fetch, `${API}/ai/world/preview`, controller.signal)
      setPreview(result.preview as Preview); setPreviewToken(result.previewToken)
      setNotice('Your preview is ready. Review it before saving.')
    } catch (cause) {
      const timedOut = controller.signal.aborted && (controller.signal.reason as Error | undefined)?.name === 'TimeoutError'
      setError(timedOut ? 'World generation took longer than six minutes. No campaign was saved. Try again when Ollama is ready.' : cause instanceof Error && cause.name === 'AbortError' ? 'World generation was cancelled. No campaign was saved.' : cause instanceof Error ? cause.message : 'Could not generate a world preview.')
    } finally { window.clearTimeout(timeout); if (requestController.current === controller) requestController.current = null; setGenerationBusy(false) }
  }
  const cancelGeneration = () => requestController.current?.abort()

  const saveWorld = async () => {
    if (!previewToken || saveBusy) return
    setError(''); setNotice(''); setSaveBusy(true)
    try {
      const result = await saveWorldPreview(fetch, `${API}/ai/world/save`, previewToken)
      const next = { campaign: result.campaign as Campaign, adventure: result.adventure, referenceMap: result.referenceMap }
      setSaved(next); onCampaignSaved(next.campaign); setNotice(result.status === 200 ? 'The saved campaign was recovered from the previous save request.' : 'Campaign and adventure saved.')
      await Promise.all([loadSavedWorld(next.campaign.id, next.adventure.id, result.referenceMap?.openingScene), loadRoster(next.campaign.id)])
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save the generated campaign.') }
    finally { setSaveBusy(false) }
  }

  const addPlayerAndCharacter = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!saved || rosterBusy) return
    setRosterBusy(true); setError(''); setNotice('')
    try {
      let player = players.find((entry) => entry.displayName.trim().toLowerCase() === playerName.trim().toLowerCase())
      if (!player) {
        const playerResponse = await fetch(`${API}/campaigns/${saved.campaign.id}/players`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ displayName: playerName }) })
        const playerResult = await read<{ player?: Player }>(playerResponse)
        if (!playerResponse.ok || !playerResult.player) throw new Error(playerResult.error || 'Could not add a local player.')
        player = { ...playerResult.player, characters: [] }
        setPlayers((rows) => rows.some((entry) => entry.playerId === player!.playerId) ? rows : [...rows, player!])
      }
      const characterResponse = await fetch(`${API}/campaigns/${saved.campaign.id}/players/${player.playerId}/characters`, {
        method: 'POST', headers: jsonHeaders,
        body: JSON.stringify({ name: characterForm.name, species: characterForm.species, class: characterForm.characterClass, level: 1, status: 'prepared', abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } }),
      })
      const characterResult = await read<{ character?: Character }>(characterResponse)
      if (!characterResponse.ok || !characterResult.character) throw new Error(characterResult.error || Object.values(characterResult.fields ?? {}).join(' ') || 'Could not create the character.')
      setPlayerName(''); setCharacterForm({ name: '', species: '', characterClass: '' }); setNotice(`${characterResult.character.name} was added to this campaign.`)
      await loadRoster(saved.campaign.id)
      setSelectedCharacterId(characterResult.character.id)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not add the player and character.') }
    finally { setRosterBusy(false) }
  }

  const startSession = async () => {
    if (!saved || !openingScene || !selectedCharacterId || sessionBusy) return
    if (!window.confirm(`Start ${saved.adventure.title} with ${characters.find((character) => character.id === selectedCharacterId)?.name ?? 'this character'} at ${openingScene.locationName ?? 'the opening location'}?`)) return
    setError(''); setNotice(''); setSessionBusy(true)
    if (!sessionRequestId.current) sessionRequestId.current = crypto.randomUUID()
    try {
      const body = launchSessionRequest(selectedCharacterId, openingScene, sessionRequestId.current)
      const result = await postOpeningSession(fetch, `${API}/campaigns/${saved.campaign.id}/adventures/${saved.adventure.id}/sessions`, body)
      setSession(result.session); setNotice('Opening session started. Enter when you are ready.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The campaign is saved. Could not start a session.') }
    finally { setSessionBusy(false) }
  }

  return <section className="launch-workspace" aria-labelledby="launch-heading">
    <div className="launch-heading-row"><div><div className="eyebrow"><span className="eyebrow-line" />A NEW CHRONICLE</div><h1 id="launch-heading">Launch Campaign</h1><p>Shape a short adventure, review its world, then begin with a character on its campaign roster.</p></div><button type="button" className="launch-manual-link" onClick={onManualCampaign}>Create manually</button></div>
    <ol className="launch-steps" aria-label="Launch campaign steps"><li className="current">Configure</li><li className={preview ? 'complete' : ''}>Generate</li><li className={preview ? 'complete' : ''}>Preview</li><li className={saved ? 'complete' : ''}>Save</li><li className={session ? 'complete' : ''}>Start session</li><li className={session ? 'complete' : ''}>Enter adventure</li></ol>
    {error && <div className="launch-message error" role="alert">{error}<button type="button" className="launch-retry" onClick={() => { setError(''); if (saved) void Promise.all([loadSavedWorld(saved.campaign.id, saved.adventure.id, saved.referenceMap?.openingScene), loadRoster(saved.campaign.id)]).catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not reload campaign data.')) }}>Retry</button></div>}
    {notice && <div className="launch-message success" role="status">{notice}</div>}

    {!saved && <section className="launch-card" aria-labelledby="launch-config-heading"><div className="launch-card-heading"><span className="launch-step-number">01</span><div><h2 id="launch-config-heading">Choose your Dungeon Master</h2><p>Only supported generation options are enabled.</p></div></div>
      <div className="launch-mode-options" role="group" aria-label="Dungeon Master mode">
        <button type="button" className={`launch-mode-card${mode === 'ai' ? ' selected' : ''}`} aria-pressed={mode === 'ai'} onClick={() => setMode('ai')}><strong>AI Dungeon Master</strong><span>Generate a short dark-fantasy world locally with Ollama.</span><i>Available</i></button>
        <button type="button" className="launch-mode-card" onClick={onManualCampaign}><strong>Human Dungeon Master</strong><span>Use the existing campaign and adventure editor.</span><i>Open manual workflow</i></button>
        <button type="button" className="launch-mode-card disabled" disabled aria-disabled="true"><strong>Human DM with AI assistance</strong><span>AI-supported human sessions are planned for a later stage.</span><i>Coming later</i></button>
      </div>
      <div className="launch-supported-options"><div><span>Theme</span><strong>Dark fantasy</strong></div><div><span>World creation</span><strong>Surprise me · AI generates everything</strong></div><div><span>Length</span><strong>Short adventure</strong></div></div>
      <div className="launch-card-actions"><p>Generation runs on your local Ollama service and may take several minutes. No campaign is saved until you choose Save.</p><button type="button" className="launch-primary" onClick={() => void generate()} disabled={generationBusy}>{generationBusy ? 'Generating preview…' : preview ? 'Generate another preview' : 'Generate world preview'} <span>✦</span></button>{generationBusy && <button type="button" className="launch-secondary" onClick={cancelGeneration}>Cancel request</button>}</div>
    </section>}

    {preview && <LaunchWorldPreview preview={preview} saved={Boolean(saved)} previewToken={previewToken} saving={saveBusy} onSave={() => void saveWorld()} />}

    {saved && <section className="launch-card launch-saved" aria-labelledby="saved-heading"><div className="launch-card-heading"><span className="launch-step-number">03</span><div><h2 id="saved-heading">{saved.campaign.name} is saved</h2><p>Campaign ID <code>{saved.campaign.id}</code> · Adventure ID <code>{saved.adventure.id}</code></p></div></div>
      {!session && <>
        {charactersLoading ? <div className="launch-inline-status" role="status">Loading this campaign’s roster…</div> : <>
          <div className="launch-character-pick"><label htmlFor="launch-character">Choose a character in this campaign</label><select id="launch-character" value={selectedCharacterId} onChange={(event) => { setSelectedCharacterId(event.target.value); sessionRequestId.current = '' }}><option value="">Select an active or prepared character</option>{characters.map((character) => <option key={character.id} value={character.id}>{character.name} · {character.playerName} · {character.status}</option>)}</select><p>Characters from other campaigns are not transferable here. Add a local player and character below if this roster is empty.</p></div>
          {characters.length === 0 && <form className="launch-new-character" onSubmit={(event) => void addPlayerAndCharacter(event)}><div><span className="launch-kicker">NEW CAMPAIGN ROSTER</span><h3>Add a player and character</h3><p>This creates a local player membership and a level 1 prepared character in this campaign only.</p></div><label><span>Player display name</span><input required maxLength={80} value={playerName} onChange={(event) => setPlayerName(event.target.value)} /></label><label><span>Character name</span><input required maxLength={80} value={characterForm.name} onChange={(event) => setCharacterForm({ ...characterForm, name: event.target.value })} /></label><div className="launch-character-fields"><label><span>Species</span><input required maxLength={60} value={characterForm.species} onChange={(event) => setCharacterForm({ ...characterForm, species: event.target.value })} /></label><label><span>Class</span><input required maxLength={60} value={characterForm.characterClass} onChange={(event) => setCharacterForm({ ...characterForm, characterClass: event.target.value })} /></label></div><button type="submit" className="launch-secondary" disabled={rosterBusy}>{rosterBusy ? 'Adding…' : 'Add player and character'}</button></form>}
          {characters.length > 0 && <form className="launch-new-character compact" onSubmit={(event) => void addPlayerAndCharacter(event)}><h3>Add another character to this roster</h3><div className="launch-character-fields"><label><span>Existing or new player display name</span><input required maxLength={80} value={playerName} onChange={(event) => setPlayerName(event.target.value)} /></label><label><span>Character name</span><input required maxLength={80} value={characterForm.name} onChange={(event) => setCharacterForm({ ...characterForm, name: event.target.value })} /></label><label><span>Species</span><input required maxLength={60} value={characterForm.species} onChange={(event) => setCharacterForm({ ...characterForm, species: event.target.value })} /></label><label><span>Class</span><input required maxLength={60} value={characterForm.characterClass} onChange={(event) => setCharacterForm({ ...characterForm, characterClass: event.target.value })} /></label></div><button type="submit" className="launch-secondary" disabled={rosterBusy}>{rosterBusy ? 'Adding…' : 'Add player and character'}</button></form>}
          <div className="launch-start-row">{openingScene && <p>Opening: <strong>{openingScene.title}</strong>{openingScene.locationName && <> · {openingScene.locationName}</>}</p>}<button type="button" className="launch-primary" disabled={!openingScene || !selectedCharacterId || sessionBusy} onClick={() => void startSession()}>{sessionBusy ? 'Starting session…' : 'Start opening session'} <span>➤</span></button></div>
        </>}
      </>}
      {session && <div className="launch-enter-row" role="status"><div><span className="launch-kicker">SESSION READY</span><h3>Begin {saved.adventure.title}</h3><p>Session ID <code>{session.id}</code></p></div><button type="button" className="launch-primary" onClick={() => onEnterAdventure({ campaignId: saved.campaign.id, adventureId: saved.adventure.id, sessionId: session.id })}>Enter Adventure <span>↗</span></button></div>}
    </section>}
  </section>
}
