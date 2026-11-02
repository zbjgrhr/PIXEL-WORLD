import {afterEach,describe,it,expect,vi} from 'vitest'
import {decodeGameMakerTiles,convertGameMakerRoom,type GameMakerRoomReference} from './gamemaker-map'
import {authoredMapRules} from './authored-map'
import {bootOfflineMap} from './test-support/offline-map'
import {createRequire} from 'node:module'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'

afterEach(()=>vi.unstubAllGlobals())
const room=():GameMakerRoomReference=>({id:'room',width:320,height:240,instances:[{id:'trigger',object:'obj_trigger',x:300,y:100,creationCode:true}],tileLayers:[{name:'Tiles_1',tileset:'ground',tileWidth:16,tileHeight:16,x:0,y:0,data:{SerialiseWidth:20,SerialiseHeight:15,TileDataFormat:1,TileCompressedData:[-200,-2147483648,-40,2,-60,-2147483648]}}]})
const options=()=>({layerNames:['Tiles_1'],player:{x:32,y:96,width:32,height:64},exit:{x:260,y:96,width:32,height:64}})
describe('GameMaker collision conversion',()=>{
  it('decodes RLE repeats and literals while rejecting malformed lengths, values and unknown formats',()=>{
    expect(decodeGameMakerTiles({SerialiseWidth:4,SerialiseHeight:1,TileDataFormat:1,TileCompressedData:[-2,-2147483648,2,1,1073741826]})).toEqual([2147483648,2147483648,1,1073741826])
    expect(()=>decodeGameMakerTiles({SerialiseWidth:4,SerialiseHeight:1,TileDataFormat:1,TileCompressedData:[-5,0]})).toThrow()
    expect(()=>decodeGameMakerTiles({SerialiseWidth:4,SerialiseHeight:1,TileDataFormat:1,TileCompressedData:[4,1]})).toThrow('Truncated')
    expect(()=>decodeGameMakerTiles({SerialiseWidth:4,SerialiseHeight:1,TileDataFormat:1,TileCompressedData:[-2,1]})).toThrow('declared')
    expect(()=>decodeGameMakerTiles({SerialiseWidth:4,SerialiseHeight:1,TileDataFormat:99,TileCompressedData:[-4,0]})).toThrow('Unsupported')
  })
  it('uses tileset size rather than editor grid, merges solids exactly and leaves code-bearing instances unconverted',()=>{
    const result=convertGameMakerRoom(room(),options())
    expect(result.map.obstacles).toEqual([{id:'tile-0-0',type:'platform',x:0,y:160,width:320,height:32}])
    expect(result.map.groundY).toBeNull();expect(result.map.enemies).toEqual([])
    expect(result.report.unconvertedInstances[0]).toMatchObject({id:'trigger',creationCode:true})
    expect(result.report.collisionLayers[0]).toMatchObject({decodedCells:300,solidCells:40,tileWidth:16})
    const r=room();r.tileLayers[0].tileWidth=undefined;expect(()=>convertGameMakerRoom(r,options())).toThrow('tileWidth')
    expect(()=>convertGameMakerRoom(room(),{...options(),layerNames:['unknown']})).toThrow('missing')
    expect(()=>convertGameMakerRoom(room(),{...options(),exit:{...options().exit,y:170}})).toThrow('exit overlaps')
  })
  it('preserves holes and reports partial out-of-room cells without inventing continuous ground',()=>{
    const r=room();r.tileLayers[0].data={SerialiseWidth:21,SerialiseHeight:15,TileSerialiseData:Array.from({length:315},(_,i)=>Math.floor(i/21)===10&&i%21!==5?1:0)}
    const result=convertGameMakerRoom(r,options())
    for(let y=0;y<240;y+=8)for(let x=0;x<320;x+=8){const expected=Math.floor(y/16)===10&&Math.floor(x/16)!==5,actual=result.map.obstacles.some(o=>x>=o.x&&x<o.x+o.width&&y>=o.y&&y<o.y+o.height);expect(actual).toBe(expected)}
    expect(result.report.collisionLayers[0].outsideCells).toBe(1)
    expect(authoredMapRules.move({x:80,y:96,width:8,height:64,vx:0,vy:30},result.map.obstacles,1,.4,result.map,9).onGround).toBe(false)
  })
  it('runs converted geometry in the actual offline engine and reaches the explicit exit',async()=>{
    const converted=convertGameMakerRoom(room(),options()),game=await bootOfflineMap(converted.map)
    game.tick();expect(game.read().player.y).toBe(96)
    game.key('d');game.tick(70);expect(game.read().won).toBe(true)
  })
  it('keeps the CLI trusted converter consistent with the application converter',()=>{
    const {runtime}=createRequire(import.meta.url)('../scripts/convert-gamemaker-map.cjs')
    expect(runtime().convertGameMakerRoom(room(),options())).toEqual(convertGameMakerRoom(room(),options()))
  })
  it('checks supplied real room cell coverage and runs its converted tutorial when local evidence is explicitly configured',async()=>{
    if(!process.env.PIXEL_WORLD_GAMEMAKER_REFERENCE)return
    const ref=JSON.parse(await readFile(process.env.PIXEL_WORLD_GAMEMAKER_REFERENCE,'utf8')),real=ref.rooms.find((r:GameMakerRoomReference)=>r.id==='tutorial') as GameMakerRoomReference
    const selected={layerNames:['Tiles_1'],player:{x:60,y:352,width:32,height:64},exit:{x:1000,y:320,width:48,height:96}},converted=convertGameMakerRoom(real,selected),game=await bootOfflineMap(converted.map)
    expect(converted.map.obstacles).toEqual([{id:'tile-0-0',type:'platform',x:0,y:416,width:1080,height:32}])
    game.tick();expect(game.read().player.y).toBe(352);game.key('d');game.tick(240);expect(game.read().won).toBe(true)
    const checks=ref.rooms.filter((r:GameMakerRoomReference)=>r.tileLayers.length).map((r:GameMakerRoomReference)=>{const layer=r.tileLayers.find(l=>l.name==='Tiles_1')!,values=decodeGameMakerTiles(layer.data);expect(values.length).toBe(layer.data.SerialiseWidth*layer.data.SerialiseHeight);return {room:r.id,cells:values.length,solidCells:values.filter(v=>(v&0x7fffffff)!==0).length,tileWidth:layer.tileWidth}})
    if(process.env.PIXEL_WORLD_STAGE_EVIDENCE){const dir=join(process.env.PIXEL_WORLD_STAGE_EVIDENCE,'real-map-check');await mkdir(dir,{recursive:true});await writeFile(join(dir,'原始房间解码与运行核对.json'),JSON.stringify({checks,tutorialWon:true,player:selected.player,exit:selected.exit,note:'Selected collision geometry only; anchors are explicit test choices, dynamic instances remain unconverted.'},null,2)+'\n');await writeFile(join(dir,'tutorial实际运行轨迹.json'),JSON.stringify(game.read().trace,null,2)+'\n')}
  })
})
