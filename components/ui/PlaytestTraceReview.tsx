'use client'
import {useEffect,useRef,useState} from 'react'
import {Alert,Collapse,Select,Space} from 'antd'
import type {GameSpec} from '@/types'
import type {PlaytestTrace} from '@/lib/playtest-trace'
import {compareTraceRuns,readTraceJSON} from '@/lib/trace-review'
import {narrativeEngine} from '@/lib/narrative-runtime'
import {useUiLocale} from './LanguageSwitcher'

export default function PlaytestTraceReview({spec}:{spec:GameSpec}){
  const en=useUiLocale()==='en',[traces,setTraces]=useState<PlaytestTrace[]>([]),[names,setNames]=useState<string[]>([]),[level,setLevel]=useState(''),[segments,setSegments]=useState([0,0]),[error,setError]=useState(''),generation=useRef(0)
  useEffect(()=>()=>{generation.current++},[])
  const id=level||spec.levels[0].id,map=spec.levels.find(l=>l.id===id)?.map,width=map?.width||1600,height=map?.height||720
  const comparisons=traces.length===2?compareTraceRuns(traces[0],traces[1],id,segments[0],segments[1]):undefined
  const colors=['#347c68','#b56c27'],key=narrativeEngine.key(spec)
  return <Collapse size="small" items={[{key:'trace',label:en?'Compare playtest paths, deaths and stages':'试玩对照 · 轨迹、死亡与阶段',children:<Space direction="vertical" style={{width:'100%'}}>
    <p>{en?'Load one or two exported trace JSON files. Select a level and run segment; markers show deaths and checkpoint changes. Paths are observations, not a completion certificate.':'载入1～2份导出的试玩轨迹JSON，选择关卡和运行片段；可对照跳跃路线、死亡位置、存档点及Boss阶段。轨迹仅作观察，不自动判定还原通过。'}</p>
    <input aria-label="Playtest traces JSON" type="file" multiple accept=".json,application/json" onChange={async e=>{const files=Array.from(e.target.files||[]);e.target.value='';if(!files.length)return;const token=++generation.current;try{if(files.length>2||files.some(f=>f.size>2_000_000))throw Error('Select 1–2 trace files, each under 2 MB');const next=await Promise.all(files.map(async f=>readTraceJSON(await f.text())));if(token!==generation.current)return;setTraces(next);setNames(files.map(f=>f.name));setSegments(next.map(t=>t.events[0]?.segment??t.samples[0]?.segment??0));setError('')}catch(e){if(token===generation.current)setError(String(e))}}}/>
    <Select aria-label="Trace level" value={id} onChange={setLevel} options={spec.levels.map(l=>({value:l.id,label:l.name}))}/>
    {traces.map((trace,i)=><label key={i} style={{color:colors[i]}}>{names[i]} · {trace.runtime} <Select aria-label={'Trace segment '+i} value={segments[i]} style={{minWidth:130}} onChange={v=>setSegments(old=>old.map((s,j)=>i===j?v:s))} options={[...new Set([...trace.samples,...trace.events].filter(s=>s.levelId===id).map(s=>s.segment))].map(value=>({value,label:`${en?'Segment':'片段'} ${value}`}))}/><small> {trace.droppedSamples+trace.droppedEvents?`${en?'Dropped':'已丢弃'} ${trace.droppedSamples+trace.droppedEvents}`:''}</small></label>)}
    {traces.some(t=>t.storyKey!==key)&&<Alert type="warning" message={en?'A trace belongs to different project rules. Compare geometry cautiously.':'有轨迹对应另一套项目规则；请先核对版本，不能据此认定当前版本通过。'}/>}
    {comparisons&&<Alert type={comparisons.compatible?'info':'warning'} message={comparisons.compatible?`${en?'Time-aligned samples / mean / maximum distance':'按片段时间对齐的样本数 / 平均 / 最大位置差'}: ${comparisons.matchedSamples} / ${comparisons.meanDistance.toFixed(1)} / ${comparisons.maxDistance.toFixed(1)} px`:(en?'The two traces have different project rules.':'两份轨迹的项目规则不同，未计算差值。')}/>}
    {traces.length>0&&<svg role="img" aria-label="Playtest path comparison" viewBox={`0 0 ${width} ${height}`} style={{width:'100%',maxHeight:400,background:'#f4f6e9',border:'1px solid #aac6b4'}}>
      {map?.obstacles.map(o=><rect key={o.id} x={o.x} y={o.y} width={o.width} height={o.height} fill="#c5c5af"/>)}
      {map?.groundY!==undefined&&map.groundY!==null&&<path d={`M0 ${map.groundY}H${width}`} stroke="#879a79" strokeWidth={3}/>}
      {traces.map((trace,i)=><g key={i}><polyline fill="none" stroke={colors[i]} strokeWidth={3} points={trace.samples.filter(s=>s.levelId===id&&s.segment===segments[i]).map(s=>`${s.x},${s.y}`).join(' ')}/>{trace.events.filter(e=>e.levelId===id&&e.segment===segments[i]&&['death','jump','checkpoint'].includes(e.kind)).map((e,j)=><circle key={j} cx={e.x} cy={e.y} r={e.kind==='death'?8:5} fill={e.kind==='death'?'#c64141':e.kind==='checkpoint'?'#376ead':colors[i]}><title>{`${e.kind} · ${e.sim}ms · ${e.target||''}`}</title></circle>)}</g>)}
    </svg>}
    {traces.map((trace,i)=><details key={i}><summary>{names[i]} · {en?'Events':'事件记录'}</summary><div style={{maxHeight:240,overflow:'auto'}}><table style={{width:'100%',fontSize:12}}><thead><tr><th>ms</th><th>{en?'Event':'事件'}</th><th>{en?'Target / stage':'对象 / 阶段'}</th><th>x / y</th></tr></thead><tbody>{trace.events.filter(e=>e.levelId===id&&e.segment===segments[i]).map((e,j)=><tr key={j}><td>{Math.round(e.sim)}</td><td>{e.kind}</td><td>{e.target} {e.stage===undefined?'':e.stage+1} {e.phase}</td><td>{Math.round(e.x)} / {Math.round(e.y)}</td></tr>)}</tbody></table></div></details>)}
    {error&&<Alert type="error" message={error}/>}
  </Space>}]} />
}
