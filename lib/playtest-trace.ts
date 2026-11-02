export interface TraceSample { segment: number; levelId: string; sim: number; x: number; y: number; vx: number; vy: number; onGround: boolean; health: number; characterId?: string }
export interface TraceEvent { segment: number; levelId: string; sim: number; kind: 'level-start' | 'retry' | 'restore' | 'jump' | 'death' | 'boss-stage' | 'checkpoint' | 'character'; x: number; y: number; target?: string; stage?: number; phase?: string }
export interface PlaytestTrace { version: 1; storyKey: string; runtime: 'online' | 'offline'; segment: number; lastSampleAt: number; droppedSamples: number; droppedEvents: number; samples: TraceSample[]; events: TraceEvent[] }

/** Bounded observations of the running engine, not a completion certificate. */
function createPlaytestTraceRules() {
  const MAX_SAMPLES = 3600, MAX_EVENTS = 2048
  function fresh(storyKey: string, runtime: PlaytestTrace['runtime']): PlaytestTrace { return { version:1,storyKey,runtime,segment:0,lastSampleAt:-1,droppedSamples:0,droppedEvents:0,samples:[],events:[] } }
  const text = (v: unknown, max=160): v is string => typeof v === 'string' && v.length <= max
  const finite = (v: unknown, min=-1e7,max=1e12): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
  function restore(storyKey: string, runtime: PlaytestTrace['runtime'], value: unknown): PlaytestTrace {
    const t=value as PlaytestTrace
    if(!t||t.version!==1||t.storyKey!==storyKey||t.runtime!==runtime||!Number.isInteger(t.segment)||t.segment<0||t.segment>1e9||!finite(t.lastSampleAt,-1)||!Number.isInteger(t.droppedSamples)||t.droppedSamples<0||!Number.isInteger(t.droppedEvents)||t.droppedEvents<0||!Array.isArray(t.samples)||t.samples.length>MAX_SAMPLES||!Array.isArray(t.events)||t.events.length>MAX_EVENTS)return fresh(storyKey,runtime)
    const common=(v:TraceSample|TraceEvent)=>v&&Number.isInteger(v.segment)&&v.segment>=0&&v.segment<=t.segment&&text(v.levelId)&&finite(v.sim,0)&&finite(v.x)&&finite(v.y)
    if(!t.samples.every(s=>common(s)&&finite(s.vx)&&finite(s.vy)&&finite(s.health,0)&&typeof s.onGround==='boolean'&&(s.characterId===undefined||text(s.characterId)))||!t.events.every(e=>common(e)&&['level-start','retry','restore','jump','death','boss-stage','checkpoint','character'].includes(e.kind)&&(e.target===undefined||text(e.target))&&(e.phase===undefined||text(e.phase,80))&&(e.stage===undefined||Number.isInteger(e.stage)&&e.stage>=0&&e.stage<16)))return fresh(storyKey,runtime)
    // Return copies: a consumer cannot retain aliases to the active recorder.
    return {...t,samples:t.samples.map(s=>({...s})),events:t.events.map(e=>({...e}))}
  }
  function event(t:PlaytestTrace,e:Omit<TraceEvent,'segment'>) { t.events.push({...e,segment:t.segment});if(t.events.length>MAX_EVENTS){t.events.shift();t.droppedEvents++} }
  function begin(t:PlaytestTrace,e:Omit<TraceEvent,'segment'>) { t.segment++;t.lastSampleAt=-1;event(t,e) }
  function sample(t:PlaytestTrace,s:Omit<TraceSample,'segment'>) {
    if(t.lastSampleAt>=0&&s.sim-t.lastSampleAt<100)return
    t.lastSampleAt=s.sim;t.samples.push({...s,segment:t.segment})
    if(t.samples.length>MAX_SAMPLES){t.samples.shift();t.droppedSamples++}
  }
  return { fresh,restore,event,begin,sample }
}
export const playtestTraceRules=createPlaytestTraceRules()
export function offlinePlaytestTraceSource(){return `const playtestTraceRules=(${createPlaytestTraceRules.toString()})();`}
