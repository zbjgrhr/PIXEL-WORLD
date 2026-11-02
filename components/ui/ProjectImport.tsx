'use client'
import {useEffect,useRef,useState} from 'react'
import {Alert,Collapse,Space} from 'antd'
import type {GameSpec} from '@/types'
import {readEditableProject} from '@/lib/editable-project'
import {useUiLocale} from './LanguageSwitcher'

export default function ProjectImport({disabled,revision,onLoad}:{disabled:boolean;revision:unknown;onLoad:(spec:GameSpec)=>Promise<void>}){
  const en=useUiLocale()==='en',[busy,setBusy]=useState(false),[error,setError]=useState(''),live=useRef(revision),generation=useRef(0)
  live.current=revision
  useEffect(()=>()=>{generation.current++},[])
  return <Collapse size="small" items={[{key:'project',label:en?'Reopen an exported project ZIP':'重新编辑已导出的项目ZIP',children:<Space direction="vertical" style={{width:'100%'}}>
    <p>{en?'Select a native Pixel World ZIP (up to 45 MB). Maps, character rules, original frames and source notes become an editable draft. Imported code never runs. Review is required again.':'选择Pixel World原生导出ZIP（最多45MB），将地图、角色规则、原图动作和来源清单载入草稿。不会运行包内代码；导入后需要重新检查和批准。'}</p>
    <input type="file" aria-label="Reopen Pixel World project ZIP" accept=".zip,application/zip" disabled={disabled||busy} onChange={async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;const token=++generation.current,expected=revision;setBusy(true);setError('');try{if(file.size>45_000_000)throw Error('Project ZIP exceeds 45 MB');const spec=await readEditableProject(await file.arrayBuffer());if(token!==generation.current)return;if(live.current!==expected)throw Error(en?'Draft changed while reading; select the file again.':'读取期间草稿已变化，请重新选择。');await onLoad(spec)}catch(e){if(token===generation.current)setError(String(e))}finally{if(token===generation.current)setBusy(false)}}}/>
    {error&&<Alert type="error" message={error}/>}
  </Space>}]} />
}
