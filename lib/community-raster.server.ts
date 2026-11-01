import sharp from 'sharp'
import {CommunityFileError} from './community-file-rules.server'

/** Shared limits for standalone images and image files inside an exported ZIP. */
export async function inspectCommunityRaster(contents:Buffer,extension:string){
  const metadata=await sharp(contents,{animated:true,limitInputPixels:160_000_000,failOn:'warning'}).metadata()
  const formats:Record<string,string>={png:'png',jpg:'jpeg',jpeg:'jpeg',webp:'webp',gif:'gif'}
  if(metadata.format!==formats[extension])throw new CommunityFileError('TYPE_MISMATCH')
  const width=metadata.width || 0,height=metadata.pageHeight || metadata.height || 0,frames=metadata.pages || 1
  if(!width || !height || width>8192 || height>8192 || width*height>32_000_000 || frames>1000 || width*height*frames>160_000_000)throw new CommunityFileError('LIMIT_EXCEEDED')
  for(const page of new Set([0,frames-1]))await sharp(contents,{page,pages:1,limitInputPixels:32_000_000,failOn:'warning'}).timeout({seconds:10}).resize({width:32,height:32,fit:'inside'}).raw().toBuffer()
  const duration=(metadata.delay || []).reduce((sum,delay)=>sum+delay,0)/1000
  return {width,height,frames,durationSeconds:frames>1 && duration>0?duration:null}
}
