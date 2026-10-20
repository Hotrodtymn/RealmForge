import express = require('express')
import adventureSessionStore = require('./adventureSessionStore')
import HttpError = require('./httpError')

const router = express.Router()
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Expected a JSON object.')
  return value as Record<string, unknown>
}
function requiredText(body: Record<string, unknown>, key: string, max: number): string {
  const value=body[key]
  if(typeof value!=='string'||!value.trim())throw new HttpError(400,'Validation failed.',{[key]:'This field is required.'})
  if(value.trim().length>max)throw new HttpError(400,'Validation failed.',{[key]:`Must be ${max} characters or fewer.`})
  return value.trim()
}
function optionalText(body:Record<string,unknown>,key:string,max:number):string{
  const value=body[key]
  if(value===undefined)return ''
  if(typeof value!=='string')throw new HttpError(400,'Validation failed.',{[key]:'Must be text.'})
  if(value.trim().length>max)throw new HttpError(400,'Validation failed.',{[key]:`Must be ${max} characters or fewer.`})
  return value.trim()
}
function preservedText(body:Record<string,unknown>,key:string,max:number):string{
  const value=body[key]
  if(typeof value!=='string'||!value.trim())throw new HttpError(400,'Validation failed.',{[key]:'This field is required.'})
  if(value.length>max)throw new HttpError(400,'Validation failed.',{[key]:`Must be ${max} characters or fewer.`})
  return value
}
function requestId(body:Record<string,unknown>){if(typeof body.requestId!=='string'||!uuid.test(body.requestId))throw new HttpError(400,'Validation failed.',{requestId:'Provide a valid UUID idempotency key.'});return body.requestId}
router.get('/:campaignId/adventures/:adventureId/sessions',(req,res,next)=>{try{res.json({sessions:adventureSessionStore.list(req.params.campaignId,req.params.adventureId)})}catch(error){next(error)}})
router.post('/:campaignId/adventures/:adventureId/sessions',(req,res,next)=>{try{
  const b=objectBody(req.body)
  const selectedCharacter=requiredText(b,'characterId',64)
  const locationId=b.locationId===undefined||b.locationId===null||b.locationId===''?null:requiredText(b,'locationId',64)
  const result=adventureSessionStore.start(req.params.campaignId,req.params.adventureId,{requestId:requestId(b),characterId:selectedCharacter,locationId,sceneTitle:optionalText(b,'sceneTitle',160),sceneDescription:optionalText(b,'sceneDescription',4000)})
  res.status(result.replayed?200:201).json(result)
}catch(error){next(error)}})
router.get('/:campaignId/sessions/:sessionId',(req,res,next)=>{try{res.json(adventureSessionStore.get(req.params.campaignId,req.params.sessionId))}catch(error){next(error)}})
for(const action of ['pause','resume','complete'] as const){
  router.post(`/:campaignId/sessions/:sessionId/${action}`,(req,res,next)=>{try{const b=objectBody(req.body);const result=adventureSessionStore.changeStatus(req.params.campaignId,req.params.sessionId,action,requestId(b));res.json(result)}catch(error){next(error)}})
}
router.post('/:campaignId/sessions/:sessionId/scenes',(req,res,next)=>{try{
  const b=objectBody(req.body)
  const locationId=b.locationId===undefined||b.locationId===null||b.locationId===''?null:requiredText(b,'locationId',64)
  const dmOverride=b.dmOverride===true
  const overrideReason=optionalText(b,'overrideReason',500)
  if(b.dmOverride!==undefined&&typeof b.dmOverride!=='boolean')throw new HttpError(400,'Validation failed.',{dmOverride:'Must be true or false.'})
  if(dmOverride&&!overrideReason)throw new HttpError(400,'Validation failed.',{overrideReason:'A reason is required for a DM override.'})
  const result=adventureSessionStore.transition(req.params.campaignId,req.params.sessionId,{requestId:requestId(b),locationId,title:requiredText(b,'title',160),description:optionalText(b,'description',4000),dmOverride,overrideReason})
  res.json(result)
}catch(error){next(error)}})
router.post('/:campaignId/sessions/:sessionId/decisions',(req,res,next)=>{try{
  const b=objectBody(req.body)
  const result=adventureSessionStore.recordDecision(req.params.campaignId,req.params.sessionId,{requestId:requestId(b),decisionText:preservedText(b,'decisionText',2000),category:optionalText(b,'category',80)})
  res.status(result.replayed?200:201).json(result)
}catch(error){next(error)}})
router.get('/:campaignId/sessions/:sessionId/scenes/:sceneId/decisions',(req,res,next)=>{try{res.json({decisions:adventureSessionStore.sceneDecisions(req.params.campaignId,req.params.sessionId,req.params.sceneId)})}catch(error){next(error)}})
router.get('/:campaignId/sessions/:sessionId/context',(req,res,next)=>{try{res.json({context:adventureSessionStore.context(req.params.campaignId,req.params.sessionId)})}catch(error){next(error)}})

export = router
