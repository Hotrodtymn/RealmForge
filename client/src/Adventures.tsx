import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import AdventureSessions from './AdventureSessions'
import WorldExpansionPanel from './WorldExpansionPanel'
import './Adventures.css'

interface Campaign { id: string; name: string; setting: string }
interface Adventure { id: string; campaignId: string; title: string; description: string; status: 'draft'|'active'|'completed'|'archived'; startingLocation: string; createdAt: string; updatedAt: string }
interface Location { id: string; name: string; description: string; locationType: string; dmNotes: string; connections: string | {id:string;name:string}[] }
interface Npc { id: string; name: string; description: string; personality: string; disposition: string; currentLocationId: string|null; currentLocationName?: string; dmNotes: string }
interface Objective { id: string; description: string; completed: number; sortOrder: number }
interface Quest { id: string; title: string; description: string; status: 'available'|'active'|'completed'|'failed'; objectives: Objective[] }
interface StoryFlag { name: string; value: unknown }
interface StoryNote { id: string; content: string; createdAt: string }
interface AdventureData { adventure?: Adventure; adventures?: Adventure[]; locations?: Location[]; npcs?: Npc[]; quests?: Quest[]; storyFlags?: StoryFlag[]; storyNotes?: StoryNote[]; error?: string }
type EditorKind = 'adventure'|'location'|'npc'|'quest'|'flag'|'note'
type AdventureTab = 'overview'|'worldbuilding'|'sessions'|'journal'
type Values = Record<string,string>
const API = 'http://localhost:3001/api'
const editorFields: Record<EditorKind, {key:string;label:string;kind?:string;required?:boolean}[]> = {
  adventure:[{key:'title',label:'Title',required:true},{key:'description',label:'Description',kind:'textarea'},{key:'startingLocation',label:'Starting location'},{key:'status',label:'Status',kind:'adventure-status'}],
  location:[{key:'name',label:'Name',required:true},{key:'description',label:'Description',kind:'textarea'},{key:'locationType',label:'Location type'},{key:'dmNotes',label:'DM-only notes',kind:'textarea'}],
  npc:[{key:'name',label:'Name',required:true},{key:'description',label:'Description',kind:'textarea'},{key:'personality',label:'Personality or role',kind:'textarea'},{key:'disposition',label:'Disposition'},{key:'currentLocationId',label:'Current location',kind:'location'},{key:'dmNotes',label:'DM-only notes',kind:'textarea'}],
  quest:[{key:'title',label:'Title',required:true},{key:'description',label:'Description',kind:'textarea'},{key:'status',label:'Status',kind:'quest-status'}],
  flag:[{key:'name',label:'Flag name',required:true},{key:'value',label:'Value (JSON)',required:true}],
  note:[{key:'content',label:'Story note',kind:'textarea',required:true}],
}

async function payload<T>(response:Response):Promise<T & {error?:string;fields?:Record<string,string>}>{return await response.json() as T & {error?:string;fields?:Record<string,string>}}
function defaultValues(kind:EditorKind):Values { return kind==='adventure'?{title:'',description:'',startingLocation:'',status:'draft'}:kind==='location'?{name:'',description:'',locationType:'',dmNotes:''}:kind==='npc'?{name:'',description:'',personality:'',disposition:'',currentLocationId:'',dmNotes:''}:kind==='quest'?{title:'',description:'',status:'available'}:kind==='flag'?{name:'',value:'true'}:{content:''} }

