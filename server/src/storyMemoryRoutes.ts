import express = require('express')
import isLoopbackAddress = require('./loopback')
import memoryService = require('./storyMemoryService')
import memoryStore = require('./storyMemoryStore')
import turnStore = require('./aiSessionTurnStore')
import HttpError = require('./httpError')
import ollama = require('./ollamaService')

const router=express.Router()
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function localOnly(request:express.Request,response:express.Response){if(isLoopbackAddress(request.socket.remoteAddress))return true;response.status(403).json({error:'Story memory is available only to local clients.'});return false}
function handle(error:unknown,response:express.Response,next:express.NextFunction){if(error instanceof ollama.OllamaError){response.status(error.kind==='timeout'?504:error.kind==='malformed'?502:503).json({error:error.message});return}next(error instanceof HttpError?error:new HttpError(502,'Story memory could not be processed.'))}

router.get('/session/:sessionId/memories',(request,response,next)=>{
  if(!localOnly(request,response))return
  const sessionId=request.params.sessionId,characterId=request.query.characterId
  if(!uuid.test(sessionId)||typeof characterId!=='string'||!uuid.test(characterId)){response.status(400).json({error:'Validation failed.',fields:{sessionId:'Provide valid session and character UUIDs.'}});return}
  try{
    // The current app has no authenticated roles. These are explicitly DM-only
    // local notes and are never returned by the player-facing session endpoints.
    const scoped=turnStore.context(sessionId,characterId)
    const result=memoryStore.listForSession(scoped.campaignId,String(scoped.context.adventure.id),sessionId,characterId)
    response.json({...result,visibility:'dm_private'})
  }catch(error){handle(error,response,next)}
})

router.post('/session/:sessionId/memories/:turnId/retry',async(request,response,next)=>{
  if(!localOnly(request,response))return
  const sessionId=request.params.sessionId,turnId=request.params.turnId,characterId=request.query.characterId
  if(!uuid.test(sessionId)||!uuid.test(turnId)||typeof characterId!=='string'||!uuid.test(characterId)){response.status(400).json({error:'Validation failed.',fields:{ids:'Provide valid session, turn, and character UUIDs.'}});return}
  try{response.json(await memoryService.storyMemoryService.retry(sessionId,characterId,turnId))}catch(error){handle(error,response,next)}
})

export = router
