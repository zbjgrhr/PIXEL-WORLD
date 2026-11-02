import type {GameSpec} from '@/types'
import {readStoredGameArchive} from './community-play-archive'
import {buildGamePreviewDocument} from './community-play-document'
import {buildGameDataFromSpec} from './virtual-levels'
import {validateReference} from './reference-analysis'

/** Read native stored ZIP data. Never evaluate its HTML, scripts or styles. */
export async function readEditableProject(buffer:ArrayBuffer):Promise<GameSpec>{
  const files=readStoredGameArchive(buffer),byName=new Map(files.map(f=>[f.name,f.bytes]))
  buildGamePreviewDocument(files,'12345678-1234-4234-8234-123456789abc')
  const project=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(byName.get('project.json'))) as GameSpec
  if(!project.assets.length||project.assets.length>256||new Set(project.assets.map(a=>a.id)).size!==project.assets.length||project.assets.some(a=>!/^[a-zA-Z0-9_-]{1,100}$/.test(a.id)))throw Error('Invalid project asset identifiers')
  if(project.reference){project.reference=validateReference(project.reference);project.reference.requirements=project.reference.requirements.map(r=>({...r,confirmed:false,confirmationKey:undefined}))}
  const mime:Record<string,string>={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',svg:'image/svg+xml',mp3:'audio/mpeg',wav:'audio/wav',ogg:'audio/ogg',mp4:'video/mp4',webm:'video/webm'}
  const urls=new Map<string,string>()
  const resolve=async(url:string|undefined,original?:{sha256:string;bytes:number})=>{
    if(!url)return undefined
    const bytes=byName.get(url),kind=mime[url.split('.').pop()!.toLowerCase()]
    if(!bytes||!kind||!url.startsWith('assets/'))throw Error('Missing project resource: '+url)
    if(original){const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes).buffer)),b=>b.toString(16).padStart(2,'0')).join('');if(hash!==original.sha256||bytes.length!==original.bytes)throw Error('Original image fingerprint mismatch')}
    if(!urls.has(url)){let binary='';for(let start=0;start<bytes.length;start+=8192)binary+=String.fromCharCode(...bytes.subarray(start,start+8192));urls.set(url,`data:${kind};base64,${btoa(binary)}`)}
    return urls.get(url)
  }
  for(const asset of project.assets){
    asset.url=await resolve(asset.url,asset.original)
    if(asset.animation?.clips)for(const clip of Object.values(asset.animation.clips))if(clip){clip.url=await resolve(clip.url,clip.original);if(clip.originalPages)for(let i=1;i<clip.originalPages.length;i++)clip.originalPages[i].url=await resolve(clip.originalPages[i].url,clip.originalPages[i].original)}
  }
  if(!buildGameDataFromSpec(project).data)throw Error('Project cannot be converted to a playable layout')
  return project
}
