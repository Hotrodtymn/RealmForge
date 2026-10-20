import express = require('express')
import adventureStore = require('./adventureStore')
import HttpError = require('./httpError')

const router = express.Router()
const adventureStatuses = ['draft','active','completed','archived']
const questStatuses = ['available','active','completed','failed']
function bodyObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Expected a JSON object.')
  return body as Record<string, unknown>
}
function text(body: Record<string, unknown>, key: string, max: number, required = false): string {
  const value = body[key]
  if (value === undefined && !required) return ''
  if (typeof value !== 'string') throw new HttpError(400, 'Validation failed.', { [key]: 'Must be text.' })
  const valueTrimmed = value.trim()
  if (required && !valueTrimmed) throw new HttpError(400, 'Validation failed.', { [key]: 'This field is required.' })
  if (valueTrimmed.length > max) throw new HttpError(400, 'Validation failed.', { [key]: `Must be ${max} characters or fewer.` })
  return valueTrimmed
}
function enumValue(body: Record<string, unknown>, key: string, values: string[], fallback: string): string {
  const value = body[key] === undefined ? fallback : body[key]
  if (typeof value !== 'string' || !values.includes(value)) throw new HttpError(400, 'Validation failed.', { [key]: `Choose one of: ${values.join(', ')}.` })
  return value
}
function adventure(campaignId: string, adventureId: string) { adventureStore.getAdventure(campaignId, adventureId) }
function safeStoryValue(value: unknown, depth = 0): boolean {
  if (depth > 4) return false
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return typeof value !== 'string' || value.length <= 500
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.length <= 20 && value.every((entry) => safeStoryValue(entry, depth + 1))
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
    return entries.length <= 20 && entries.every(([key, entry]) => key.length <= 80 && key !== '__proto__' && safeStoryValue(entry, depth + 1))
  }
  return false
}

router.get('/:campaignId/adventures', (req,res,next)=>{ try { res.json({adventures: adventureStore.listAdventures(req.params.campaignId)}) } catch(e){next(e)} })
router.post('/:campaignId/adventures', (req,res,next)=>{ try { const b=bodyObject(req.body); const result=adventureStore.createAdventure(req.params.campaignId,{title:text(b,'title',160,true),description:text(b,'description',4000),status:enumValue(b,'status',adventureStatuses,'draft'),startingLocation:text(b,'startingLocation',160)}); res.status(201).json({adventure:result}) } catch(e){next(e)} })
router.get('/:campaignId/adventures/:adventureId', (req,res,next)=>{ try { adventure(req.params.campaignId,req.params.adventureId); res.json({adventure:adventureStore.getAdventure(req.params.campaignId,req.params.adventureId),...adventureStore.getAdventureData(req.params.campaignId,req.params.adventureId)}) } catch(e){next(e)} })
router.put('/:campaignId/adventures/:adventureId', (req,res,next)=>{ try { const b=bodyObject(req.body); const result=adventureStore.updateAdventure(req.params.campaignId,req.params.adventureId,{title:text(b,'title',160,true),description:text(b,'description',4000),status:enumValue(b,'status',adventureStatuses,'draft'),startingLocation:text(b,'startingLocation',160)}); res.json({adventure:result}) } catch(e){next(e)} })

router.get('/:campaignId/adventures/:adventureId/locations',(req,res,next)=>{try{adventure(req.params.campaignId,req.params.adventureId);res.json({locations:adventureStore.listLocations(req.params.adventureId)})}catch(e){next(e)}})
router.get('/:campaignId/adventures/:adventureId/player-view',(req,res,next)=>{try{res.json(adventureStore.playerView(req.params.campaignId,req.params.adventureId))}catch(e){next(e)}})
router.get('/:campaignId/adventures/:adventureId/locations/:locationId',(req,res,next)=>{try{adventure(req.params.campaignId,req.params.adventureId);res.json({location:adventureStore.getLocation(req.params.adventureId,req.params.locationId)})}catch(e){next(e)}})
router.post('/:campaignId/adventures/:adventureId/locations',(req,res,next)=>{try{adventure(req.params.campaignId,req.params.adventureId);const b=bodyObject(req.body);const result=adventureStore.createLocation(req.params.adventureId,{name:text(b,'name',120,true),description:text(b,'description',4000),locationType:text(b,'locationType',80),dmNotes:text(b,'dmNotes',4000)});res.status(201).json({location:result})}catch(e){next(e)}})
router.put('/:campaignId/adventures/:adventureId/locations/:locationId',(req,res,next)=>{try{adventure(req.params.campaignId,req.params.adventureId);const b=bodyObject(req.body);const result=adventureStore.updateLocation(req.params.adventureId,req.params.locationId,{name:text(b,'name',120,true),description:text(b,'description',4000),locationType:text(b,'locationType',80),dmNotes:text(b,'dmNotes',4000)});res.json({location:result})}catch(e){next(e)}})
router.post('/:campaignId/adventures/:adventureId/locations/connections',(req,res,next)=>{try{adventure(req.params.campaignId,req.params.adventureId);const b=bodyObject(req.body);const from=text(b,'fromLocationId',64,true),to=text(b,'toLocationId',64,true);res.status(201).json({locations:adventureStore.connectLocations(req.params.adventureId,from,to)})}catch(e){next(e)}})

