// Metadata-only conversion. Never evaluate GML or instance creation code.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),ts=require('typescript')
const {collectReference}=require('./import-gamemaker-reference.cjs')
function runtime(){
  const root=path.resolve(__dirname,'..'),cache=new Map(),allowed=new Map([['./authored-map','lib/authored-map.ts']])
  const load=file=>{if(cache.has(file))return cache.get(file);const mod={exports:{}},source=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;vm.runInNewContext('(function(require,module,exports){'+source+'\n})')((name)=>{if(!allowed.has(name))throw Error('Unexpected trusted converter import');return load(allowed.get(name))},mod,mod.exports);cache.set(file,mod.exports);return mod.exports}
  return load('lib/gamemaker-map.ts')
}
module.exports={runtime}
if(require.main===module){
  const[root,roomId,optionsFile,target]=process.argv.slice(2)
  if(!root||!roomId||!optionsFile||!target){console.error('Usage: node scripts/convert-gamemaker-map.cjs <project-root> <room-id> <anchors-and-layers.json> <output-directory>');process.exitCode=1}
  else{
    const ref=collectReference(root),room=ref.rooms.find(r=>r.id===roomId);if(!room)throw Error('Room not found')
    const options=JSON.parse(fs.readFileSync(optionsFile,'utf8').replace(/^\uFEFF/,'')),result=runtime().convertGameMakerRoom(room,options),dir=path.resolve(target)
    fs.mkdirSync(dir,{recursive:true})
    const write=(name,value)=>{const bytes=JSON.stringify(value,null,2)+'\n';let file=path.join(dir,name);if(fs.existsSync(file)&&fs.readFileSync(file,'utf8')!==bytes){const ext=path.extname(file);file=file.slice(0,-ext.length)+'-'+crypto.createHash('sha256').update(bytes).digest('hex').slice(0,12)+ext}fs.writeFileSync(file,bytes);return file}
    const map=write('map.json',result.map),report=write('conversion-report.json',{...result.report,sourceRoot:path.resolve(root),sourceEvidence:ref.evidence.filter(e=>e.path===`rooms/${roomId}/${roomId}.yy`||room.tileLayers.some(l=>e.path===`tilesets/${l.tileset}/${l.tileset}.yy`))}),reference=write('room-reference.json',{format:ref.format,rooms:[room]})
    console.log(JSON.stringify({map,report,reference,rectangles:result.map.obstacles.length,layers:result.report.collisionLayers,unconvertedInstances:result.report.unconvertedInstances.length}))
  }
}
