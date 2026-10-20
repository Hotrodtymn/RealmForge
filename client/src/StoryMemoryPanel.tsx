import { useCallback, useEffect, useState } from 'react'

type Memory = { id:string;category:string;statement:string;verificationStatus:string;relatedNpcName:string|null;relatedLocationName:string|null;relatedQuestTitle:string|null;sourceTurnCreatedAt:string;evidenceQuote:string;status:string;history:Array<{eventType:string;createdAt:string;reason:string}> }
type ExtractionIssue = { sourceTurnId:string;status:'queued'|'running'|'failed';attempts:number;diagnostic:string;updatedAt:string;sourceTurnCreatedAt:string;action:string }
const API='http://localhost:3001/api'
async function read<T>(response:Response):Promise<T&{error?:string}>{return await response.json() as T&{error?:string}}

export default function StoryMemoryPanel({campaignId,adventureId,sessionId,characterId}:{campaignId:string;adventureId:string;sessionId:string;characterId:string}){
  const [memories,setMemories]=useState<Memory[]>([])
  const [issues,setIssues]=useState<ExtractionIssue[]>([])
  const [loading,setLoading]=useState(true)
  const [busyId,setBusyId]=useState('')
  const [error,setError]=useState('')
  const load=useCallback(async()=>{
    setLoading(true);setError('');setMemories([]);setIssues([])
    try{const response=await fetch(`${API}/ai/session/${sessionId}/memories?characterId=${encodeURIComponent(characterId)}`);const result=await read<{memories?:Memory[];extractionIssues?:ExtractionIssue[]}>(response);if(!response.ok)throw new Error(result.error||'Could not load story memory.');setMemories(result.memories??[]);setIssues(result.extractionIssues??[])}catch(cause){setError(cause instanceof Error?cause.message:'Could not load story memory.')}finally{setLoading(false)}
  },[sessionId,characterId])
  useEffect(()=>{void load()},[load,campaignId,adventureId])
  const retry=async(turnId:string)=>{
    setBusyId(turnId);setError('')
    try{const response=await fetch(`${API}/ai/session/${sessionId}/memories/${turnId}/retry?characterId=${encodeURIComponent(characterId)}`,{method:'POST'});const result=await read<{error?:string}>(response);if(!response.ok)throw new Error(result.error||'Could not retry story memory extraction.');await load()}
    catch(cause){setError(cause instanceof Error?cause.message:'Could not retry story memory extraction.')}
    finally{setBusyId('')}
  }
  const title=(value:string)=>value.replaceAll('_',' ')
  return <section className="story-memory-panel" aria-labelledby="story-memory-heading">
    <header className="story-memory-heading"><div><small>PRIVATE CONTINUITY NOTES · DM VIEW</small><h5 id="story-memory-heading">Story Memory</h5><p>AI-extracted narrative reminders. These are not authoritative campaign facts.</p></div><button type="button" className="text-button" onClick={()=>void load()} disabled={loading}>{loading?'Refreshing…':'Refresh'}</button></header>
    {error&&<p className="story-memory-error" role="alert">{error}</p>}
    {loading&&!memories.length?<p className="adventure-empty-inline" role="status">Loading story memory…</p>:memories.length===0?<p className="adventure-empty-inline">No story memories have been retained for this session yet.</p>:<ol className="story-memory-list">{memories.map((memory)=><li key={memory.id} className={`story-memory-entry ${memory.status}`}><div className="story-memory-entry-heading"><strong>{memory.statement}</strong><span className={`story-memory-status ${memory.status}`}>{title(memory.status)}</span></div><div className="story-memory-meta"><span>{title(memory.category)}</span><span>{title(memory.verificationStatus)}</span>{memory.relatedNpcName&&<span>NPC: {memory.relatedNpcName}</span>}{memory.relatedLocationName&&<span>Location: {memory.relatedLocationName}</span>}{memory.relatedQuestTitle&&<span>Quest: {memory.relatedQuestTitle}</span>}</div><blockquote>{memory.evidenceQuote}</blockquote><small>Source turn · {new Date(memory.sourceTurnCreatedAt).toLocaleString()}</small>{memory.history.length>1&&<details><summary>Memory history ({memory.history.length} events)</summary><ol>{memory.history.map((event,index)=><li key={`${event.eventType}-${event.createdAt}-${index}`}><span>{title(event.eventType)}</span> · {new Date(event.createdAt).toLocaleString()}{event.reason&&<p>{event.reason}</p>}</li>)}</ol></details>}</li>)}</ol>}
    {issues.length>0&&<div className="story-memory-recovery"><div><small>EXTRACTION RECOVERY</small><h6>Incomplete memory extraction</h6></div>{issues.map((issue)=><div className="story-memory-issue" key={issue.sourceTurnId}><p>{issue.status==='failed'?issue.diagnostic:issue.status==='running'?'An extraction is currently running.':'A completed turn is awaiting extraction.'}</p><small>{new Date(issue.sourceTurnCreatedAt).toLocaleString()} · attempt {issue.attempts}</small><button type="button" className="text-button" disabled={Boolean(busyId)||loading} onClick={()=>void retry(issue.sourceTurnId)}>{busyId===issue.sourceTurnId?'Retrying…':'Retry extraction'}</button></div>)}</div>}
  </section>
}