router.get('/:campaignId/adventures/:adventureId/npcs',(req,res,next)=>{try{adventure(req.params.campaignId,req.params.adventureId);res.json({npcs:adventureStore.listNpcs(req.params.adventureId)})}catch(e){next(e)}})
router.get('/:campaignId/adventures/:adventureId/npcs/:npcId',(req,res,next)=>{try{adventure(req.params.campaignId,req.params.adventureId);res.json({npc:adventureStore.getNpc(req.params.adventureId,req.params.npcId)})}catch(e){next(e)}})
router.post('/:campaignId/adventures/:adventureId/npcs',(req,res,next)=>{try{adventure(req.params.campaignId,req.params.adventureId);const b=bodyObject(req.body);const location=b.currentLocationId===undefined||b.currentLocationId===null||b.currentLocationId===''?null:text(b,'currentLocationId',64,true);const result=adventureStore.saveNpc(req.params.adventureId,null,{name:text(b,'name',120,true),description:text(b,'description',4000),personality:text(b,'personality',500),disposition:text(b,'disposition',120),currentLocationId:location,dmNotes:text(b,'dmNotes',4000)});res.status(201).json({npc:result})}catch(e){next(e)}})
router.put('/:campaignId/adventures/:adventureId/npcs/:npcId',(req,res,next)=>{try{adventure(req.params.campaignId,req.params.adventureId);const b=bodyObject(req.body);const location=b.currentLocationId===undefined||b.currentLocationId===null||b.currentLocationId===''?null:text(b,'currentLocationId',64,true);const result=adventureStore.saveNpc(req.params.adventureId,req.params.npcId,{name:text(b,'name',120,true),description:text(b,'description',4000),personality:text(b,'personality',500),disposition:text(b,'disposition',120),currentLocationId:location,dmNotes:text(b,'dmNotes',4000)});res.json({npc:result})}catch(e){next(e)}})

router.get('/:campaignId/adventures/:adventureId/quests',(req,res,next)=>{try{adventure(req.params.campaignId,req.params.adventureId);res.json({quests:adventureStore.listQuests(req.params.adventureId)})}catch(e){next(e)}})
router.post('/:campaignId/adventures/:adventureId/quests',(req,res,next)=>{try{adventure(req.params.campaignId,req.params.adventureId);const b=bodyObject(req.body);const result=adventureStore.saveQuest(req.params.adventureId,null,{title:text(b,'title',160,true),description:text(b,'description',4000),status:enumValue(b,'status',questStatuses,'available')});res.status(201).json({quest:result})}catch(e){next(e)}})
router.put('/:campaignId/adventures/:adventureId/quests/:questId',(req,res,next)=>{try{adventure(req.params.campaignId,req.params.adventureId);const b=bodyObject(req.body);const result=adventureStore.saveQuest(req.params.adventureId,req.params.questId,{title:text(b,'title',160,true),description:text(b,'description',4000),status:enumValue(b,'status',questStatuses,'available')});res.json({quest:result})}catch(e){next(e)}})
router.post('/:campaignId/adventures/:adventureId/quests/:questId/objectives',(req,res,next)=>{try{adventure(req.params.campaignId,req.params.adventureId);const b=bodyObject(req.body);const sortOrder=b.sortOrder===undefined?0:b.sortOrder;if(typeof sortOrder!=='number'||!Number.isInteger(sortOrder)||sortOrder<0||sortOrder>10000)throw new HttpError(400,'Validation failed.',{sortOrder:'Must be a nonnegative integer.'});res.status(201).json({objective:adventureStore.addObjective(req.params.adventureId,req.params.questId,text(b,'description',500,true),sortOrder)})}catch(e){next(e)}})
router.put('/:campaignId/adventures/:adventureId/quests/:questId/objectives/:objectiveId',(req,res,next)=>{try{adventure(req.params.campaignId,req.params.adventureId);const b=bodyObject(req.body);if(typeof b.completed!=='boolean')throw new HttpError(400,'Validation failed.',{completed:'Must be true or false.'});res.json({objective:adventureStore.setObjective(req.params.adventureId,req.params.questId,req.params.objectiveId,b.completed)})}catch(e){next(e)}})

router.put('/:campaignId/adventures/:adventureId/story/flags/:name',(req,res,next)=>{try{adventure(req.params.campaignId,req.params.adventureId);const name=req.params.name.trim();if(!/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(name))throw new HttpError(400,'Validation failed.',{name:'Use 1–80 letters, numbers, underscores, or hyphens; start with a letter.'});const b=bodyObject(req.body);if(!Object.hasOwn(b,'value')||!safeStoryValue(b.value)||JSON.stringify(b.value).length>2048)throw new HttpError(400,'Validation failed.',{value:'Use a boolean or small JSON value (maximum 2 KB, four levels deep).'});res.json({flag:adventureStore.saveFlag(req.params.adventureId,name,b.value)})}catch(e){next(e)}})
router.post('/:campaignId/adventures/:adventureId/story/notes',(req,res,next)=>{try{adventure(req.params.campaignId,req.params.adventureId);const b=bodyObject(req.body);res.status(201).json({note:adventureStore.addStoryNote(req.params.adventureId,text(b,'content',4000,true))})}catch(e){next(e)}})

export = router
