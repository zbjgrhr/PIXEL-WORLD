import type {AuthoredLevelMap,MapRect,ObstacleData} from '@/types'
import {authoredMapRules} from './authored-map'

export interface GameMakerTileLayer {name:string;tileset?:string|null;tileWidth?:number;tileHeight?:number;x?:number;y?:number;visible?:boolean;data:{SerialiseWidth:number;SerialiseHeight:number;TileDataFormat?:number;TileCompressedData?:number[];TileSerialiseData?:number[]}}
export interface GameMakerRoomReference {id:string;width:number;height:number;tileLayers:GameMakerTileLayer[];instances?:Array<{id:string;object?:string;x:number;y:number;creationCode?:boolean}>}
export interface GameMakerConversionOptions {layerNames:string[];player:MapRect;exit:MapRect}
function integer(v:unknown,min:number,max:number,label:string):number{if(typeof v!=='number'||!Number.isInteger(v)||v<min||v>max)throw Error('Invalid '+label);return v}
/** Format-1 RLE inferred from supplied .yy streams: -N repeats one word, +N copies N words.
 * Exact declared dimensions and bounds are checked; unknown encodings fail explicitly.
 */
export function decodeGameMakerTiles(data:GameMakerTileLayer['data']):number[]{
  const width=integer(data?.SerialiseWidth,1,4096,'tile columns'),height=integer(data?.SerialiseHeight,1,4096,'tile rows'),total=width*height
  if(total>1_000_000)throw Error('Tile grid exceeds one million cells')
  const word=(v:unknown)=>integer(v,-2147483648,4294967295,'tile word')>>>0
  if(data.TileSerialiseData!==undefined){if(!Array.isArray(data.TileSerialiseData)||data.TileSerialiseData.length!==total||data.TileCompressedData!==undefined)throw Error('Invalid uncompressed tile array');return data.TileSerialiseData.map(word)}
  if(data.TileDataFormat!==1||!Array.isArray(data.TileCompressedData)||data.TileCompressedData.length>2_000_000)throw Error('Unsupported tile encoding; expected format-1 RLE')
  const out:number[]=[],stream=data.TileCompressedData
  for(let i=0;i<stream.length;){const count=integer(stream[i++],-total,total,'RLE count');if(count===0||out.length+Math.abs(count)>total)throw Error('Invalid RLE run length');if(count<0){if(i>=stream.length)throw Error('Truncated RLE repeat');const value=word(stream[i++]);for(let j=0;j<-count;j++)out.push(value)}else{if(i+count>stream.length)throw Error('Truncated RLE literals');for(let j=0;j<count;j++)out.push(word(stream[i++]))}}
  if(out.length!==total)throw Error('Decoded grid does not match declared dimensions')
  return out
}
export function convertGameMakerRoom(room:GameMakerRoomReference,options:GameMakerConversionOptions){
  integer(room?.width,320,32768,'room width');integer(room?.height,240,32768,'room height')
  if(!Array.isArray(room.tileLayers)||room.tileLayers.length>128||!Array.isArray(options?.layerNames)||!options.layerNames.length||options.layerNames.length>32||new Set(options.layerNames).size!==options.layerNames.length)throw Error('Choose unique collision layer names explicitly')
  const obstacles:ObstacleData[]=[],layers:Array<{name:string;tileWidth:number;tileHeight:number;decodedCells:number;solidCells:number;clippedCells:number;outsideCells:number;rectangles:number}>=[]
  for(const name of options.layerNames){
    const matched=room.tileLayers.filter(l=>l.name===name);if(matched.length!==1)throw Error('Collision layer is missing or ambiguous: '+name)
    const layer=matched[0],tw=integer(layer.tileWidth,1,4096,'tileset tileWidth'),th=integer(layer.tileHeight,1,4096,'tileset tileHeight'),ox=integer(layer.x??0,-32768,32768,'layer x'),oy=integer(layer.y??0,-32768,32768,'layer y')
    const values=decodeGameMakerTiles(layer.data),columns=layer.data.SerialiseWidth,rows=layer.data.SerialiseHeight
    let solidCells=0,clippedCells=0,outsideCells=0
    // Runtime bit 31 is documented as unused; supplied serialized empty words set it.
    const occupied=(x:number,y:number)=>((values[y*columns+x]>>>0)&0x7fffffff)!==0
    const merged:ObstacleData[]=[],previous=new Map<string,ObstacleData>()
    for(let row=0;row<rows;row++){
      const current=new Map<string,ObstacleData>()
      for(let column=0;column<columns;){
        if(!occupied(column,row)){column++;continue}
        const first=column
        while(column<columns&&occupied(column,row)){
          solidCells++;const x=ox+column*tw,y=oy+row*th
          if(x+tw<=0||x>=room.width||y+th<=0||y>=room.height)outsideCells++;else if(x<0||x+tw>room.width||y<0||y+th>room.height)clippedCells++
          column++
        }
        const x=Math.max(0,ox+first*tw),right=Math.min(room.width,ox+column*tw),y=Math.max(0,oy+row*th),bottom=Math.min(room.height,oy+(row+1)*th)
        if(right<=x||bottom<=y)continue
        const key=x+':'+(right-x),prior=previous.get(key)
        if(prior&&prior.y+prior.height===y){prior.height=bottom-prior.y;current.set(key,prior)}else{const rect={id:'tile-'+obstacles.length+'-'+merged.length,type:'platform',x,y,width:right-x,height:bottom-y};merged.push(rect);current.set(key,rect)}
      }
      previous.clear();for(const[key,value]of current)previous.set(key,value)
    }
    if(obstacles.length+merged.length>512)throw Error('Merged collision map exceeds 512 rectangles; select fewer layers or split the room')
    obstacles.push(...merged);layers.push({name,tileWidth:tw,tileHeight:th,decodedCells:values.length,solidCells,clippedCells,outsideCells,rectangles:merged.length})
  }
  const map=authoredMapRules.validate({version:2,width:room.width,height:room.height,groundY:null,player:options.player,exit:options.exit,obstacles,enemies:[],collectibles:[]}) as AuthoredLevelMap
  if(obstacles.some(o=>authoredMapRules.overlaps(map.exit,o)))throw Error('Chosen exit overlaps converted collision geometry')
  return {map,report:{format:'pixel-world-gamemaker-map-report-v1',roomId:room.id,collisionLayers:layers,convertedRectangles:obstacles.length,anchors:'Explicitly supplied; not inferred from creation code',ignoredTileLayers:room.tileLayers.filter(l=>!options.layerNames.includes(l.name)).map(l=>l.name),unconvertedInstances:(room.instances||[]).map(i=>({id:i.id,object:i.object,x:i.x,y:i.y,creationCode:!!i.creationCode})),limitations:['Format-1 RLE inferred from supplied metadata; runtime binary equivalence remains unverified.','Only selected full-tile collision geometry is converted. No tile artwork is imported.','Out-of-room collision cells are clipped or omitted and counted explicitly.','Object behaviors, creation code, inherited rooms and runtime tile edits are not executed or reproduced.','Player and exit are explicit conversion choices. This is not an original-game completion claim.'],sources:['https://manual.gamemaker.io/monthly/en/GameMaker_Language/GML_Reference/Asset_Management/Rooms/Tile_Map_Layers/Tile_Map_Layers.htm','https://github.com/YoYoGames/GameMaker-Bugs/issues/2836']}}
}
