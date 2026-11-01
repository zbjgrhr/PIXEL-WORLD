'use client'
import {useCallback,useEffect,useRef,useState} from 'react'
import {Alert,Button,Modal,Spin} from 'antd'
import {useUiLocale} from './ui/LanguageSwitcher'
import {GAME_PREVIEW_SANDBOX,type PreviewResource} from '@/lib/community-play-document'

export default function CommunityGamePreview({postId,revision}:{postId:string;revision:string}){
  const en=useUiLocale()==='en'
  const [open,setOpen]=useState(false),[phase,setPhase]=useState<'idle'|'downloading'|'checking'|'starting'|'playing'|'error'>('idle'),[progress,setProgress]=useState(''),[html,setHtml]=useState<string|null>(null)
  const frame=useRef<HTMLIFrameElement>(null),generation=useRef(0),controller=useRef<AbortController|null>(null),worker=useRef<Worker|null>(null),urls=useRef(new Set<string>()),token=useRef('')
  const resources=useRef<PreviewResource[]|null>(null),initializingTimer=useRef<number|undefined>(undefined),closingTimer=useRef<number|undefined>(undefined),finishClosing=useRef<(()=>void)|null>(null)
  const cleanup=useCallback(()=>{
    if(token.current)frame.current?.contentWindow?.postMessage({type:'pixel-world-preview-dispose',token:token.current},'*')
    generation.current++;controller.current?.abort();controller.current=null;worker.current?.terminate();worker.current=null
    window.clearTimeout(initializingTimer.current);window.clearTimeout(closingTimer.current);finishClosing.current=null;resources.current=null
    for(const url of urls.current)URL.revokeObjectURL(url);urls.current.clear();token.current=''
  },[])
  useEffect(()=>{setOpen(false);setHtml(null);setPhase('idle');return cleanup},[postId,revision,cleanup])
  useEffect(()=>{
    const receive=(event:MessageEvent)=>{
      if(!token.current || event.source!==frame.current?.contentWindow || event.data?.type!=='pixel-world-preview' || event.data.token!==token.current)return
      if(event.data.state==='awaiting-assets' && resources.current){
        const data=resources.current;resources.current=null
        const buffers=[...new Set(data.map(file=>file.bytes.buffer))].filter((buffer):buffer is ArrayBuffer=>buffer instanceof ArrayBuffer)
        try{frame.current?.contentWindow?.postMessage({type:'pixel-world-preview-resources',token:token.current,resources:data},'*',buffers)}
        catch{setHtml(null);setPhase('error');cleanup()}
      }
      else if(event.data.state==='disposed')finishClosing.current?.()
      else if(event.data.state==='ready'){window.clearTimeout(initializingTimer.current);setPhase('playing')}
      else if(event.data.state==='error'){setHtml(null);setPhase('error');cleanup()}
    }
    window.addEventListener('message',receive)
    return()=>window.removeEventListener('message',receive)
  },[cleanup])
  const begin=async()=>{
    cleanup();const run=generation.current
    const abort=new AbortController();controller.current=abort
    const timeout=window.setTimeout(()=>abort.abort(),90_000)
    setOpen(true);setHtml(null);setPhase('downloading');setProgress('')
    const current=()=>run===generation.current && !abort.signal.aborted
    const blob=(bytes:Uint8Array,mime:string)=>{const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:mime}));urls.current.add(url);return url}
    try{
      const manifestReply=await fetch(`/api/community/posts/${postId}/play`,{cache:'no-store',signal:abort.signal})
      if(!manifestReply.ok)throw new Error('manifest')
      const manifest=await manifestReply.json(),expected=manifest.archive
      if(manifest.engine?.format!=='pixel-world-engine-v2' || !Number.isSafeInteger(expected?.bytes) || expected.bytes<1 || expected.bytes>45_000_000)throw new Error('manifest')
      const target=new URL(expected.url)
      if(target.protocol!=='https:' && !(target.protocol==='http:' && ['localhost','127.0.0.1'].includes(target.hostname)))throw new Error('url')
      const reply=await fetch(target.href,{credentials:'omit',signal:abort.signal})
      if(!reply.ok || !reply.body)throw new Error('download')
      const reader=reply.body.getReader(),chunks:Uint8Array[]=[],total=expected.bytes
      let received=0
      try{
        while(true){const chunk=await reader.read();if(chunk.done)break;received+=chunk.value.length;if(received>total){await reader.cancel();throw new Error('size')};chunks.push(chunk.value);if(current())setProgress(`${(received/1_000_000).toFixed(1)} / ${(total/1_000_000).toFixed(1)} MB`)}
      }finally{reader.releaseLock()}
      if(!current())return
      if(received!==total)throw new Error('size')
      const bytes=new Uint8Array(total);let offset=0
      for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
      setPhase('checking')
      const {gameArchiveWorkerSource}=await import('@/lib/community-play-archive')
      if(!current())return
      const workerUrl=blob(new TextEncoder().encode(gameArchiveWorkerSource()),'text/javascript')
      const checker=new Worker(workerUrl);worker.current=checker
      const files=await new Promise<Array<{name:string;bytes:Uint8Array}>>((resolve,reject)=>{
        const timer=window.setTimeout(()=>reject(new Error('check-timeout')),30_000)
        const cancelled=()=>{window.clearTimeout(timer);reject(new Error('cancelled'))}
        abort.signal.addEventListener('abort',cancelled,{once:true})
        checker.onmessage=event=>{window.clearTimeout(timer);abort.signal.removeEventListener('abort',cancelled);event.data?.ok===true?resolve(event.data.files):reject(new Error('unsupported'))}
        checker.onerror=()=>{window.clearTimeout(timer);abort.signal.removeEventListener('abort',cancelled);reject(new Error('worker'))}
        checker.postMessage({buffer:bytes.buffer,expected:{bytes:total,sha256:expected.sha256,engineSha256:manifest.engine.sha256,styleSha256:manifest.engine.styleSha256}},[bytes.buffer])
      })
      checker.terminate();worker.current=null
      if(!current())return
      const {buildGamePreviewDocument}=await import('@/lib/community-play-document')
      if(!current())return
      token.current=crypto.randomUUID()
      const document=buildGamePreviewDocument(files,token.current)
      if(!current())return
      resources.current=document.resources
      initializingTimer.current=window.setTimeout(()=>{if(run===generation.current){setHtml(null);setPhase('error');cleanup()}},30_000)
      setPhase('starting');setHtml(document.html)
    }catch{if(run===generation.current){setHtml(null);setPhase('error');cleanup()}}
    finally{window.clearTimeout(timeout)}
  }
  const close=()=>{
    if(finishClosing.current)return
    const finish=()=>{cleanup();setOpen(false);setHtml(null);setPhase('idle')}
    if(frame.current?.contentWindow && token.current){
      finishClosing.current=finish;closingTimer.current=window.setTimeout(finish,150)
      frame.current.contentWindow.postMessage({type:'pixel-world-preview-dispose',token:token.current},'*')
    }else finish()
  }
  return <>
    <Button onClick={()=>void begin()} disabled={open}>{en?'Play Exported Game':'试玩导出游戏'}</Button>
    <Modal open={open} onCancel={close} footer={<Button onClick={close}>{en?'Close Preview':'关闭试玩'}</Button>} width={1240} title={en?'Exported Game Preview':'导出游戏试玩'} destroyOnHidden>
      <p>{en?'This preview uses the original ZIP. It does not call an AI model or change your creation. Closing it ends the session.':'试玩使用原导出ZIP，不调用AI模型，也不改动制作台作品。关闭后结束本次试玩。'}</p>
      {phase==='error' && <Alert type="warning" showIcon message={en?'This export could not be played here. It may be unavailable, incompatible, or changed. You can still check permitted downloads in the attached media.':'暂时无法在这里试玩：可能是权限、版本不兼容或文件发生变化。可到附件中查看允许下载的原ZIP。'} />}
      {(phase==='downloading' || phase==='checking' || phase==='starting') && <div role="status"><Spin size="small" /> {en?({downloading:'Loading exported game',checking:'Checking archive and supported engine',starting:'Starting game'}[phase]):({downloading:'正在载入导出游戏',checking:'正在核对压缩包和引擎版本',starting:'正在启动游戏'}[phase])} {phase==='downloading'?progress:''}</div>}
      {phase==='playing' && <p>{en?'Click inside the game to use its keyboard controls. Starting successfully is not a playthrough or quality verdict.':'先点击游戏区域，再使用键盘操作。启动成功不代表通关或质量验收通过。'}</p>}
      {html && <iframe ref={frame} title={en?'Pixel World game preview':'Pixel World游戏试玩'} sandbox={GAME_PREVIEW_SANDBOX} referrerPolicy="no-referrer" srcDoc={html} style={{width:'100%',height:'min(72vh,760px)',border:'1px solid #b8d0bd',borderRadius:12}} />}
    </Modal>
  </>
}
