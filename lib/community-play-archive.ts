/** Stored ZIP parser for this project's native exporter. No extraction or code
 * execution. Self-contained so it can run in a dedicated browser Worker. */
export function readStoredGameArchive(buffer:ArrayBuffer, spatialProjectOnly=false):Array<{name:string;bytes:Uint8Array}>{
  const bytes=new Uint8Array(buffer),view=new DataView(buffer),length=bytes.length
  const fail=():never=>{throw new Error('Unsupported or changed game archive')}
  if(length<22 || length>45_000_000)return fail()
  const end=length-22
  if(view.getUint32(end,true)!==0x06054b50 || view.getUint16(end+4,true)!==0 || view.getUint16(end+6,true)!==0 || view.getUint16(end+20,true)!==0)return fail()
  const count=view.getUint16(end+10,true),directory=view.getUint32(end+16,true),directorySize=view.getUint32(end+12,true)
  if(!count || count>512 || count!==view.getUint16(end+8,true) || directory+directorySize!==end)return fail()
  const table=Uint32Array.from({length:256},(_,index)=>{let value=index;for(let n=0;n<8;n++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0})
  const decoder=new TextDecoder('utf-8',{fatal:true}),names=new Set<string>(),files:Array<{name:string;bytes:Uint8Array}>=[]
  let cursor=directory,localEnd=0
  for(let index=0;index<count;index++){
    if(cursor+46>end || view.getUint32(cursor,true)!==0x02014b50)return fail()
    const flags=view.getUint16(cursor+8,true),method=view.getUint16(cursor+10,true),crc=view.getUint32(cursor+16,true),size=view.getUint32(cursor+24,true),compressed=view.getUint32(cursor+20,true)
    const nameLength=view.getUint16(cursor+28,true),extra=view.getUint16(cursor+30,true),comment=view.getUint16(cursor+32,true),local=view.getUint32(cursor+42,true)
    if(flags!==0 || method!==0 || size!==compressed || size>45_000_000 || !nameLength || cursor+46+nameLength+extra+comment>end || local!==localEnd || local+30>directory || (view.getUint32(cursor+38,true)>>>16&0o170000)===0o120000)return fail()
    const name=decoder.decode(bytes.subarray(cursor+46,cursor+46+nameLength)),lower=name.toLowerCase()
    if(names.has(lower) || name.startsWith('/') || name.split('/').some(part=>!part || part==='.' || part==='..') || !/^[a-z\d_./-]+$/i.test(name))return fail()
    if(!['index.html','styles.css','game.js','project.json','ATTRIBUTION.txt'].includes(name) && !/^assets\/[a-z\d_/-]+\.(png|jpe?g|gif|webp|svg|mp3|wav|ogg|mp4|webm)$/i.test(name))return fail()
    if(view.getUint32(local,true)!==0x04034b50 || view.getUint16(local+6,true)!==flags || view.getUint16(local+8,true)!==method || view.getUint32(local+14,true)!==crc || view.getUint32(local+18,true)!==size || view.getUint32(local+22,true)!==size)return fail()
    const localName=view.getUint16(local+26,true),localExtra=view.getUint16(local+28,true),start=local+30+localName+localExtra
    if(start+size>directory || decoder.decode(bytes.subarray(local+30,local+30+localName))!==name)return fail()
    const data=bytes.subarray(start,start+size)
    let actual=0xffffffff
    for(const byte of data)actual=table[(actual^byte)&255]^(actual>>>8)
    if(((actual^0xffffffff)>>>0)!==crc)return fail()
    names.add(lower);files.push({name,bytes:data});localEnd=start+size
    cursor+=46+nameLength+extra+comment
  }
  const required=spatialProjectOnly?['index.html','project.json']:['index.html','styles.css','game.js','project.json']
  if(cursor!==end || localEnd!==directory || !required.every(name=>files.some(file=>file.name===name)))return fail()
  return files
}

export function gameArchiveWorkerSource():string{
  return `const parse=${readStoredGameArchive.toString()};self.onmessage=async event=>{try{const {buffer,expected}=event.data;if(buffer.byteLength!==expected.bytes||!/^[a-f0-9]{64}$/.test(expected.sha256)||!/^[a-f0-9]{64}$/.test(expected.engineSha256)||!/^[a-f0-9]{64}$/.test(expected.styleSha256))throw Error();const hash=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');if(await hash(buffer)!==expected.sha256)throw Error();const files=parse(buffer),engine=files.find(file=>file.name==='game.js'),styles=files.find(file=>file.name==='styles.css');if(await hash(engine.bytes)!==expected.engineSha256||await hash(styles.bytes)!==expected.styleSha256)throw Error();self.postMessage({ok:true,files},[buffer])}catch{self.postMessage({ok:false})}};`
}
