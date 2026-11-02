/* PIXEL_WORLD_SPATIAL_RUNTIME_V1
 * Dependency-free WebGL / WebXR player shared by the studio and offline exports.
 * Project input is data only. No eval, external assets, network, or parent access.
 */
(() => {
  'use strict';
  const project = JSON.parse(document.getElementById('spatial-project').textContent);
  const $ = id => document.getElementById(id);
  const canvas = $('world'), overlay = $('overlay'), startButton = $('start');
  const isRhythm = project.genre === 'rhythm';
  const feedback = {effects:.7,hitVolume:.8,musicVolume:.55,shake:false,...project.rhythm.feedback};
  const reducedMotion = typeof window.matchMedia==='function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.body?.classList?.toggle('rhythm-mode',isRhythm);
  $('rhythm-hud').hidden=!isRhythm;
  const help = isRhythm
    ? 'D / F / J / K 击打；长条持续按住，双押同时按两轨。也可用下方触控键。'
    : 'WASD 移动，鼠标拖动 / 点击锁定视角，方向键转向。收集水晶后走进传送门。';
  $('title').textContent = project.title;
  $('overlay-title').textContent = project.title;
  $('description').textContent = help + (isRhythm ? ' 音乐为程序合成旋律。' : '');
  $('help').textContent = help;
  $('touch').className = isRhythm ? '' : 'explore';

  const gl = canvas.getContext('webgl', { antialias: true, alpha: false, xrCompatible: true });
  if (!gl) {
    $('description').textContent = '当前浏览器没有可用的 WebGL。请开启硬件加速，或换用支持 WebGL 的浏览器。';
    startButton.disabled = true; $('vr').textContent = 'VR 不可用'; return;
  }
  const identity = () => new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
  const multiply = (a, b) => {
    const out = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    }
    return out;
  };
  const translation = (x, y, z) => { const m = identity(); m[12] = x; m[13] = y; m[14] = z; return m; };
  const rotationY = a => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]); };
  const rotationX = a => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]); };
  const modelMatrix = (x,y,z,sx,sy,sz,ry,rz) => {
    const c = Math.cos(rz || 0), s = Math.sin(rz || 0);
    const scale = new Float32Array([c*sx,s*sx,0,0, -s*sy,c*sy,0,0, 0,0,sz,0, 0,0,0,1]);
    return multiply(translation(x,y,z), multiply(rotationY(ry || 0), scale));
  };
  const perspective = aspect => {
    const f = 1 / Math.tan(65 * Math.PI / 360), near = 0.08, far = 100;
    return new Float32Array([f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)/(near-far),-1, 0,0,2*far*near/(near-far),0]);
  };
  const transformPoint = (m, p) => [m[0]*p.x+m[4]*p.y+m[8]*p.z+m[12], m[1]*p.x+m[5]*p.y+m[9]*p.z+m[13], m[2]*p.x+m[6]*p.y+m[10]*p.z+m[14]];
  const color = hex => [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)/255);
  const THEMES = {
    forest: { sky:'#b9d9c9', ground:'#6b9c78', leaf:'#37745a', light:'#8cb77c', rock:'#98aaa0', accent:'#f4d876' },
    desert: { sky:'#f1c6a0', ground:'#c88c64', leaf:'#6d8a68', light:'#d8a177', rock:'#a36c5b', accent:'#90f4ce' },
    night: { sky:'#152e42', ground:'#263d4b', leaf:'#476c80', light:'#668d9b', rock:'#456073', accent:'#8fffe0' },
    snow: { sky:'#c8e2ea', ground:'#e3eff0', leaf:'#537f85', light:'#b1d1d1', rock:'#93b4c3', accent:'#eeba6d' },
  };
  const baseTheme = THEMES[project.environment] || THEMES.forest;
  const theme = isRhythm?{...baseTheme,ground:'#10232d',rock:'#29414d',leaf:'#244a45',light:'#3a6872'}:baseTheme;
  const skyColor = color(isRhythm?'#071523':theme.sky);
  const compile = (type, source) => {
    const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('WebGL shader compilation failed');
    return shader;
  };
  let program;
  try {
    program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, `
      attribute vec3 aPosition; attribute vec3 aNormal; attribute vec2 aUv;
      uniform mat4 uModel; uniform mat4 uViewProjection;
      varying vec3 vNormal; varying vec3 vWorld; varying vec2 vUv;
      void main(){vec4 p=uModel*vec4(aPosition,1.0);vWorld=p.xyz;vNormal=mat3(uModel)*aNormal;vUv=aUv;gl_Position=uViewProjection*p;}`));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, `
      precision mediump float;
      uniform vec3 uColor; uniform vec3 uSky; uniform vec3 uEye;
      uniform float uEmissive; uniform bool uTextured; uniform sampler2D uTexture;
      varying vec3 vNormal; varying vec3 vWorld; varying vec2 vUv;
      void main(){float light=mix(0.58+max(dot(normalize(vNormal),normalize(vec3(-0.4,0.9,0.5))),0.0)*0.42,1.0,uEmissive);
      vec4 base=uTextured?texture2D(uTexture,vUv):vec4(uColor,1.0);
      float fog=min(0.85,smoothstep(12.0,65.0,distance(vWorld,uEye)));
      gl_FragColor=vec4(mix(base.rgb*light,uSky,fog),base.a);}`));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('WebGL link failed');
  } catch {
    $('description').textContent = '3D 着色器未能启动。请更新浏览器或开启硬件加速。';
    startButton.disabled = true; return;
  }
  gl.useProgram(program);
  const locations = {};
  for (const key of ['uModel','uViewProjection','uColor','uSky','uEye','uEmissive','uTextured','uTexture']) locations[key] = gl.getUniformLocation(program,key);
  const attributes = ['aPosition','aNormal','aUv'].map(key => gl.getAttribLocation(program,key));
  const faces = [
    [[0,0,1],[-.5,-.5,.5],[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5]],
    [[0,0,-1],[.5,-.5,-.5],[-.5,-.5,-.5],[-.5,.5,-.5],[.5,.5,-.5]],
    [[1,0,0],[.5,-.5,.5],[.5,-.5,-.5],[.5,.5,-.5],[.5,.5,.5]],
    [[-1,0,0],[-.5,-.5,-.5],[-.5,-.5,.5],[-.5,.5,.5],[-.5,.5,-.5]],
    [[0,1,0],[-.5,.5,.5],[.5,.5,.5],[.5,.5,-.5],[-.5,.5,-.5]],
    [[0,-1,0],[-.5,-.5,-.5],[.5,-.5,-.5],[.5,-.5,.5],[-.5,-.5,.5]],
  ];
  const vertices = [];
  for (const face of faces) for (const i of [0,1,2,0,2,3]) vertices.push(...face[i+1],...face[0],...[[0,0],[1,0],[1,1],[0,1]][i]);
  const cubeBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,cubeBuffer); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.STATIC_DRAW);
  const quadBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,quadBuffer); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices.slice(0,48)),gl.STATIC_DRAW);
  const bind = buffer => {
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    attributes.forEach((location,index) => { gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location,index===2?2:3,gl.FLOAT,false,32,index===0?0:index===1?12:24); });
  };
  const cachedColors = new Map();
  const draw = (x,y,z,sx,sy,sz,hex,ry=0,rz=0,emissive=false) => {
    if (!cachedColors.has(hex)) cachedColors.set(hex,color(hex));
    bind(cubeBuffer);
    gl.uniformMatrix4fv(locations.uModel,false,modelMatrix(x,y,z,sx,sy,sz,ry,rz));
    gl.uniform3fv(locations.uColor,cachedColors.get(hex));
    gl.uniform1f(locations.uEmissive,emissive?1:0); gl.uniform1i(locations.uTextured,0);
    gl.drawArrays(gl.TRIANGLES,0,36);
  };
  gl.enable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
  gl.uniform3fv(locations.uSky,skyColor);

  let randomState = project.seed;
  const random = () => { randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5; return (randomState >>> 0)/4294967296; };
  const half = project.arenaSize/2;
  const exit = {x:0,z:-half+3};
  const crystals = Array.from({length:project.goalCount},(_,i) => {
    const angle = i/project.goalCount*Math.PI*2 + .3;
    const radius = (half-5) * (.55+random()*.4);
    return {x:Math.sin(angle)*radius,z:Math.cos(angle)*radius-1,collected:false};
  });
  const decorations = [];
  for (let attempt = 0; decorations.length < project.decorationCount && attempt < 1000; attempt++) {
    const x = (random()*2-1)*(half-2), z = (random()*2-1)*(half-2), scale = .7+random()*.7;
    if (Math.abs(x)<1.8 || Math.hypot(x,z-8)<2.5 || crystals.some(c=>Math.hypot(x-c.x,z-c.z)<2) || decorations.some(c=>Math.hypot(x-c.x,z-c.z)<2)) continue;
    decorations.push({x,z,scale,kind:random()>.3?'tree':'rock'});
  }
  const laneX = [-1.2,-.4,.4,1.2], hitZ = 6, hitY = .12;
  const legacyNotes = Array.from({length:project.rhythm.bars*4},(_,i)=>({time:2+i*60/project.rhythm.bpm,lane:Math.floor(random()*4)}));
  const rhythm = isRhythm?createRhythmEngine(project.rhythm,project.seed,legacyNotes):null;
  const notes = rhythm?rhythm.notes:[];
  const trackEnd = rhythm?rhythm.endTime:0;
  const player = {x:0,z:isRhythm?11:8,yaw:0,pitch:isRhythm?-.30:-.08};
  const keys = new Set();
  const laneInputs=[new Set(),new Set(),new Set(),new Set()];
  let playing = false, won = false, disposed = false, starting = false;
  let score = 0, combo = 0, hits = 0, elapsed = 0, nextBeat = 0, nextMelody = 0;
  let audio = null, audioStartedAt = 0;
  let musicBus=null,hitBus=null;
  const laneColors=['#6ce5e8','#bba1ff','#ffcf75','#ff8db7'],laneFlashes=[-99,-99,-99,-99],laneGrades=['','','',''],sparks=[];
  let lastJudge=null,lastAccent=null,rhythmStats=rhythm?.stats();
  const oscillators = new Set();
  let xrSession = null, xrReference = null, xrLocalHeight = 0, snapHeld = false, xrHands = [];
  let desktopLast = 0, xrLast = 0, animationId = 0, lastHud = '', diagnosticsLast = -1;

  const time = () => elapsed + (playing && audio && audio.state === 'running' ? audio.currentTime-audioStartedAt : 0);
  const chartTime = () => time()+project.rhythm.offsetMs/1000;
  const tone = (frequency, when, duration=.12, volume=.06, bus='hit',wave='triangle') => {
    if (!audio || audio.state !== 'running') return;
    const oscillator = audio.createOscillator(), gain = audio.createGain();
    oscillator.type = wave; oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(.0001,when); gain.gain.exponentialRampToValueAtTime(volume,when+.008); gain.gain.exponentialRampToValueAtTime(.0001,when+duration);
    oscillator.connect(gain); gain.connect((bus==='music'?musicBus:hitBus)||audio.destination);
    oscillators.add(oscillator); oscillator.onended=()=>{oscillators.delete(oscillator);oscillator.disconnect();gain.disconnect();};
    oscillator.start(when); oscillator.stop(when+duration+.02);
  };
  const stopSounds = () => { for (const oscillator of oscillators) { try { oscillator.stop(); } catch {} } oscillators.clear(); };
  const audioReady = async () => {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) throw new Error('浏览器不支持音频播放。');
    if (!audio) {
      audio = new Audio({latencyHint:'interactive'});
      musicBus=audio.createGain();hitBus=audio.createGain();
      musicBus.gain.setValueAtTime(isRhythm?feedback.musicVolume:.55,audio.currentTime);
      hitBus.gain.setValueAtTime(isRhythm?feedback.hitVolume:.8,audio.currentTime);
      musicBus.connect(audio.destination);hitBus.connect(audio.destination);
      audio.onstatechange = () => { if (audio.state !== 'running' && playing) pauseGame(); };
    }
    await audio.resume();
    if (audio.state !== 'running') throw new Error('请允许浏览器播放音频后再试。');
  };
  const updateOverlay = () => {
    overlay.style.display = playing || xrSession ? 'none' : 'grid';
    startButton.textContent = won ? '再玩一次' : elapsed > 0 ? '继续试玩' : '开始试玩';
    $('pause').textContent = playing ? '暂停' : '继续';
    if (won) {
      const result=rhythm?.stats(),rank=result?(result.accuracy>=95?'S':result.accuracy>=85?'A':result.accuracy>=70?'B':result.accuracy>=60?'C':'D'):'';
      $('overlay-title').textContent = isRhythm ? `${rank} · 演奏结束` : '世界已点亮';
      $('description').textContent = isRhythm ? `得分 ${score} · 准确率 ${result.accuracy.toFixed(1)}% · 最大连击 ${result.maxCombo}。${result.accuracy>=60?'完成演奏！':'继续练习，跟随重音再来一次。'}` : '水晶已全部收集，传送门开启。你完成了这个世界！';
      $('rhythm-results').hidden=!isRhythm;
      if(result)$('rhythm-results').textContent=`PERFECT ${result.perfect}   GOOD ${result.good}   MISS ${result.misses}\n长按完成 ${result.holdsCompleted}   双押完成 ${result.chordHits}   空击 ${result.ghosts}`;
    }
  };
  function pauseGame() {
    if (playing) elapsed = time();
    playing = false; keys.clear(); stopSounds();
    laneInputs.forEach(inputs=>inputs.clear());
    rhythm?.suspend();
    if (audio && audio.state==='running') void audio.suspend().catch(()=>{});
    if (document.pointerLockElement===canvas) document.exitPointerLock();
    updateOverlay();
  }
  function resetGame() {
    pauseGame(); won=false; score=0; combo=0; hits=0; elapsed=0; nextBeat=0;nextMelody=0;
    player.x=0; player.z=isRhythm?11:8; player.yaw=0; player.pitch=isRhythm?-.30:-.08;
    crystals.forEach(c=>c.collected=false);rhythm?.reset();rhythmStats=rhythm?.stats();
    sparks.length=0;laneFlashes.fill(-99);laneGrades.fill('');lastJudge=null;lastAccent=null;$('rhythm-results').hidden=true;
    $('overlay-title').textContent=project.title; $('description').textContent=help;
    updateOverlay();
  }
  async function startGame() {
    if (starting || disposed || playing) return;
    if (won) resetGame();
    starting = true;
    try {
      await audioReady();
      if (disposed) return;
      audioStartedAt=audio.currentTime; nextBeat=Math.max(0,Math.ceil((elapsed-2)*project.rhythm.bpm/60));
      nextMelody=notes.findIndex(n=>n.time>=elapsed-.01);if(nextMelody<0)nextMelody=notes.length;
      rhythm?.resume(chartTime());
      playing=true; canvas.focus(); updateOverlay();
    } catch (error) { $('description').textContent=error.message; }
    finally { starting=false; }
  }
  const finish = () => { won=true; pauseGame(); };
  const syncRhythm = () => {
    if(!rhythm)return;
    rhythmStats=rhythm.stats();score=rhythmStats.score;hits=rhythmStats.hits;combo=rhythmStats.combo;
    for(const event of rhythm.drainEvents()){
      if(event.type==='milestone'||event.type==='chord'){lastAccent={...event,label:event.type==='chord'?'DOUBLE':`${event.combo} COMBO`};continue;}
      if(event.type==='resume')continue;
      lastJudge=event;laneFlashes[event.lane]=event.time;laneGrades[event.lane]=event.type==='ghost'?'ghost':event.grade;
      if(event.grade && event.grade!=='miss'){
        tone(1450+event.lane*150,audio.currentTime,.025,.022,'hit','square');
        tone(event.phase==='tail'?660:180+event.lane*28,audio.currentTime,event.phase==='tail'?.12:.07,.09,'hit','sine');
        if(!reducedMotion && feedback.effects>0)for(let i=0;i<Math.ceil(7*feedback.effects);i++){
          if(sparks.length>=140)sparks.shift();const angle=(i+event.lane*.4)*2.399;
          sparks.push({x:laneX[event.lane],z:hitZ,t:event.time,vx:Math.cos(angle)*2.3,vy:1.4+(i%3)*.5,vz:Math.sin(angle)*1.8,color:laneColors[event.lane]});
        }
      }else if(event.type==='judge')tone(85,audio.currentTime,.04,.025,'hit','sine');
    }
  };
  const hitLane = lane => {if(!playing||!rhythm)return;rhythm.press(lane,chartTime());syncRhythm();};
  const releaseLane = lane => {if(!playing||!rhythm)return;rhythm.release(lane,chartTime());syncRhythm();};
  const pressSource=(lane,source)=>{if(!playing||!rhythm)return;const inputs=laneInputs[lane];if(inputs.has(source))return;const empty=!inputs.size;inputs.add(source);if(empty)hitLane(lane);};
  const releaseSource=(lane,source)=>{const inputs=laneInputs[lane];if(!inputs.delete(source))return;if(!inputs.size)releaseLane(lane);};
  const canMove = (x,z) => Math.abs(x)<half-.7&&Math.abs(z)<half-.7&&!decorations.some(d=>Math.hypot(x-d.x,z-d.z)<(d.kind==='rock'?.85:.6)*d.scale);
  const move = (forward,strafe,dt) => {
    const length=Math.max(1,Math.hypot(forward,strafe)), step=project.playerSpeed*dt/length;
    const dx=(-Math.sin(player.yaw)*forward+Math.cos(player.yaw)*strafe)*step;
    const dz=(-Math.cos(player.yaw)*forward-Math.sin(player.yaw)*strafe)*step;
    if(canMove(player.x+dx,player.z))player.x+=dx;
    if(canMove(player.x,player.z+dz))player.z+=dz;
  };
  const rigMatrix = () => multiply(translation(player.x,xrLocalHeight,player.z),rotationY(player.yaw));
  const xrControls = dt => {
    if (!xrSession || !playing) return;
    let snapped=false;
    for (const source of xrSession.inputSources) {
      const axes=source.gamepad?.axes;
      if(!axes)continue;
      const offset=axes.length>=4?2:0,x=axes[offset]||0,y=axes[offset+1]||0;
      if(!isRhythm&&source.handedness==='left') move(Math.abs(y)>.2?-y:0,Math.abs(x)>.2?x:0,dt);
      if(!isRhythm&&source.handedness==='right'&&Math.abs(x)>.6){if(!snapHeld)player.yaw-=Math.sign(x)*Math.PI/6;snapped=true;}
    }
    snapHeld=snapped;
  };
  const update = (dt, head) => {
    if(!playing)return;
    if(isRhythm){
      const clock=chartTime(),now=time();
      const beat=60/project.rhythm.bpm;
      while(nextBeat<project.rhythm.bars*4 && 2+nextBeat*beat<now+.14){
        const due=2+nextBeat*beat-now;
        if(due>=0){
          const at=audio.currentTime+due;
          tone(nextBeat%4===0?65:82,at,.13,nextBeat%4===0?.12:.075,'music','sine');
          tone(1800,at,.018,.013,'music','square');
          if(nextBeat%4===0){tone(130.81,at,beat*2.7,.035,'music','triangle');tone(196,at,beat*2.7,.02,'music','sine');}
        }
        nextBeat++;
      }
      while(nextMelody<notes.length&&notes[nextMelody].time<now+.14){const note=notes[nextMelody],due=note.time-now;if(due>=0)tone([261.63,329.63,392,523.25][note.lane],audio.currentTime+due,note.kind==='hold'?Math.min(.55,note.end-note.time):.14,.035,'music','triangle');nextMelody++;}
      rhythm.update(clock);syncRhythm();
      for(const hand of xrHands){for(const note of notes){if(note.state!=='pending'||Math.abs(note.time-clock)>.16)continue;const z=hitZ-(note.time-clock)*6;if(Math.hypot(hand[0]-laneX[note.lane],hand[1]-hitY,hand[2]-z)<.34)hitLane(note.lane);}}
      if(now>trackEnd+Math.abs(project.rhythm.offsetMs)/1000)finish();
    }else{
      if(!xrSession){
        const forward=Number(keys.has('w')||keys.has('arrowup'))-Number(keys.has('s')||keys.has('arrowdown'));
        const strafe=Number(keys.has('d'))-Number(keys.has('a'));
        player.yaw+=(Number(keys.has('arrowleft'))-Number(keys.has('arrowright')))*1.5*dt;
        move(forward,strafe,dt);
      }
      const p=head||[player.x,1.65,player.z];
      for(const crystal of crystals){if(!crystal.collected&&Math.hypot(p[0]-crystal.x,p[2]-crystal.z)<1.05){crystal.collected=true;score++;tone(523.25+score*55,audio.currentTime,.18,.07);}}
      if(score===crystals.length&&Math.hypot(p[0]-exit.x,p[2]-exit.z)<1.35)finish();
    }
  };

  const hudCanvas=document.createElement('canvas');hudCanvas.width=768;hudCanvas.height=128;
  const hudContext=hudCanvas.getContext('2d');
  const hudTexture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,hudTexture);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  const hudText=()=>isRhythm?`${score} 分  ·  连击 ${combo}  ·  命中 ${hits}/${rhythm.total}`:`水晶 ${score}/${crystals.length}  ·  ${score===crystals.length?'前往发光传送门':'探索四周，寻找金色水晶'}`;
  const feedbackFrame=()=>{
    if(!rhythm)return;const clock=chartTime(),intensity=feedback.effects;
    const age=lastJudge?clock-lastJudge.time:99,good=lastJudge&&lastJudge.grade!=='miss'&&lastJudge.type!=='ghost';
    const grade=lastJudge?.type==='ghost'?'ghost':lastJudge?.grade||'';
    $('rhythm-judge').textContent=grade==='perfect'?'PERFECT':grade==='good'?'GOOD':grade==='miss'?'MISS':grade==='ghost'?'空击':'';
    $('rhythm-judge').dataset.grade=grade;
    $('rhythm-judge').style.opacity=age<.65?'1':'0';
    $('rhythm-judge').style.transform=`scale(${1+(reducedMotion?0:Math.max(0,1-age/.16)*.10*intensity)})`;
    $('rhythm-timing').textContent=age<.65&&good?(lastJudge.kind==='hold'&&lastJudge.phase==='tail'?'HOLD COMPLETE':`${lastJudge.errorMs<0?'EARLY':lastJudge.errorMs>0?'LATE':'ON TIME'} ${Math.abs(lastJudge.errorMs||0).toFixed(0)}ms`):'';
    $('rhythm-combo').textContent=combo>1?`${combo} COMBO`:'';
    $('rhythm-combo').dataset.flow=rhythmStats.energy>=80?'true':'false';
    $('rhythm-energy-fill').style.width=`${rhythmStats.energy}%`;
    $('rhythm-accuracy').textContent=`${rhythmStats.accuracy.toFixed(1)}%`;
    $('rhythm-pattern').textContent=project.rhythm.chartVersion===2?'TAP · HOLD · DOUBLE':'CLASSIC TAP';
    $('rhythm-accent').textContent=lastAccent&&clock-lastAccent.time<.65?lastAccent.label:'';
    canvas.style.transform=feedback.shake&&!reducedMotion&&good&&age<.09?`translateX(${Math.sin(age*150)*2*intensity}px)`:'none';
    for(let i=0;i<4;i++){const button=$(`lane-${i}`);if(button){button.dataset.active=rhythm.isDown(i)?'true':'false';button.dataset.holding=notes.some(n=>n.lane===i&&n.state==='holding')?'true':'false';button.dataset.flash=clock-laneFlashes[i]<.12?'true':'false';button.dataset.grade=clock-laneFlashes[i]<.2?laneGrades[i]:'';}}
    canvas.dataset.judgment=grade;canvas.dataset.combo=String(combo);canvas.dataset.accuracy=rhythmStats.accuracy.toFixed(1);
    canvas.dataset.holdsCompleted=String(rhythmStats.holdsCompleted||0);canvas.dataset.chords=String(rhythmStats.chordHits||0);canvas.dataset.ghosts=String(rhythmStats.ghosts);
  };
  const refreshHud=()=>{
    const diagnosticTime=time();
    if(Math.abs(diagnosticTime-diagnosticsLast)>.1 || canvas.dataset.state!==(playing?'playing':'paused')){
      diagnosticsLast=diagnosticTime;
      canvas.dataset.time=diagnosticTime.toFixed(3);canvas.dataset.state=playing?'playing':'paused';
      canvas.dataset.audio=audio?audio.state:'not-started';
      canvas.dataset.playerX=player.x.toFixed(3);canvas.dataset.playerZ=player.z.toFixed(3);
    }
    const label=hudText()+(won?'  / 完成 · 点击重玩':!playing?'  / 点击开始或继续':'');
    feedbackFrame();
    if(label===lastHud)return;lastHud=label;
    $('score').textContent=hudText();
    hudContext.fillStyle='#102a2c';hudContext.fillRect(0,0,768,128);
    hudContext.fillStyle='#c9f1d1';hudContext.font='bold 27px sans-serif';hudContext.textAlign='center';
    hudContext.fillText(project.title,384,44,720);hudContext.fillStyle='#ffffff';hudContext.font='22px sans-serif';hudContext.fillText(label,384,89,720);
    gl.bindTexture(gl.TEXTURE_2D,hudTexture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,hudCanvas);
  };
  const scene = (vp, eye, clock) => {
    gl.uniformMatrix4fv(locations.uViewProjection,false,vp);gl.uniform3fv(locations.uEye,eye);
    draw(0,-.3,0,project.arenaSize,.6,project.arenaSize,theme.ground);
    for(const side of [-1,1]){
      draw(side*half,.15,0,.3,.3,project.arenaSize,theme.rock);
      draw(0,.15,side*half,project.arenaSize,.3,.3,theme.rock);
      for(const z of [-half,half])draw(side*(half-.6),.7,z-side*.1,.7,1.4,.7,theme.rock);
    }
    for(const d of decorations){
      const s=d.scale;
      if(d.kind==='rock')draw(d.x,.45*s,d.z,1.25*s,.9*s,s,theme.rock,d.x);
      else{
        draw(d.x,.9*s,d.z,.3*s,1.8*s,.3*s,project.environment==='desert'?'#755640':'#655c45');
        draw(d.x,2*s,d.z,1.6*s,1.5*s,1.6*s,theme.leaf,.25);
        draw(d.x,2.8*s,d.z,1.05*s,.8*s,1.05*s,theme.light,-.12);
      }
    }
    if(isRhythm){
      const energy=rhythmStats?.energy||0,beat=60/project.rhythm.bpm;
      const pulse=reducedMotion?0:Math.max(0,1-((Math.max(0,clock-2)/beat)%1)*4)*feedback.effects;
      draw(0,-.06,-2,3.8,.1,25,'#0b202c');
      for(let lane=0;lane<4;lane++){
        const active=rhythm.isDown(lane),flash=Math.max(0,1-(clock-laneFlashes[lane])/.24)*feedback.effects,negative=['miss','ghost'].includes(laneGrades[lane]),flashColor=negative?'#ff7995':laneColors[lane];
        draw(laneX[lane],.015,-3,.73,.03,23,lane%2?'#182534':'#122334');
        draw(laneX[lane]-.38,.045,-3,.018,.02,23,laneColors[lane],0,0,true);
        draw(laneX[lane],hitY,hitZ,.66,.035,.25,laneColors[lane],0,0,true);
        if(active||flash>.1)draw(laneX[lane],hitY+.025,hitZ,.70,.035,.38+flash*.35,active&&!negative?'#efffff':flashColor,0,0,true);
      }
      for(let step=0;step<12;step++)draw(0,.04,hitZ-((clock*3+step*2)%24),3.2,.012,.018,'#2a4556',0,0,true);
      for(const side of [-1,1]){draw(side*2.05,.08,-3,.04,.03,24,'#4b7182',0,0,true);for(let bar=0;bar<6;bar++)draw(side*2.8,.25+energy*.006+pulse*.20,-bar*3,.10,.5+energy*.012+pulse*.4,.13,laneColors[bar%4],0,0,true);}
      for(const note of notes){
        const delta=note.time-clock;
        if(['complete','miss','broken'].includes(note.state)||delta>3.4)continue;
        const headZ=note.state==='holding'?hitZ:hitZ-delta*6;
        if(note.kind==='hold'){
          const tailZ=hitZ-(note.end-clock)*6,length=Math.max(.05,headZ-tailZ);
          draw(laneX[note.lane],hitY+.035,(headZ+tailZ)/2,note.state==='holding'?.35:.22,.05,length,laneColors[note.lane],0,0,true);
          if(note.state==='holding')draw(laneX[note.lane],hitY+.08,hitZ,.65,.10,.34,'#ffffff',0,0,true);
        }
        draw(laneX[note.lane],hitY+.07,headZ,.60,.10,.24,laneColors[note.lane],0,0,true);
        draw(laneX[note.lane],hitY+.13,headZ,.42,.02,.10,note.chord>=0?'#ffffff':'#d9fffc',0,0,true);
      }
      for(let i=sparks.length-1;i>=0;i--){const p=sparks[i],age=clock-p.t;if(age>.42){sparks.splice(i,1);continue;}if(age<0)continue;const size=.08*(1-age/.42);draw(p.x+p.vx*age,.18+p.vy*age-age*age*2,p.z+p.vz*age,size,size,size,p.color,age*5,age*4,true);}
    }else{
      for(const c of crystals)if(!c.collected){
        draw(c.x,.08,c.z,.8,.12,.8,theme.rock);
        draw(c.x,1+Math.sin(clock*2+c.x)*.13,c.z,.38,.65,.38,theme.accent,clock*.6,Math.PI/4,true);
      }
      const ready=score===crystals.length,gate=ready?theme.accent:theme.rock;
      draw(exit.x-1.1,1.4,exit.z,.4,2.8,.5,gate);draw(exit.x+1.1,1.4,exit.z,.4,2.8,.5,gate);
      draw(exit.x,2.7,exit.z,2.6,.4,.5,gate);
      draw(exit.x,1.3,exit.z,1.8,2.5,.08,ready?'#9ff4d4':theme.leaf,0,0,ready);
      for(let i=0;i<6;i++)draw(0,.025,5-i*2,1,.05,1,theme.light);
    }
    if(xrSession){
      for(const hand of xrHands)draw(hand[0],hand[1],hand[2],.12,.12,.2,theme.accent,player.yaw,0,true);
      bind(quadBuffer);gl.uniformMatrix4fv(locations.uModel,false,modelMatrix(player.x-Math.sin(player.yaw)*3,2.65,player.z-Math.cos(player.yaw)*3,3.5,.58,.01,player.yaw));
      gl.bindTexture(gl.TEXTURE_2D,hudTexture);gl.uniform1i(locations.uTexture,0);gl.uniform1i(locations.uTextured,1);gl.uniform1f(locations.uEmissive,1);gl.drawArrays(gl.TRIANGLES,0,6);
    }
  };
  const clear=()=>{gl.clearColor(...skyColor,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);};
  const renderDesktop = () => {
    const ratio=Math.min(devicePixelRatio||1,1.5),width=Math.max(1,Math.floor(canvas.clientWidth*ratio)),height=Math.max(1,Math.floor(canvas.clientHeight*ratio));
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,width,height);clear();
    const cameraHeight=isRhythm?3.8:1.65;
    const view=multiply(rotationX(-player.pitch),multiply(rotationY(-player.yaw),translation(-player.x,-cameraHeight,-player.z)));
    scene(multiply(perspective(width/height),view),[player.x,cameraHeight,player.z],chartTime());
  };
  const desktopFrame = timestamp => {
    if(disposed)return;
    animationId=requestAnimationFrame(desktopFrame);
    const dt=Math.min(.04,Math.max(0,(timestamp-desktopLast)/1000));desktopLast=timestamp;
    if(xrSession)return;
    update(dt);refreshHud();renderDesktop();
  };
  const xrFrame = (timestamp, frame) => {
    if(!xrSession||disposed)return;
    xrSession.requestAnimationFrame(xrFrame);
    const dt=Math.min(.04,Math.max(0,(timestamp-xrLast)/1000));xrLast=timestamp;
    xrControls(dt);
    const pose=frame.getViewerPose(xrReference);if(!pose)return;
    const rig=rigMatrix();
    const eye=transformPoint(rig,pose.transform.position);
    xrHands=[];
    for(const source of xrSession.inputSources){
      const grip=frame.getPose(source.gripSpace||source.targetRaySpace,xrReference);
      if(grip)xrHands.push(transformPoint(rig,grip.transform.position));
    }
    update(dt,eye);refreshHud();
    const layer=xrSession.renderState.baseLayer;gl.bindFramebuffer(gl.FRAMEBUFFER,layer.framebuffer);clear();
    const inverseRig=multiply(rotationY(-player.yaw),translation(-player.x,-xrLocalHeight,-player.z));
    for(const view of pose.views){
      const viewport=layer.getViewport(view);gl.viewport(viewport.x,viewport.y,viewport.width,viewport.height);
      scene(multiply(view.projectionMatrix,multiply(view.transform.inverse.matrix,inverseRig)),transformPoint(rig,view.transform.position),chartTime());
    }
  };

  let vrStarting=false;
  $('vr').addEventListener('click',async()=>{
    if(vrStarting||xrSession||disposed)return;vrStarting=true;
    let session;
    try{
      const audioPromise=audioReady().then(()=>null,error=>error);
      session=await navigator.xr.requestSession('immersive-vr',{optionalFeatures:['local-floor']});
      const audioError=await audioPromise;if(audioError)throw audioError;
      if(disposed){await session.end();return;}
      await gl.makeXRCompatible();
      session.updateRenderState({baseLayer:new XRWebGLLayer(session,gl)});
      try{xrReference=await session.requestReferenceSpace('local-floor');xrLocalHeight=0;}
      catch{xrReference=await session.requestReferenceSpace('local');xrLocalHeight=1.65;}
      pauseGame();xrSession=session;xrLast=0;snapHeld=false;
      session.addEventListener('end',()=>{xrSession=null;xrHands=[];pauseGame();$('vr').disabled=false;});
      session.addEventListener('visibilitychange',()=>{if(session.visibilityState!=='visible')pauseGame();});
      session.addEventListener('select',()=>{if(!playing)void startGame();});
      $('vr').disabled=true;updateOverlay();session.requestAnimationFrame(xrFrame);
    }catch{
      if(session){try{await session.end();}catch{}}
      $('help').textContent='VR 未能启动。请检查 HTTPS、头显连接与浏览器的沉浸式 VR 权限。';
    }finally{vrStarting=false;}
  });
  async function checkVR(){
    const button=$('vr');
    if(!window.isSecureContext){button.textContent='VR 需要 HTTPS';return;}
    if(!navigator.xr){button.textContent='当前浏览器不支持 VR';return;}
    try{const supported=await navigator.xr.isSessionSupported('immersive-vr');if(disposed)return;button.disabled=!supported;button.textContent=supported?'进入 VR':'未检测到可用 VR 头显';}
    catch{button.textContent='VR 权限不可用';}
  }
  startButton.addEventListener('click',()=>void startGame());
  $('pause').addEventListener('click',()=>{if(playing)pauseGame();else void startGame();});
  $('reset').addEventListener('click',()=>{resetGame();void startGame();});
  const captureButton=document.createElement('button');captureButton.type='button';captureButton.textContent='场景截图';captureButton.addEventListener('click',()=>{
    if(xrSession)return;renderDesktop();document.getElementById('scene-snapshot')?.remove();const link=document.createElement('a');link.id='scene-snapshot';link.href=canvas.toDataURL('image/png');link.download=project.title.replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g,'_')+'_场景截图.png';link.textContent='保存截图';link.style.color='#c9f1d1';document.querySelector('.actions').appendChild(link);
  });document.querySelector('.actions').appendChild(captureButton);
  $('fullscreen').addEventListener('click',()=>{const action=document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();action.catch(()=>{$('help').textContent='浏览器未允许全屏，仍可在当前窗口试玩。';});});
  const keyLanes=['d','f','j','k'];
  window.addEventListener('keydown',event=>{
    const key=event.key.toLowerCase();
    canvas.dataset.lastKey=key;
    if(['w','a','s','d','f','j','k','arrowup','arrowdown','arrowleft','arrowright',' '].includes(key))event.preventDefault();
    if(key==='escape'&&!xrSession){pauseGame();return;}
    keys.add(key);
    if(isRhythm&&!event.repeat&&keyLanes.includes(key))pressSource(keyLanes.indexOf(key),'keyboard');
  });
  window.addEventListener('keyup',event=>{const key=event.key.toLowerCase();keys.delete(key);if(isRhythm&&keyLanes.includes(key))releaseSource(keyLanes.indexOf(key),'keyboard');});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseGame();});
  window.addEventListener('blur',()=>{if(!xrSession)pauseGame();});
  canvas.addEventListener('click',()=>{
    if(!playing||isRhythm||xrSession||!matchMedia('(pointer:fine)').matches)return;
    try{const lock=canvas.requestPointerLock();if(lock&&lock.catch)lock.catch(()=>{$('help').textContent='按住鼠标拖动视角，WASD 移动。';});}catch{}
  });
  document.addEventListener('pointerlockchange',()=>{if(document.pointerLockElement!==canvas&&playing&&!isRhythm&&!xrSession)pauseGame();});
  document.addEventListener('mousemove',event=>{
    if(!playing||isRhythm||xrSession)return;
    if(document.pointerLockElement!==canvas&&!(event.buttons===1&&event.target===canvas))return;
    player.yaw-=event.movementX*.003;player.pitch=Math.max(-1.15,Math.min(1.15,player.pitch-event.movementY*.003));
  });
  let touchLook=null;
  canvas.addEventListener('pointerdown',event=>{if(event.pointerType==='touch'){touchLook=[event.clientX,event.clientY];canvas.setPointerCapture(event.pointerId);}});
  canvas.addEventListener('pointermove',event=>{if(!playing||isRhythm||!touchLook)return;player.yaw-=(event.clientX-touchLook[0])*.005;player.pitch=Math.max(-1.15,Math.min(1.15,player.pitch-(event.clientY-touchLook[1])*.005));touchLook=[event.clientX,event.clientY];});
  for(const name of ['pointerup','pointercancel'])canvas.addEventListener(name,()=>{touchLook=null;});
  document.querySelectorAll('[data-move]').forEach(button=>{
    button.addEventListener('pointerdown',event=>{event.preventDefault();button.setPointerCapture(event.pointerId);keys.add(button.dataset.move);});
    for(const name of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(name,()=>keys.delete(button.dataset.move));
  });
  if(isRhythm){
    $('lanes').hidden=false;
    for(let i=0;i<4;i++){
      const button=document.createElement('button');button.id=`lane-${i}`;button.textContent=keyLanes[i].toUpperCase();button.type='button';button.style.setProperty('--lane-color',laneColors[i]);button.setAttribute('aria-label',`击打轨道 ${i+1}`);
      button.addEventListener('pointerdown',event=>{event.preventDefault();button.setPointerCapture(event.pointerId);pressSource(i,`pointer:${event.pointerId}`);});
      for(const name of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(name,event=>releaseSource(i,`pointer:${event.pointerId}`));
      $('lanes').appendChild(button);
    }
  }
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();pauseGame();$('description').textContent='图形上下文已丢失，请重新载入试玩。';startButton.disabled=true;});
  window.addEventListener('pagehide',()=>{disposed=true;cancelAnimationFrame(animationId);stopSounds();if(audio)void audio.close().catch(()=>{});if(xrSession)void xrSession.end().catch(()=>{});});
  // Read-only diagnostics for manual playtest evidence; never used to claim device compatibility.
  window.pixelWorldSpatial={snapshot:()=>({genre:project.genre,playing,won,score,hits,combo,time:time(),rhythm:rhythm?.snapshot(),position:{x:player.x,z:player.z},remaining:crystals.filter(c=>!c.collected).length,xrActive:!!xrSession})};
  updateOverlay();refreshHud();void checkVR();animationId=requestAnimationFrame(desktopFrame);
})();
