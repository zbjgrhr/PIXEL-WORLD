import {playtestTraceRules,type PlaytestTrace} from './playtest-trace'
export function readTraceJSON(text:string):PlaytestTrace{
  if(text.length>2_000_000)throw Error('Trace exceeds 2 MB')
  const raw=JSON.parse(text) as PlaytestTrace
  if(!raw||typeof raw.storyKey!=='string'||!raw.storyKey||raw.storyKey.length>160||!['online','offline'].includes(raw.runtime))throw Error('Invalid trace identity')
  const trace=playtestTraceRules.restore(raw.storyKey,raw.runtime,raw)
  if(!trace.samples.length&&!trace.events.length)throw Error('Trace is empty or invalid')
  return trace
}
export function compareTraceRuns(a:PlaytestTrace,b:PlaytestTrace,levelId:string,segmentA:number,segmentB:number){
  if(a.storyKey!==b.storyKey)return {compatible:false as const,matchedSamples:0,meanDistance:0,maxDistance:0,reason:'different-project-rules'}
  const left=a.samples.filter(s=>s.levelId===levelId&&s.segment===segmentA),right=b.samples.filter(s=>s.levelId===levelId&&s.segment===segmentB)
  let count=0,sum=0,max=0,index=0
  for(const sample of left){const time=sample.sim-left[0].sim;while(index+1<right.length&&Math.abs(right[index+1].sim-right[0].sim-time)<=Math.abs(right[index].sim-right[0].sim-time))index++
    if(!right[index]||Math.abs(right[index].sim-right[0].sim-time)>100)continue
    const distance=Math.hypot(sample.x-right[index].x,sample.y-right[index].y);count++;sum+=distance;max=Math.max(max,distance)
  }
  return {compatible:true as const,matchedSamples:count,meanDistance:count?sum/count:0,maxDistance:max,reason:count?'relative-segment-time':'no-overlapping-samples'}
}
