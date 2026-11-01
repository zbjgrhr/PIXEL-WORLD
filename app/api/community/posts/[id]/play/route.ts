import {NextResponse} from 'next/server'
import {GET as getMedia} from '../media/route'
import {communityResponseHeaders as headers} from '@/lib/community-http'
import offlineEngine from '@/configs/offline-engine-source.json'

export const dynamic='force-dynamic'
/** Reuse the existing caller-scoped post, file and download authorization. */
export async function GET(request:Request,context:{params:Promise<{id:string}>}){
  try{
    const url=new URL(request.url),chosen=url.searchParams.get('mediaId')
    url.search=''
    const listing=await getMedia(new Request(url,{headers:request.headers}),context)
    if(!listing.ok)return listing
    const body=await listing.json()
    const archives=(body.media || []).filter((file:{id:string;kind:string;verified:boolean})=>file.kind==='game-zip' && file.verified && (!chosen || file.id===chosen))
    if(archives.length!==1)return NextResponse.json({error:'Select one verified game ZIP for playback.'},{status:409,headers})
    const file=archives[0]
    if(!file.canDownload)return NextResponse.json({error:'The author has not permitted this game download or playback.'},{status:403,headers})
    url.searchParams.set('mediaId',file.id);url.searchParams.set('download','1')
    const signed=await getMedia(new Request(url,{headers:request.headers}),context)
    if(!signed.ok)return signed
    const archive=await signed.json()
    if(archive.kind!=='game-zip')throw new Error('archive')
    return NextResponse.json({archive:{id:archive.id,url:archive.url,bytes:archive.bytes,sha256:archive.sha256},
      engine:{format:offlineEngine.format,sha256:offlineEngine.sha256,styleSha256:offlineEngine.styleSha256},expiresInSeconds:300},{headers})
  }catch{return NextResponse.json({error:'Game playback is unavailable. Download the original ZIP to play offline.'},{status:503,headers})}
}
