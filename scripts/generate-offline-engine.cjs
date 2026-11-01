// Compile only trusted repository factories with the same deterministic TS
// printer. No uploaded archive, game or script is read or executed here.
const fs=require('node:fs')
const path=require('node:path')
const vm=require('node:vm')
const crypto=require('node:crypto')
const ts=require('typescript')
const root=path.resolve(__dirname,'..'),cache=new Map()
const runtimeModules=new Map([
  ['./narrative-runtime','lib/narrative-runtime.ts'],
  ['./game-language','lib/game-language.ts'],
  ['./enemy-combat','lib/enemy-combat.ts'],
  ['./traversal-hints','lib/traversal-hints.ts'],
])
const inertImports=new Set(['./virtual-levels','@/lib/asset-catalog','./template-attribution','@/configs/offline-engine-source.json'])
function load(file){
  if(cache.has(file))return cache.get(file)
  const result=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,newLine:ts.NewLineKind.LineFeed,esModuleInterop:false,sourceMap:false}})
  const mod={exports:{}}
  const importer=name=>{
    if(runtimeModules.has(name))return load(runtimeModules.get(name))
    if(inertImports.has(name))return {}
    throw new Error('Unexpected runtime-generation import: '+name)
  }
  vm.runInNewContext('(function(require,module,exports){\n'+result.outputText+'\n})',{TextEncoder,TextDecoder},{filename:file})(importer,mod,mod.exports)
  cache.set(file,mod.exports)
  return mod.exports
}
const factories=load('lib/export-game.ts')
const source=factories.buildOfflineGameRuntimeSource(),styles=factories.buildOfflineGameStylesSource()
if(typeof source!=='string' || !source.includes('__pixelWorldReadOnlySnapshot'))throw new Error('Offline engine factory is incomplete')
// Parse the generated script without running the game. Behaviour is covered by
// the existing exported-runtime tests, including CN/EN three-level completion.
new vm.Script(source,{filename:'pixel-world-engine-v2.js'})
const artifact={format:'pixel-world-engine-v2',sha256:crypto.createHash('sha256').update(source).digest('hex'),styleSha256:crypto.createHash('sha256').update(styles).digest('hex'),source,styles}
const target=path.join(root,'configs/offline-engine-source.json')
if(process.argv.includes('--check')){
  const saved=JSON.parse(fs.readFileSync(target,'utf8').replace(/^\uFEFF/,''))
  if(saved.format!==artifact.format || saved.sha256!==artifact.sha256 || saved.source!==source || saved.styleSha256!==artifact.styleSha256 || saved.styles!==styles){
    console.error('Offline engine artifact is stale. Run node scripts/generate-offline-engine.cjs and rerun the runtime tests.')
    process.exitCode=1
  }else console.log('Offline engine artifact matches the trusted source factories: '+artifact.sha256)
}else{
  fs.writeFileSync(target,JSON.stringify(artifact,null,2)+'\n')
  console.log('Generated offline engine: '+artifact.sha256+' ('+Buffer.byteLength(source)+' bytes)')
}
