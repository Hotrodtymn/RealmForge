import { summarizePreview } from './launchCampaignFlow.mjs'

type Preview = {
  campaign: { title: string; premise: string; setting: string }
  locations: { key: string; name: string; kind: string; description: string; isStartingLocation: boolean }[]
  npcs: { key: string; name: string; role: string; personality: string; motivation: string }[]
  mainQuest: { title: string; description: string; objectives: { key: string; description: string }[] }
  mysteryOrThreat: string
  openingScene: { title: string; description: string }
  possibleResolution: string
}

export default function LaunchWorldPreview({ preview, saved, previewToken, saving, onSave }: {
  preview: Preview
  saved: boolean
  previewToken: string
  saving: boolean
  onSave: () => void
}) {
  const summary = summarizePreview(preview)
  if (!summary) return null
  return <section className="launch-preview" aria-labelledby="preview-heading"><div className="launch-section-title"><div><span className="launch-kicker">STEP 02 · PREVIEW</span><h2 id="preview-heading">{preview.campaign.title}</h2></div><span className="launch-preview-badge">{saved ? 'Saved campaign' : 'Not saved yet'}</span></div>
    <div className="launch-preview-intro"><article><span>PREMISE</span><p>{preview.campaign.premise}</p></article><article><span>SETTING</span><p>{preview.campaign.setting}</p></article></div>
    <div className="launch-preview-grid">
      <article className="launch-preview-block"><h3>Places in this world</h3>{summary.startingLocation && <div className="launch-location start"><strong>{summary.startingLocation.name} <small>STARTING LOCATION</small></strong><span>{summary.startingLocation.kind}</span><p>{summary.startingLocation.description}</p></div>}{summary.otherLocations.map((place) => <div className="launch-location" key={place.key}><strong>{place.name}</strong><span>{place.kind}</span><p>{place.description}</p></div>)}</article>
      <article className="launch-preview-block"><h3>People you may meet</h3>{summary.npcs.map((npc) => <div className="launch-npc" key={npc.key}><strong>{npc.name}</strong><span>{npc.role}</span><p>{npc.personality}</p><small>Wants: {npc.motivation}</small></div>)}</article>
      <article className="launch-preview-block"><h3>{preview.mainQuest.title}</h3><p>{preview.mainQuest.description}</p><ol className="launch-objectives">{summary.objectives.map((objective) => <li key={objective.key}>{objective.description}</li>)}</ol></article>
      <article className="launch-preview-block"><h3>Central mystery or threat</h3><p>{preview.mysteryOrThreat}</p><h3>Possible resolution</h3><p>{preview.possibleResolution}</p></article>
      <article className="launch-preview-block opening-scene"><span className="launch-kicker">OPENING SCENE</span><h3>{preview.openingScene.title}</h3><p>{preview.openingScene.description}</p></article>
    </div>
    {!saved && <div className="launch-save-row"><p>Review the complete generated world above. Saving creates the campaign and adventure in your local RealmForge database.</p><button type="button" className="launch-primary" onClick={onSave} disabled={!previewToken || saving}>{saving ? 'Saving world…' : 'Save campaign'} <span>↗</span></button></div>}
  </section>
}
