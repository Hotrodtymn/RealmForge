import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire, Module } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const require=createRequire(import.meta.url)
const ts=require('typescript')
const React=require('react')
const {renderToStaticMarkup}=require('react-dom/server')
const filename=resolve(dirname(fileURLToPath(import.meta.url)),'StoryMemoryPanel.tsx')
const compiled=ts.transpileModule(readFileSync(filename,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}})
const componentModule=new Module(filename);componentModule.filename=filename;componentModule.paths=Module._nodeModulePaths(dirname(filename));componentModule._compile(compiled.outputText,filename)
const StoryMemoryPanel=componentModule.exports.default

test('DM story memory panel is clearly labeled private and read-only with a refresh action',()=>{
  const markup=renderToStaticMarkup(React.createElement(StoryMemoryPanel,{campaignId:'campaign',adventureId:'adventure',sessionId:'session',characterId:'character'}))
  assert.match(markup,/Story Memory/)
  assert.match(markup,/PRIVATE CONTINUITY NOTES · DM VIEW/)
  assert.match(markup,/not authoritative campaign facts/)
  assert.match(markup,/Refresh/)
})