function Adventures({campaigns}:{campaigns:Campaign[]}) {
  const [campaignId,setCampaignId]=useState('')
  const [adventures,setAdventures]=useState<Adventure[]>([])
  const [selectedId,setSelectedId]=useState('')
  const [activeTab,setActiveTab]=useState<AdventureTab>('overview')
  const tabRefs=useRef<Array<HTMLButtonElement|null>>([])
  const [data,setData]=useState<AdventureData>({})
  const [loading,setLoading]=useState(false)
  const [saving,setSaving]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [editor,setEditor]=useState<{kind:EditorKind;id?:string}|null>(null)
  const [values,setValues]=useState<Values>({})
  const [connection,setConnection]=useState({from:'',to:''})
  const [objectiveDraft,setObjectiveDraft]=useState<Record<string,string>>({})

  const loadList=useCallback(async(id:string,keepSelected=true)=>{
    if(!id){setAdventures([]);setSelectedId('');setData({});return}
    setLoading(true);setError('')
    try {const res=await fetch(`${API}/campaigns/${id}/adventures`);const result=await payload<{adventures?:Adventure[]}>(res);if(!res.ok)throw new Error(result.error||'Could not load adventures.');const list=result.adventures??[];setAdventures(list);const next=keepSelected&&list.some((a)=>a.id===selectedId)?selectedId:(list[0]?.id??'');setSelectedId(next)}catch(e){setError(e instanceof Error?e.message:'Could not connect to the RealmForge server.')}finally{setLoading(false)}
  },[selectedId])
  const loadDetail=useCallback(async(id:string,adventureId:string)=>{
    if(!id||!adventureId){setData({});return}
    setLoading(true);setError('')
    try{const res=await fetch(`${API}/campaigns/${id}/adventures/${adventureId}`);const result=await payload<AdventureData>(res);if(!res.ok)throw new Error(result.error||'Could not load adventure details.');setData(result)}catch(e){setError(e instanceof Error?e.message:'Could not load adventure details.')}finally{setLoading(false)}
  },[])
  useEffect(()=>{if(!campaignId&&campaigns[0])setCampaignId(campaigns[0].id)},[campaignId,campaigns])
  useEffect(()=>{void loadList(campaignId,false)},[campaignId,loadList])
  useEffect(()=>{if(selectedId)void loadDetail(campaignId,selectedId);else setData({})},[campaignId,selectedId,loadDetail])

  const begin=(kind:EditorKind,record?:Record<string,unknown>)=>{const base=defaultValues(kind);if(record){for(const key of Object.keys(base))if(record[key]!==undefined&&record[key]!==null)base[key]=String(record[key]);if(kind==='flag')base.value=JSON.stringify(record.value)}setValues(base);setEditor({kind,...(record?.id?{id:String(record.id)}:{})});setError('')}
  const refresh=async(select?:string)=>{await loadList(campaignId,false);if(select)setSelectedId(select);else if(selectedId)await loadDetail(campaignId,selectedId)}
  const submit=async(event:FormEvent)=>{
    event.preventDefault();if(!campaignId)return
    setSaving(true);setError('');setNotice('')
    try{
      if(!editor) return
      const {kind,id}=editor;let path=`/campaigns/${campaignId}/adventures`;let method='POST';let body:Record<string,unknown>={...values}
      if(kind==='adventure'){if(id){path+=`/${id}`;method='PUT'}body={...values}}
      else {if(!selectedId)throw new Error('Choose an adventure first.');path+=`/${selectedId}`;if(kind==='location'){path+='/locations';if(id){path+=`/${id}`;method='PUT'}}else if(kind==='npc'){path+='/npcs';if(id){path+=`/${id}`;method='PUT'}body={...values,currentLocationId:values.currentLocationId||null}}else if(kind==='quest'){path+='/quests';if(id){path+=`/${id}`;method='PUT'}}else if(kind==='flag'){path+=`/story/flags/${encodeURIComponent(values.name)}`;method='PUT';try{body={value:JSON.parse(values.value)}}catch{throw new Error('Flag value must be valid JSON, such as true, false, or {"clue": "found"}.')}}else{path+='/story/notes';body={content:values.content}}}
      const res=await fetch(`${API}${path}`,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await payload<AdventureData>(res);if(!res.ok)throw new Error(result.error||Object.values(result.fields??{}).join(' ')||'Could not save this record.')
      setEditor(null);setNotice(kind==='adventure'?(id?'Adventure updated.':'Adventure created.'):`${kind==='flag'?'Story flag':kind==='note'?'Story note':kind[0].toUpperCase()+kind.slice(1)} saved.`)
      if(kind==='adventure'&&!id&&result.adventure){await loadList(campaignId,false);setSelectedId(result.adventure.id);setActiveTab('overview')}else await refresh()
    }catch(e){setError(e instanceof Error?e.message:'Could not save this record.')}finally{setSaving(false)}
  }
  const updateAdventureStatus=async(status:Adventure['status'])=>{const current=data.adventure;if(!current)return;try{const res=await fetch(`${API}/campaigns/${campaignId}/adventures/${current.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...current,status})});const result=await payload<{adventure?:Adventure}>(res);if(!res.ok)throw new Error(result.error||'Could not change adventure status.');setData({...data,adventure:result.adventure});setAdventures((items)=>items.map((entry)=>entry.id===current.id?result.adventure!:entry))}catch(e){setError(e instanceof Error?e.message:'Could not change status.')}}
  const createConnection=async()=>{if(!selectedId||!connection.from||!connection.to)return;try{const res=await fetch(`${API}/campaigns/${campaignId}/adventures/${selectedId}/locations/connections`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fromLocationId:connection.from,toLocationId:connection.to})});const result=await payload<{error?:string}>(res);if(!res.ok)throw new Error(result.error||'Could not connect locations.');setConnection({from:'',to:''});setNotice('Location connection added.');await refresh()}catch(e){setError(e instanceof Error?e.message:'Could not connect locations.')}}
  const addObjective=async(questId:string)=>{const description=objectiveDraft[questId]?.trim();if(!description)return;try{const res=await fetch(`${API}/campaigns/${campaignId}/adventures/${selectedId}/quests/${questId}/objectives`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({description,sortOrder:data.quests?.find((q)=>q.id===questId)?.objectives.length??0})});const result=await payload<{error?:string}>(res);if(!res.ok)throw new Error(result.error||'Could not add objective.');setObjectiveDraft({...objectiveDraft,[questId]:''});await refresh()}catch(e){setError(e instanceof Error?e.message:'Could not add objective.')}}
  const toggleObjective=async(questId:string,objective:Objective)=>{try{const res=await fetch(`${API}/campaigns/${campaignId}/adventures/${selectedId}/quests/${questId}/objectives/${objective.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({completed:!objective.completed})});const result=await payload<{error?:string}>(res);if(!res.ok)throw new Error(result.error||'Could not update objective.');await refresh()}catch(e){setError(e instanceof Error?e.message:'Could not update objective.')}}
  const selectedCampaign=campaigns.find((campaign)=>campaign.id===campaignId)
  const locationOptions=data.locations??[]
  const tabs: {id:AdventureTab;label:string;hint:string}[]=[
    {id:'overview',label:'Overview',hint:'Adventure details and status'},
    {id:'worldbuilding',label:'Worldbuilding',hint:'Places, people, quests, and story state'},
    {id:'sessions',label:'Sessions',hint:'Run sessions and record play'},
    {id:'journal',label:'Journal',hint:'Review session history and events'},
  ]
  const focusTab=(index:number)=>{
    const wrapped=(index+tabs.length)%tabs.length
    const next=tabs[wrapped]
    if(next){setActiveTab(next.id);tabRefs.current[wrapped]?.focus()}
  }
  const onTabKeyDown=(event:KeyboardEvent<HTMLButtonElement>,index:number)=>{
    if(event.key==='ArrowRight'){event.preventDefault();focusTab(index+1)}
    else if(event.key==='ArrowLeft'){event.preventDefault();focusTab(index-1)}
    else if(event.key==='Home'){event.preventDefault();focusTab(0)}
    else if(event.key==='End'){event.preventDefault();focusTab(tabs.length-1)}
  }

  return <section className="adventures-page" aria-labelledby="adventures-heading">
    <div className="eyebrow"><span className="eyebrow-line"/>STORY WORKSPACE</div>
    <div className="adventure-heading"><div><h1 id="adventures-heading">Adventures</h1><p>Build the places, people, quests, and story state behind each campaign.</p></div><button className="section-create-button" onClick={()=>begin('adventure')}>＋ <span>New adventure</span></button></div>
    <label className="adventure-campaign-select"><span>Campaign</span><select value={campaignId} onChange={(event)=>{setCampaignId(event.target.value);setSelectedId('');setActiveTab('overview')}}><option value="">Choose a campaign</option>{campaigns.map((campaign)=><option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label>
    {error&&<div className="adventure-feedback error" role="alert">{error}<button type="button" className="adventure-link-button" onClick={()=>{setError('');if(campaignId)void loadList(campaignId,false)}}>Dismiss</button></div>}{notice&&<div className="adventure-feedback success" role="status">✦ {notice}<button type="button" className="adventure-link-button" onClick={()=>setNotice('')}>Dismiss</button></div>}
    {editor&&<form className="adventure-editor" onSubmit={(event)=>void submit(event)}><div className="adventure-editor-title"><div><small>{editor.id?'EDIT':'CREATE'} {editor.kind.toUpperCase()}</small><h2>{editor.id?'Edit':'New'} {editor.kind==='npc'?'NPC':editor.kind==='flag'?'story flag':editor.kind==='note'?'story note':editor.kind}</h2></div><button type="button" className="adventure-link-button" onClick={()=>setEditor(null)}>Close</button></div><div className="adventure-form-grid">{editorFields[editor.kind].map((field)=> <label className="adventure-field" key={field.key}><span>{field.label}{field.required?' *':''}</span>{field.kind==='textarea'?<textarea required={field.required} maxLength={field.key==='content'?4000:4000} rows={3} value={values[field.key]??''} onChange={(e)=>setValues({...values,[field.key]:e.target.value})}/>:field.kind==='adventure-status'?<select value={values.status} onChange={(e)=>setValues({...values,status:e.target.value})}><option value="draft">Draft</option><option value="active">Active</option><option value="completed">Completed</option><option value="archived">Archived</option></select>:field.kind==='quest-status'?<select value={values.status} onChange={(e)=>setValues({...values,status:e.target.value})}><option value="available">Available</option><option value="active">Active</option><option value="completed">Completed</option><option value="failed">Failed</option></select>:field.kind==='location'?<select value={values.currentLocationId??''} onChange={(e)=>setValues({...values,currentLocationId:e.target.value})}><option value="">Unassigned</option>{locationOptions.map((location)=><option key={location.id} value={location.id}>{location.name}</option>)}</select>:<input required={field.required} maxLength={field.key==='value'?2048:160} value={values[field.key]??''} onChange={(e)=>setValues({...values,[field.key]:e.target.value})}/>}</label>)}</div><div className="adventure-editor-actions"><button type="button" className="cancel-button" onClick={()=>setEditor(null)} disabled={saving}>Cancel</button><button className="section-create-button" type="submit" disabled={saving}>{saving?'Saving…':'Save'}</button></div></form>}
    <div className="adventure-layout">
      <aside className="adventure-list-panel" aria-label="Adventure selection">
        <div className="adventure-list-title"><h2>Campaign tales</h2><span>{adventures.length}</span></div>
        {!campaignId?<div className="adventure-empty small">Create a campaign first to begin an adventure.</div>:loading&&!adventures.length?<div className="adventure-empty small">Loading adventures…</div>:adventures.length===0?<div className="adventure-empty small"><span>✧</span><strong>No adventures yet</strong><p>Start with a title, summary, and opening location.</p><button type="button" className="section-create-button" onClick={()=>begin('adventure')}>＋ Create adventure</button></div>:<div className="adventure-list">{adventures.map((item)=><button type="button" key={item.id} aria-current={selectedId===item.id?'true':undefined} className={`adventure-list-item${selectedId===item.id?' selected':''}`} onClick={()=>{setSelectedId(item.id);setActiveTab('overview');setEditor(null)}}><strong>{item.title}</strong><span>{item.status} · {item.startingLocation||selectedCampaign?.name}</span></button>)}</div>}
      </aside>
      {selectedId&&data.adventure?<main className="adventure-detail">
        <header className="adventure-detail-header"><div><small>{selectedCampaign?.name} · ADVENTURE</small><h2>{data.adventure.title}</h2><p>{data.adventure.description||'No summary has been written yet.'}</p></div><span className={`adventure-status-badge ${data.adventure.status}`}>{data.adventure.status}</span></header>
        <div className="adventure-tabs" role="tablist" aria-label={`${data.adventure.title} sections`}>
          {tabs.map((tab,index)=><button type="button" role="tab" id={`adventure-tab-${tab.id}`} aria-selected={activeTab===tab.id} aria-controls="adventure-content-panel" tabIndex={activeTab===tab.id?0:-1} key={tab.id} ref={(node)=>{tabRefs.current[index]=node}} onClick={()=>setActiveTab(tab.id)} onKeyDown={(event)=>onTabKeyDown(event,index)}><span>{tab.label}</span><small>{tab.hint}</small></button>)}
        </div>
        <section className="adventure-tab-panel" role="tabpanel" id="adventure-content-panel" aria-labelledby={`adventure-tab-${activeTab}`} tabIndex={0}>
          {activeTab==='overview'&&<div className="overview-grid">
            <article className="overview-card overview-summary"><small>ADVENTURE SUMMARY</small><h3>{data.adventure.title}</h3><p>{data.adventure.description||'No summary has been written yet. Add a description to establish the premise for this tale.'}</p></article>
            <article className="overview-card"><small>CAMPAIGN SETUP</small><dl><div><dt>Status</dt><dd><span className={`adventure-status-badge ${data.adventure.status}`}>{data.adventure.status}</span></dd></div><div><dt>Opening location</dt><dd>{data.adventure.startingLocation||'Not set'}</dd></div><div><dt>Campaign</dt><dd>{selectedCampaign?.name??'—'}</dd></div></dl><div className="overview-actions"><label className="adventure-field"><span>Adventure status</span><select value={data.adventure.status} onChange={(event)=>void updateAdventureStatus(event.target.value as Adventure['status'])}><option value="draft">Draft</option><option value="active">Active</option><option value="completed">Completed</option><option value="archived">Archived</option></select></label><button type="button" className="text-button" onClick={()=>begin('adventure',data.adventure as unknown as Record<string,unknown>)}>Edit adventure details</button></div></article>
          </div>}
          {activeTab==='worldbuilding'&&<div className="worldbuilding-panel">
            <WorldExpansionPanel campaignId={campaignId} adventureId={selectedId} locations={data.locations??[]} npcs={data.npcs??[]} onApproved={() => refresh()}/>
            <section className="adventure-content-section"><div className="adventure-section-title"><div><small>PLACES</small><h3>Locations</h3></div><button type="button" className="text-button" onClick={()=>begin('location')}>＋ Add location</button></div>{!data.locations?.length?<p className="adventure-empty-inline">No locations recorded. Add a place to map this adventure.</p>:<div className="adventure-record-grid">{data.locations.map((location)=><article className="adventure-record" key={location.id}><div className="record-heading"><div><strong>{location.name}</strong>{location.locationType&&<span>{location.locationType}</span>}</div><button type="button" className="adventure-link-button" onClick={()=>begin('location',location as unknown as Record<string,unknown>)}>Edit</button></div><p>{location.description||'No description.'}</p>{location.dmNotes&&<div className="dm-note"><b>DM-only notes</b><p>{location.dmNotes}</p></div>}<small>Connections: {Array.isArray(location.connections)&&location.connections.length?location.connections.map((connection)=>connection.name).join(', '):'None'}</small></article>)}</div>}{(data.locations?.length??0)>1&&<div className="connection-controls"><label><span>From</span><select aria-label="From location" value={connection.from} onChange={(e)=>setConnection({...connection,from:e.target.value})}><option value="">Choose location…</option>{data.locations?.map((l)=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label><span className="connection-arrow" aria-hidden="true">↔</span><label><span>To</span><select aria-label="To location" value={connection.to} onChange={(e)=>setConnection({...connection,to:e.target.value})}><option value="">Choose location…</option>{data.locations?.map((l)=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label><button type="button" className="text-button" disabled={!connection.from||!connection.to} onClick={()=>void createConnection()}>Connect locations</button></div>}</section>
            <section className="adventure-content-section"><div className="adventure-section-title"><div><small>CAST</small><h3>NPCs</h3></div><button type="button" className="text-button" onClick={()=>begin('npc')}>＋ Add NPC</button></div>{!data.npcs?.length?<p className="adventure-empty-inline">No NPCs yet. Add a character to the story.</p>:<div className="adventure-record-grid">{data.npcs.map((npc)=><article className="adventure-record" key={npc.id}><div className="record-heading"><div><strong>{npc.name}</strong><span>{npc.disposition||'Disposition not set'}{npc.currentLocationName?` · ${npc.currentLocationName}`:''}</span></div><button type="button" className="adventure-link-button" onClick={()=>begin('npc',npc as unknown as Record<string,unknown>)}>Edit</button></div><p>{npc.description||'No description.'}</p>{npc.personality&&<p><b>Personality / role:</b> {npc.personality}</p>}{npc.dmNotes&&<div className="dm-note"><b>DM-only notes</b><p>{npc.dmNotes}</p></div>}</article>)}</div>}</section>
            <section className="adventure-content-section"><div className="adventure-section-title"><div><small>STORY THREADS</small><h3>Quests &amp; objectives</h3></div><button type="button" className="text-button" onClick={()=>begin('quest')}>＋ Add quest</button></div>{!data.quests?.length?<p className="adventure-empty-inline">No quests yet. Add goals for the party to pursue.</p>:<div className="adventure-record-grid">{data.quests.map((quest)=><article className="adventure-record quest-record" key={quest.id}><div className="record-heading"><div><strong>{quest.title}</strong><span>{quest.status}</span></div><button type="button" className="adventure-link-button" onClick={()=>begin('quest',quest as unknown as Record<string,unknown>)}>Edit</button></div><p>{quest.description||'No description.'}</p><ul className="objective-list">{quest.objectives.map((objective)=><li key={objective.id}><label><input type="checkbox" checked={Boolean(objective.completed)} onChange={()=>void toggleObjective(quest.id,objective)}/><span className={objective.completed?'completed':''}>{objective.description}</span></label></li>)}</ul><form className="objective-add" onSubmit={(e)=>{e.preventDefault();void addObjective(quest.id)}}><input aria-label={`Add objective to ${quest.title}`} maxLength={500} placeholder="Add an objective…" value={objectiveDraft[quest.id]??''} onChange={(e)=>setObjectiveDraft({...objectiveDraft,[quest.id]:e.target.value})}/><button type="submit" className="text-button">Add objective</button></form></article>)}</div>}</section>
            <section className="adventure-content-section"><div className="adventure-section-title"><div><small>CONTINUITY</small><h3>Story state</h3></div><div className="story-actions"><button type="button" className="text-button" onClick={()=>begin('flag')}>＋ Add or update flag</button><button type="button" className="text-button" onClick={()=>begin('note')}>＋ Add note</button></div></div><div className="story-state-grid"><div><h4>Named flags</h4>{!data.storyFlags?.length?<p className="adventure-empty-inline">No story flags yet.</p>:<ul className="flag-list">{data.storyFlags.map((flag)=><li key={flag.name}><code>{flag.name}</code><span>{JSON.stringify(flag.value)}</span><button type="button" className="adventure-link-button" onClick={()=>begin('flag',flag as unknown as Record<string,unknown>)}>Edit</button></li>)}</ul>}</div><div><h4>Persistent story notes</h4>{!data.storyNotes?.length?<p className="adventure-empty-inline">No story notes yet.</p>:<ul className="story-note-list">{data.storyNotes.map((note)=><li key={note.id}><p>{note.content}</p><small>{new Date(note.createdAt).toLocaleString()}</small></li>)}</ul>}</div></div></section>
          </div>}
          {activeTab==='sessions'&&<AdventureSessions view="sessions" campaignId={campaignId} adventure={data.adventure} locations={data.locations??[]}/>}
          {activeTab==='journal'&&<AdventureSessions view="journal" campaignId={campaignId} adventure={data.adventure} locations={data.locations??[]}/>}
        </section>
      </main>:campaignId?<div className="adventure-detail adventure-empty large">{loading?'Opening adventure…':'Choose an adventure or create a new one.'}</div>:<div className="adventure-detail adventure-empty large">Create a campaign before setting up adventures.</div>}
    </div>
  </section>
}

export default Adventures
