/**
 * StudyAI app.js
 * Real activity tracking via ActivityTracker + Classifier + SessionAnalyzer.
 * Zero random/fake data.
 */

/* STATE */
let sessionRunning=false,sessionSeconds=0,sessionInterval=null;
let pomoCount=0,pomoPhase='focus',mlSamples=[],liveDataFocus=[],liveDataAttn=[];
let activityEvents=[],currentPageEvent=null,sessionStartTime=null;
let totalKeystrokes=0,analyticsBuilt=false,liveChart=null,fpsCounter=0;

/* HELPERS */
const $=id=>document.getElementById(id);
const set=(id,v)=>{const e=$(id);if(e)e.textContent=v;};
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const avgArr=arr=>arr.length?arr.reduce((a,b)=>a+b,0)/arr.length:0;
const fmtT=s=>`${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
const fmtM=m=>m>=60?`${Math.floor(m/60)}h ${Math.round(m%60)}m`:Math.round(m)+'m';
const nowTime=()=>new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
function showToast(msg,color){const t=$('toast');if(!t)return;t.textContent=msg;t.style.background=color||'var(--indigo)';t.style.transform='translateY(0)';t.style.opacity='1';setTimeout(()=>{t.style.transform='translateY(60px)';t.style.opacity='0';},3500);}
window.showToast=showToast;

/* NAVIGATION */
function navigate(page){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const pg=$('page-'+page);if(pg)pg.classList.add('active');
  document.querySelector(`[data-page="${page}"]`)?.classList.add('active');
  if(page==='analytics')buildAnalytics();
  if(page==='history')buildHistory();
  if(page==='settings'){renderAppRules();syncSettingsInputs();}
}
document.querySelectorAll('.nav-item').forEach(btn=>btn.addEventListener('click',()=>navigate(btn.dataset.page)));

/* CLOCK */
setInterval(()=>{
  set('clockDisplay',new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'}));
  set('liveDateStr',new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'}));
},1000);

/* ML */
async function bootML(){
  const dot=$('mlDot'),text=$('mlStatusText');
  try{
    await MLEngine.init(msg=>{if(text)text.textContent=msg;});
    if(dot)dot.className='ml-dot ready';
    if(text)text.textContent='✓ Face tracking active · processing local';
    await startCamera();startMLLoop();
    $('startBtn').disabled=false;
    logFeed('ML models loaded','var(--green)','Face tracking ready');
  }catch(e){
    if(dot)dot.className='ml-dot error';
    if(text)text.textContent='Camera unavailable — tab + keystroke tracking still works';
    $('startBtn').disabled=false;
    logFeed('Camera unavailable','var(--amber)','Tab + keystroke tracking active');
  }
}

async function startCamera(){
  const video=$('camVideo');if(!video)return;
  const stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480},facingMode:'user'},audio:false});
  video.srcObject=stream;
  await new Promise(r=>(video.onloadedmetadata=r));
  const canvas=$('camCanvas');if(canvas){canvas.width=video.videoWidth||320;canvas.height=video.videoHeight||240;}
}

function startMLLoop(){
  setInterval(mlTick,200);
  setInterval(()=>{set('camFps',Math.round(fpsCounter*2)+' fps');fpsCounter=0;},500);
}

async function mlTick(){
  fpsCounter++;
  const video=$('camVideo'),canvas=$('camCanvas');
  if(!video||!canvas||!MLEngine.isReady())return;
  const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);
  const m=await MLEngine.analyseFrame(video);
  const noFace=$('camNoFace'),chip=$('camScoreChip');
  if(!m){noFace?.classList.add('visible');chip?.classList.remove('visible');setAttnGauges(null);return;}
  noFace?.classList.remove('visible');chip?.classList.add('visible');
  drawFaceBox(ctx,m.box,m.score10,canvas,video);
  drawEyeDots(ctx,m.landmarks,canvas,video);
  setAttnGauges(m);
  const sv=$('camScoreVal');
  if(sv){sv.textContent=m.score10+'/10';sv.style.color=m.score10>=7?'var(--green)':m.score10>=4?'var(--amber)':'var(--red)';}
  if(sessionRunning){
    mlSamples.push({eyeScore:m.eyeScore,gazeScore:m.gazeScore,poseScore:m.poseScore,exprScore:m.exprScore,composite:m.composite,score10:m.score10,expr:m.dominantExpr});
    liveDataAttn.push(m.composite);if(liveDataAttn.length>90)liveDataAttn.shift();
  }
}

function drawFaceBox(ctx,box,score,canvas,video){
  const sx=canvas.width/(video.videoWidth||320),sy=canvas.height/(video.videoHeight||240);
  const col=score>=7?'#10b981':score>=4?'#f59e0b':'#ef4444';
  const x=canvas.width-(box.x+box.width)*sx,y=box.y*sy,w=box.width*sx,h=box.height*sy,cs=Math.min(w,h)*0.17;
  ctx.strokeStyle=col;ctx.lineWidth=1.5;ctx.globalAlpha=0.8;ctx.beginPath();
  ctx.moveTo(x+cs,y);ctx.lineTo(x,y);ctx.lineTo(x,y+cs);
  ctx.moveTo(x+w-cs,y);ctx.lineTo(x+w,y);ctx.lineTo(x+w,y+cs);
  ctx.moveTo(x,y+h-cs);ctx.lineTo(x,y+h);ctx.lineTo(x+cs,y+h);
  ctx.moveTo(x+w-cs,y+h);ctx.lineTo(x+w,y+h);ctx.lineTo(x+w,y+h-cs);
  ctx.stroke();ctx.globalAlpha=1;ctx.fillStyle=col;ctx.font='bold 10px Inter';
  ctx.fillText(score+'/10',x+4,y-5);
}

function drawEyeDots(ctx,landmarks,canvas,video){
  const sx=canvas.width/(video.videoWidth||320),sy=canvas.height/(video.videoHeight||240);
  ctx.fillStyle='rgba(99,102,241,0.7)';
  [...landmarks.getLeftEye(),...landmarks.getRightEye()].forEach(p=>{ctx.beginPath();ctx.arc(canvas.width-p.x*sx,p.y*sy,1.5,0,Math.PI*2);ctx.fill();});
}

function setAttnGauges(m){
  [['agEye','agEyeVal',m?.eyeScore],['agGaze','agGazeVal',m?.gazeScore],['agPose','agPoseVal',m?.poseScore],['agExpr','agExprVal',m?.exprScore]].forEach(([bid,vid,val])=>{
    const b=$(bid),v=$(vid);
    if(b)b.style.width=(m&&val!=null?val:0)+'%';
    if(v)v.textContent=m&&val!=null?val+'%':'—';
  });
}

/* ACTIVITY TRACKER */
function startActivityTracking(){
  ActivityTracker.start({
    onPageChange(domain,title,_cls){
      if(currentPageEvent){
        currentPageEvent.durationSeconds=Math.round((Date.now()-currentPageEvent.startedAt)/1000);
        activityEvents.push({...currentPageEvent});
      }
      const userRules=Store.rules();
      const cls=Classifier.classify(domain,title,userRules);
      currentPageEvent={domain,title,label:cls.label,reason:cls.reason,startedAt:Date.now(),durationSeconds:0};
      updateActiveWindowUI(domain,title,cls);
      if(sessionRunning){
        logFeed(domain||'Tab change',cls.label==='unprod'?'var(--red)':cls.label==='prod'?'var(--green)':'var(--muted)',
          (title||'').slice(0,55)+'  ·  '+cls.reason);
      }
    },
    onIdleChange(idle,idleSeconds){
      if(!sessionRunning)return;
      if(idle)logFeed('Inactive','var(--amber)',`No input for ${idleSeconds}s`);
      else logFeed('Active again','var(--green)','');
    },
    onKeystroke(total){totalKeystrokes=total;},
  });
}

function updateActiveWindowUI(domain,title,cls){
  const nameEl=$('aaName'),subEl=$('aaPageTitle'),dotEl=$('aaDot'),tagEl=$('aaTag');
  const displayDomain=(domain||'').replace(/^www\./,'')||'—';
  if(nameEl)nameEl.textContent=displayDomain;
  if(subEl)subEl.textContent=title?title.slice(0,70)+(title.length>70?'…':''):'';
  if(dotEl)dotEl.style.background=Classifier.labelColor(cls.label);
  if(tagEl){
    const tc=cls.label==='prod'?'tag-prod':cls.label==='unprod'?'tag-unprod':'tag-neutral';
    tagEl.innerHTML=`<span class="tag ${tc}">${Classifier.labelText(cls.label)}</span><span style="font-size:0.65rem;color:var(--dim);margin-left:6px">${cls.reason}</span>`;
  }
}

/* SESSION CONTROL */
function toggleSession(){
  if(!sessionRunning&&sessionSeconds===0)startSession();
  else if(!sessionRunning)resumeSession();
  else pauseSession();
}
window.toggleSession=toggleSession;

function startSession(){
  sessionRunning=true;sessionSeconds=0;sessionStartTime=new Date().toISOString();
  mlSamples=[];liveDataFocus=[];liveDataAttn=[];activityEvents=[];currentPageEvent=null;totalKeystrokes=0;
  ActivityTracker.reset();
  sessionInterval=setInterval(sessionTick,1000);
  setSessionUI('running');
  logFeed('Session started','var(--green)',$('sessionGoal')?.value.trim()||'No goal set');
  updateTodayStats();
}

function pauseSession(){
  sessionRunning=false;clearInterval(sessionInterval);
  setSessionUI('paused');logFeed('Paused','var(--amber)',fmtT(sessionSeconds)+' elapsed');
}

function resumeSession(){
  sessionRunning=true;sessionInterval=setInterval(sessionTick,1000);
  setSessionUI('running');logFeed('Resumed','var(--green)','');
}

function stopAndSave(){
  if(sessionSeconds<30){showToast('Session too short — keep going!','var(--amber)');return;}
  if(sessionRunning)pauseSession();
  if(currentPageEvent){currentPageEvent.durationSeconds=Math.round((Date.now()-currentPageEvent.startedAt)/1000);activityEvents.push({...currentPageEvent});currentPageEvent=null;}
  const mlAvg=key=>mlSamples.length?Math.round(avgArr(mlSamples.map(m=>m[key]))):null;
  const attnScore=mlSamples.length?Math.round(avgArr(mlSamples.map(m=>m.composite))/10):null;
  const totalAct=activityEvents.reduce((a,e)=>a+(e.durationSeconds||0),0)||sessionSeconds;
  const prodSec=activityEvents.filter(e=>e.label==='prod').reduce((a,e)=>a+(e.durationSeconds||0),0);
  const prodRatio=activityEvents.length?Math.round(prodSec/totalAct*100):null;
  const focusScore=(attnScore!=null&&prodRatio!=null)?Math.min(100,Math.round(attnScore*10*0.6+prodRatio*0.4)):attnScore!=null?attnScore*10:prodRatio;
  const exprFreq={};mlSamples.forEach(m=>{exprFreq[m.expr]=(exprFreq[m.expr]||0)+1;});
  const domExpr=Object.entries(exprFreq).sort((a,b)=>b[1]-a[1])[0]?.[0]||null;
  const sessLabel=Classifier.sessionLabel(activityEvents);
  const domainTime={};activityEvents.forEach(e=>{domainTime[e.domain]=(domainTime[e.domain]||0)+(e.durationSeconds||0);});
  const topDomain=Object.entries(domainTime).sort((a,b)=>b[1]-a[1])[0]?.[0]||ActivityTracker.getCurrentDomain()||null;
  const snap=ActivityTracker.getSnapshot();
  const session={
    timestamp:sessionStartTime||new Date().toISOString(),endTime:new Date().toISOString(),
    goal:$('sessionGoal')?.value.trim()||'',duration:Math.round(sessionSeconds/60),
    focusScore:focusScore!=null?clamp(focusScore,0,100):null,productiveRatio:prodRatio,
    attnScore,avgEye:mlAvg('eyeScore'),avgGaze:mlAvg('gazeScore'),avgPose:mlAvg('poseScore'),avgExpr:mlAvg('exprScore'),dominantExpr:domExpr,
    wpm:null,totalKeys:snap.totalKeystrokes||totalKeystrokes,mouseClicks:null,
    topApp:topDomain,distractions:activityEvents.filter(e=>e.label==='unprod').length,
    pomoCount,sessionLabel:sessLabel,activityLog:activityEvents.slice(0,50),notes:'',
  };
  Store.addSession(session);TrackerBridge.postSession?.(session);
  sessionSeconds=0;pomoCount=0;pomoPhase='focus';mlSamples=[];liveDataFocus=[];liveDataAttn=[];activityEvents=[];totalKeystrokes=0;sessionStartTime=null;
  setSessionUI('idle');updatePomoStrip();updatePhaseUI();
  if(liveChart){liveChart.data.labels=[];liveChart.data.datasets.forEach(d=>d.data=[]);liveChart.update();}
  setAttnGauges(null);setMetrics(null,null,null,null);
  $('activityFeed').innerHTML='';$('sessionGoal').value='';
  updateTodayStats();analyticsBuilt=false;
  const focusStr=focusScore!=null?` Focus: ${focusScore}%`:'';
  showToast(`Saved!${focusStr} · ${Classifier.labelText(sessLabel)}`,'var(--green)');
  logFeed('Session saved ✓','var(--indigo)',`${Math.round(session.duration)}m${focusStr}`);
}
window.stopAndSave=stopAndSave;

function resetSession(){
  if(sessionRunning)pauseSession();
  sessionSeconds=0;pomoCount=0;pomoPhase='focus';mlSamples=[];liveDataFocus=[];liveDataAttn=[];activityEvents=[];totalKeystrokes=0;sessionStartTime=null;
  set('timerNum','00:00:00');$('timerNum')?.classList.remove('live');
  if(liveChart){liveChart.data.labels=[];liveChart.data.datasets.forEach(d=>d.data=[]);liveChart.update();}
  setAttnGauges(null);setMetrics(null,null,null,null);$('activityFeed').innerHTML='';
  setSessionUI('idle');updatePomoStrip();updatePhaseUI();logFeed('Reset','var(--dim)','Ready');
}
window.resetSession=resetSession;

function setSessionUI(state){
  const startBtn=$('startBtn'),stopBtn=$('stopSaveBtn'),tag=$('sessionTag'),rec=$('camBadgeRec'),idle=$('camBadgeIdle'),timer=$('timerNum');
  if(state==='running'){if(startBtn){startBtn.innerHTML='<i class="fas fa-pause"></i> Pause';startBtn.className='btn btn-sm';}if(stopBtn)stopBtn.disabled=false;if(tag){tag.textContent='● LIVE';tag.className='tag tag-live';}timer?.classList.add('live');rec?.classList.add('visible');idle?.classList.add('hidden');}
  else if(state==='paused'){if(startBtn){startBtn.innerHTML='<i class="fas fa-play"></i> Resume';startBtn.className='btn btn-primary';}if(tag){tag.textContent='● PAUSED';tag.className='tag tag-paused';}timer?.classList.remove('live');rec?.classList.remove('visible');idle?.classList.remove('hidden');}
  else{if(startBtn){startBtn.innerHTML='<i class="fas fa-play"></i> Start Session';startBtn.className='btn btn-primary';}if(stopBtn)stopBtn.disabled=true;if(tag){tag.textContent='● IDLE';tag.className='tag tag-idle';}timer?.classList.remove('live');set('timerNum','00:00:00');rec?.classList.remove('visible');idle?.classList.remove('hidden');}
}

/* SESSION TICK */
function sessionTick(){
  sessionSeconds++;set('timerNum',fmtT(sessionSeconds));
  const attnNow=mlSamples.length?mlSamples[mlSamples.length-1].composite:null;
  const totalAct=activityEvents.reduce((a,e)=>a+(e.durationSeconds||0),0)||1;
  const prodNow=activityEvents.length?Math.round(activityEvents.filter(e=>e.label==='prod').reduce((a,e)=>a+(e.durationSeconds||0),0)/totalAct*100):null;
  const focusNow=(attnNow!=null&&prodNow!=null)?Math.round(attnNow*0.6+prodNow*0.4):attnNow!=null?attnNow:prodNow;
  const idleSecs=ActivityTracker.getIdleSeconds();
  const penalty=Math.min(30,idleSecs>10?Math.round((idleSecs-10)*1.5):0);
  const adjFocus=focusNow!=null?Math.max(0,focusNow-penalty):null;
  const snap=ActivityTracker.getSnapshot();
  const keyActivity=snap.totalKeystrokes>0?Math.min(100,snap.totalKeystrokes/(sessionSeconds/60)*2):null;
  setMetrics(adjFocus,prodNow,keyActivity!=null?Math.round(keyActivity):null,attnNow!=null?Math.round(attnNow/10):null);
  if(adjFocus!=null){liveDataFocus.push(adjFocus);if(liveDataFocus.length>90)liveDataFocus.shift();}
  pushLivePoint(adjFocus,attnNow);
  const cfg=Store.settings();
  const phaseSec=pomoPhase==='focus'?cfg.focusDuration*60:pomoPhase==='short'?cfg.shortBreak*60:cfg.longBreak*60;
  if(sessionSeconds%phaseSec===0&&sessionSeconds>0){
    if(pomoPhase==='focus'){pomoCount++;const isLong=pomoCount%(cfg.pomosPerLong||4)===0;pomoPhase=isLong?'long':'short';logFeed(`Pomodoro #${pomoCount}!`,'var(--indigo)',`Take a ${isLong?cfg.longBreak:cfg.shortBreak}min break`);}
    else{pomoPhase='focus';logFeed('Break done','var(--green)','Back to focus');}
    updatePomoStrip();updatePhaseUI();
  }
  if(sessionSeconds%10===0)updateTodayStats();
}

function setMetrics(focus,prod,keys,attn){
  [['smFocus','smFocusBar',focus,focus!=null?Math.round(focus)+'%':'—','var(--indigo)'],
   ['smProd','smProdBar',prod,prod!=null?Math.round(prod)+'%':'—','var(--green)'],
   ['smWpm','smWpmBar',keys,keys!=null?Math.round(keys):'—','var(--blue)'],
   ['smAttn','smAttnBar',attn!=null?attn*10:null,attn!=null?attn+'/10':'—','var(--violet)']
  ].forEach(([vid,bid,pct,display,col])=>{set(vid,display);const b=$(bid);if(b){b.style.width=clamp(pct??0,0,100)+'%';b.style.background=col;}});
}

/* POMODORO */
function updatePomoStrip(){
  const n=Store.settings().pomosPerLong||4,strip=$('pomoStrip');if(!strip)return;
  strip.innerHTML='';
  for(let i=0;i<n;i++){const d=document.createElement('div');d.className='pomo-dot'+(i<pomoCount?' done':i===pomoCount&&sessionRunning?' current':'');strip.appendChild(d);}
  set('pomoLabel',`${pomoCount} / ${n} pomodoros`);
}
function updatePhaseUI(){
  const cfg=Store.settings();
  ['focus','short','long'].forEach(p=>{const el=$('phase-'+p);if(!el)return;el.classList.toggle('active',pomoPhase===p);});
  set('phase-focus-dur',cfg.focusDuration+' min');set('phase-short-dur',cfg.shortBreak+' min');set('phase-long-dur',cfg.longBreak+' min');
}
window.updatePhaseLabels=updatePhaseUI;window.updatePomoStrip=updatePomoStrip;

/* LIVE CHART */
function initLiveChart(){
  const canvas=$('liveChart');if(!canvas)return;
  liveChart=new Chart(canvas.getContext('2d'),{type:'line',data:{labels:[],datasets:[
    {label:'Focus',data:[],borderColor:'rgba(99,102,241,0.9)',backgroundColor:'rgba(99,102,241,0.06)',borderWidth:1.5,fill:true,tension:0.4,pointRadius:0},
    {label:'Attention',data:[],borderColor:'rgba(16,185,129,0.65)',backgroundColor:'transparent',borderWidth:1,fill:false,tension:0.4,pointRadius:0,borderDash:[3,3]},
  ]},options:{responsive:true,maintainAspectRatio:false,animation:{duration:0},plugins:{legend:{display:false},tooltip:{enabled:false}},scales:{x:{display:false},y:{min:0,max:100,grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#52525b',font:{size:9},callback:v=>v+'%'}}}}});
}
function pushLivePoint(focus,attn){
  if(!liveChart||!sessionRunning)return;
  liveChart.data.labels.push('');liveChart.data.datasets[0].data.push(focus);liveChart.data.datasets[1].data.push(attn!=null?Math.round(attn):null);
  if(liveChart.data.labels.length>90){liveChart.data.labels.shift();liveChart.data.datasets.forEach(d=>d.data.shift());}
  liveChart.update('none');
}

/* FEED */
function logFeed(text,color,sub){
  const feed=$('activityFeed');if(!feed)return;
  const div=document.createElement('div');div.className='feed-item';
  div.innerHTML=`<div class="feed-time">${nowTime()}</div><div class="feed-dot" style="background:${color}"></div><div class="feed-text"><div class="feed-app">${text}</div><div class="feed-sub">${sub||''}</div></div>`;
  feed.insertBefore(div,feed.firstChild);while(feed.children.length>25)feed.removeChild(feed.lastChild);
}

/* TODAY STATS */
function updateTodayStats(){
  const today=new Date().toISOString().split('T')[0];
  const ts=Store.getSessions().filter(s=>s.timestamp?.startsWith(today));
  const mins=ts.reduce((a,s)=>a+(s.duration||0),0)+Math.floor(sessionSeconds/60);
  const scores=ts.map(s=>s.focusScore).filter(v=>v!=null);
  const avgF=scores.length?Math.round(avgArr(scores)):null;
  const goal=Store.settings().dailyGoalHours*60;
  const pct=Math.min(100,Math.round(mins/goal*100));
  set('todaySessions',ts.length+(sessionRunning?1:0));set('todayTime',fmtM(mins));
  set('todayScore',avgF!=null?avgF+'%':'—');set('todayGoalPct',pct+'%');
  const bar=$('todayGoalBar');if(bar)bar.style.width=pct+'%';
}

/* ANALYTICS */
function buildAnalytics(){
  if(analyticsBuilt)return;analyticsBuilt=true;
  const sessions=Store.getSessions();
  const wF=sessions.filter(s=>s.focusScore!=null);
  const avgFocus=wF.length?Math.round(avgArr(wF.map(s=>s.focusScore))):null;
  const totalMins=sessions.reduce((a,s)=>a+(s.duration||0),0);
  const aS=sessions.filter(s=>s.attnScore!=null);
  const avgAttn=aS.length?Math.round(avgArr(aS.map(s=>s.attnScore))*10)/10:null;
  set('kpiFocus',avgFocus!=null?avgFocus+'%':'—');set('kpiFocusSub',wF.length+' sessions with data');
  set('kpiTime',fmtM(totalMins));set('kpiTimeSub',sessions.length+' total sessions');
  set('kpiSessions',sessions.length);set('kpiSessionsSub','14-day: '+(Store.getStats(14)?.totalSessions||0));
  set('kpiAttn',avgAttn!=null?avgAttn+'/10':'—');
  if(!sessions.length){const ir=$('insightsRow');if(ir)ir.innerHTML='<div style="color:var(--dim);font-size:0.82rem;padding:16px 0;grid-column:1/-1">No sessions yet.</div>';buildAdaptiveRec([]);return;}
  const grid='rgba(255,255,255,0.06)',txt='#71717a';
  const CD={responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{backgroundColor:'#1a1a2e',titleColor:txt,bodyColor:txt,borderColor:grid,borderWidth:1,cornerRadius:8}},scales:{x:{grid:{color:grid},ticks:{color:txt,font:{size:10}}},y:{grid:{color:grid},ticks:{color:txt,font:{size:10}}}}};
  const {days,byDay}=Store.getDailyData(14);
  const l14=days.map(d=>new Date(d+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}));
  const fc=$('chartFocus');
  if(fc&&!Chart.getChart(fc))new Chart(fc.getContext('2d'),{type:'line',data:{labels:l14,datasets:[
    {label:'Focus %',data:days.map(d=>byDay[d].scores.length?Math.round(avgArr(byDay[d].scores)):null),borderColor:'#6366f1',backgroundColor:'rgba(99,102,241,0.08)',borderWidth:2,fill:true,tension:0.4,pointRadius:3,spanGaps:true},
    {label:'Attn',data:days.map(d=>byDay[d].attn?.length?Math.round(avgArr(byDay[d].attn)):null),borderColor:'rgba(16,185,129,0.6)',backgroundColor:'transparent',borderWidth:1.5,fill:false,tension:0.4,pointRadius:2,borderDash:[4,3],spanGaps:true},
  ]},options:{...CD,plugins:{...CD.plugins,legend:{display:true,labels:{color:txt,font:{size:10},boxWidth:12,boxHeight:2}}},scales:{...CD.scales,y:{...CD.scales.y,min:0,max:100,ticks:{...CD.scales.y.ticks,callback:v=>v+'%'}}}}});
  const dc=$('chartDuration');
  if(dc&&!Chart.getChart(dc))new Chart(dc.getContext('2d'),{type:'bar',data:{labels:l14,datasets:[{data:days.map(d=>+(byDay[d].durations.reduce((a,b)=>a+b,0)/60).toFixed(1)),backgroundColor:'rgba(99,102,241,0.35)',borderColor:'rgba(99,102,241,0.8)',borderWidth:1,borderRadius:3}]},options:{...CD,scales:{...CD.scales,y:{...CD.scales.y,min:0,ticks:{...CD.scales.y.ticks,callback:v=>v+'h'}}}}});
  const mc=$('chartML');
  if(mc&&!Chart.getChart(mc))new Chart(mc.getContext('2d'),{type:'bar',data:{labels:l14,datasets:[
    {label:'Eye',data:days.map(d=>byDay[d].eye?.length?Math.round(avgArr(byDay[d].eye)):null),backgroundColor:'rgba(59,130,246,0.5)',borderRadius:2,spanGaps:true},
    {label:'Gaze',data:days.map(d=>byDay[d].gaze?.length?Math.round(avgArr(byDay[d].gaze)):null),backgroundColor:'rgba(99,102,241,0.5)',borderRadius:2,spanGaps:true},
    {label:'Pose',data:days.map(d=>byDay[d].pose?.length?Math.round(avgArr(byDay[d].pose)):null),backgroundColor:'rgba(16,185,129,0.5)',borderRadius:2,spanGaps:true},
  ]},options:{...CD,plugins:{...CD.plugins,legend:{display:true,labels:{color:txt,font:{size:10},boxWidth:10,boxHeight:2}}},scales:{...CD.scales,y:{...CD.scales.y,min:0,max:100,ticks:{...CD.scales.y.ticks,callback:v=>v+'%'}}}}});
  const sc=$('chartScatter');
  if(sc&&!Chart.getChart(sc))new Chart(sc.getContext('2d'),{type:'scatter',data:{datasets:[{data:sessions.map(s=>({x:s.duration||0,y:s.focusScore||0})),backgroundColor:'rgba(99,102,241,0.5)',borderColor:'rgba(99,102,241,0.9)',pointRadius:5}]},options:{...CD,scales:{x:{...CD.scales.x,title:{display:true,text:'Duration (min)',color:txt,font:{size:9}}},y:{...CD.scales.y,min:0,max:100,title:{display:true,text:'Focus %',color:txt,font:{size:9}},ticks:{...CD.scales.y.ticks,callback:v=>v+'%'}}}}});
  const prodMins=sessions.reduce((a,s)=>a+(s.duration||0)*(s.productiveRatio||0)/100,0);
  const totM=sessions.reduce((a,s)=>a+(s.duration||0),0);
  const prodPct=totM>0?Math.round(prodMins/totM*100):null;
  const dc2=$('chartDonut');
  if(dc2&&!Chart.getChart(dc2)&&prodPct!=null){
    new Chart(dc2.getContext('2d'),{type:'doughnut',data:{labels:['Productive','Other'],datasets:[{data:[prodPct,100-prodPct],backgroundColor:['rgba(16,185,129,0.7)','rgba(239,68,68,0.55)'],borderColor:['rgba(16,185,129,1)','rgba(239,68,68,0.8)'],borderWidth:1}]},options:{responsive:true,maintainAspectRatio:false,cutout:'70%',plugins:{legend:{display:false},tooltip:{backgroundColor:'#1a1a2e',bodyColor:txt}}}});
    const dc3=$('donutCenter');if(dc3)dc3.textContent=prodPct+'%';
    const dl=$('donutLegend');if(dl)dl.innerHTML=`<div style="display:flex;align-items:center;gap:6px"><div style="width:8px;height:8px;border-radius:50%;background:rgba(16,185,129,0.8)"></div><span style="color:var(--muted)">Productive ${prodPct}%</span></div><div style="display:flex;align-items:center;gap:6px"><div style="width:8px;height:8px;border-radius:50%;background:rgba(239,68,68,0.7)"></div><span style="color:var(--muted)">Other ${100-prodPct}%</span></div>`;
  }
  buildHeatmap();buildInsights(sessions);buildComparison(sessions);buildAdaptiveRec(sessions);
}

function buildHeatmap(){
  const grid=$('heatmapGrid'),lbls=$('heatmapLabels');if(!grid||grid.children.length)return;
  const h=Store.getHourlyData(),maxV=Math.max(...h.map(x=>x.scores.length?avgArr(x.scores):0));
  h.forEach((x,i)=>{
    const a=x.scores.length?avgArr(x.scores):0,int=maxV>0?a/maxV:0;
    const c=document.createElement('div');c.className='hm-cell';c.style.background=x.count?`rgba(99,102,241,${0.08+int*0.86})`:'';
    c.title=x.count?`${i}:00 — avg ${Math.round(a)}% · ${x.count} sessions`:`${i}:00 — no data`;grid.appendChild(c);
    const lb=document.createElement('div');lb.className='hm-label';lb.textContent=i%6===0?i+'h':'';lbls.appendChild(lb);
  });
}

function buildInsights(sessions){
  const container=$('insightsRow');if(!container||!sessions.length)return;
  const hd=Store.getHourlyData();
  const best=hd.reduce((b,h,i)=>{const a=h.scores.length?avgArr(h.scores):0;return a>b.score?{i,score:a}:b;},{i:-1,score:0});
  const wF=sessions.filter(s=>s.focusScore!=null);
  const sh=wF.filter(s=>s.duration<=30),lg=wF.filter(s=>s.duration>30);
  const sA=sh.length?Math.round(avgArr(sh.map(s=>s.focusScore).filter(v=>v))):null;
  const lA=lg.length?Math.round(avgArr(lg.map(s=>s.focusScore).filter(v=>v))):null;
  const gaze=sessions.map(s=>s.avgGaze).filter(v=>v!=null);
  const gA=gaze.length?Math.round(avgArr(gaze)):null;
  const prodCount=sessions.filter(s=>s.sessionLabel==='prod').length;
  const chips=[
    best.i>=0?{cls:'good',type:'Peak Hour',text:`Highest focus at <strong>${best.i}:00–${best.i+1}:00</strong> (avg ${Math.round(best.score)}%). Block this time for deep work.`}:null,
    (sA&&lA)?sA>lA?{cls:'warn',type:'Session Length',text:`Short sessions (≤30m) avg <strong>${sA}%</strong> focus vs <strong>${lA}%</strong> for longer — try staying under 35 min.`}:{cls:'',type:'Session Length',text:`Longer sessions work for you — avg <strong>${lA}%</strong> vs <strong>${sA}%</strong> for shorter ones.`}:{cls:'',type:'Session Length',text:'Record sessions of varied lengths to find your optimal focus window.'},
    gA!=null?gA<65?{cls:'warn',type:'Gaze',text:`Avg gaze on-screen: <strong>${gA}%</strong> — you look away often. Close distracting tabs before starting.`}:{cls:'good',type:'Gaze',text:`Avg gaze on-screen: <strong>${gA}%</strong> — solid attention to the screen.`}:null,
    {cls:'',type:'Productivity Labels',text:prodCount>0?`<strong>${prodCount}</strong> of ${sessions.length} sessions classified Productive via tab tracking.`:'Productivity labels will appear after sessions with tab tracking active.'},
  ].filter(Boolean);
  container.innerHTML=chips.map(c=>`<div class="insight-chip ${c.cls}"><div class="ic-type">${c.type}</div><div class="ic-text">${c.text}</div></div>`).join('');
}

function buildAdaptiveRec(sessions){
  const container=$('adaptiveRecContainer');if(!container)return;
  const analysis=SessionAnalyzer.analyze(sessions);
  if(!analysis.hasEnoughData){container.innerHTML=`<div style="color:var(--dim);font-size:0.82rem;line-height:1.6">${analysis.message}</div>`;return;}
  const{optimalDuration,dropOffPoint,suggestedBreak,peakHours,trend,recommendation}=analysis;
  const tc=trend.direction==='improving'?'var(--green)':trend.direction==='declining'?'var(--red)':'var(--muted)';
  const tl=trend.direction==='improving'?`↑ +${trend.delta}%`:trend.direction==='declining'?`↓ ${trend.delta}%`:'→ stable';
  container.innerHTML=`
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px">
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--r);padding:12px">
        <div style="font-size:0.65rem;color:var(--dim);letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px">Optimal Session</div>
        <div style="font-size:1.4rem;font-weight:700;color:var(--indigo)">${optimalDuration}<span style="font-size:0.75rem;font-weight:400;color:var(--muted)"> min</span></div>
        <div style="font-size:0.7rem;color:var(--muted);margin-top:3px">${analysis.dataPoints} sessions analyzed</div>
      </div>
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--r);padding:12px">
        <div style="font-size:0.65rem;color:var(--dim);letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px">Suggested Break</div>
        <div style="font-size:1.4rem;font-weight:700;color:var(--green)">${suggestedBreak}<span style="font-size:0.75rem;font-weight:400;color:var(--muted)"> min</span></div>
        <div style="font-size:0.7rem;color:var(--muted);margin-top:3px">${dropOffPoint?`focus drops ~${dropOffPoint}min`:'no drop-off found'}</div>
      </div>
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--r);padding:12px">
        <div style="font-size:0.65rem;color:var(--dim);letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px">Focus Trend</div>
        <div style="font-size:1.1rem;font-weight:700;color:${tc}">${tl}</div>
        <div style="font-size:0.7rem;color:var(--muted);margin-top:3px">last ${analysis.dataPoints} sessions</div>
      </div>
    </div>
    <div style="background:var(--indigo-d);border:1px solid rgba(99,102,241,0.2);border-radius:var(--r);padding:12px 14px;font-size:0.82rem;color:var(--text);line-height:1.65">${recommendation}</div>
    ${peakHours.length?`<div style="margin-top:8px;font-size:0.78rem;color:var(--muted)">Peak: ${peakHours.map(h=>`<strong style="color:var(--text)">${h.label}</strong> (${h.avgFocus}%)`).join(', ')}</div>`:''}`;
}

function buildComparison(sessions){
  if(!sessions.length)return;
  const last=sessions[0],prev=sessions[1];
  const ts=s=>new Date(s.timestamp).toLocaleDateString('en-US',{month:'short',day:'numeric'})+' '+new Date(s.timestamp).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
  const v=(val,unit,col)=>val!=null?`<span style="font-weight:600;color:${col||'var(--text)'}">${val}${unit}</span>`:'<span style="color:var(--dim)">—</span>';
  const row=(lbl,a)=>`<div class="cmp-row"><span class="cmp-label">${lbl}</span>${a}</div>`;
  const lb=l=>l?`<span class="tag tag-${l==='prod'?'prod':l==='unprod'?'unprod':'neutral'}" style="font-size:0.6rem">${Classifier.labelText(l)}</span>`:'<span style="color:var(--dim)">—</span>';
  set('cmpLastTag',ts(last));
  $('cmpLast').innerHTML=[row('Duration',v(last.duration,'m')),row('Focus',v(last.focusScore,'%','var(--indigo)')),row('Attention',v(last.attnScore,'/10','var(--violet)')),row('Gaze',v(last.avgGaze,'%')),row('Top domain',last.topApp?`<span style="font-weight:500">${last.topApp}</span>`:'<span style="color:var(--dim)">—</span>'),row('Distractions',v(last.distractions,'','var(--red)')),row('Label',lb(last.sessionLabel))].join('');
  if(prev){
    set('cmpPrevTag',ts(prev));
    const d=(a,b,inv)=>{if(a==null||b==null)return'';const dd=a-b,better=inv?dd<0:dd>0;return dd!==0?` <span style="font-size:0.7rem;color:${better?'var(--green)':'var(--red)'}">${dd>0?'+':''}${dd}</span>`:''};
    $('cmpPrev').innerHTML=[row('Duration',v(prev.duration,'m')+d(prev.duration,last.duration)),row('Focus',v(prev.focusScore,'%','var(--indigo)')+d(prev.focusScore,last.focusScore)),row('Attention',v(prev.attnScore,'/10','var(--violet)')+d(prev.attnScore,last.attnScore)),row('Gaze',v(prev.avgGaze,'%')+d(prev.avgGaze,last.avgGaze)),row('Top domain',prev.topApp?`<span style="font-weight:500">${prev.topApp}</span>`:'<span style="color:var(--dim)">—</span>'),row('Distractions',v(prev.distractions,'','var(--red)')+d(prev.distractions,last.distractions,true)),row('Label',lb(prev.sessionLabel))].join('');
  }else $('cmpPrev').innerHTML='<div style="color:var(--dim);font-size:0.78rem;padding:8px 0">No previous session yet.</div>';
}

/* HISTORY */
function buildHistory(){
  const tbody=$('historyBody');if(!tbody)return;
  const sessions=Store.getSessions(100);
  if(!sessions.length){tbody.innerHTML='<tr><td colspan="11" style="text-align:center;padding:32px;color:var(--dim)">No sessions yet.</td></tr>';return;}
  tbody.innerHTML=sessions.map(s=>{
    const ts=new Date(s.timestamp),fc=s.focusScore>=75?'var(--green)':s.focusScore>=50?'var(--amber)':'var(--red)';
    const lbl=s.sessionLabel||'neutral',tc=lbl==='prod'?'tag-prod':lbl==='unprod'?'tag-unprod':'tag-neutral';
    return `<tr><td>${ts.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</td><td>${ts.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}</td><td style="color:var(--muted);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.goal||'—'}</td><td>${s.duration||0}m</td><td style="color:${fc};font-weight:600">${s.focusScore!=null?s.focusScore+'%':'—'}</td><td>${s.attnScore!=null?s.attnScore+'/10':'—'}</td><td>${s.avgGaze!=null?s.avgGaze+'%':'—'}</td><td style="color:var(--muted)">${s.topApp||'—'}</td><td style="color:${(s.distractions||0)>5?'var(--red)':'var(--text)'}">${s.distractions||0}</td><td>${s.pomoCount||0}</td><td><span class="tag ${tc}" style="font-size:0.6rem">${Classifier.labelText(lbl)}</span></td></tr>`;
  }).join('');
}

/* SETTINGS */
function syncSettingsInputs(){
  const cfg=Store.settings();
  [{id:'cfgFocus',key:'focusDuration'},{id:'cfgShort',key:'shortBreak'},{id:'cfgLong',key:'longBreak'},{id:'cfgPomosPerLong',key:'pomosPerLong'},{id:'cfgGoal',key:'dailyGoalHours'}].forEach(({id,key})=>{const el=$(id);if(el)el.value=cfg[key]??'';});
}
function bindSettingsInputs(){
  [{id:'cfgFocus',key:'focusDuration'},{id:'cfgShort',key:'shortBreak'},{id:'cfgLong',key:'longBreak'},{id:'cfgPomosPerLong',key:'pomosPerLong'},{id:'cfgGoal',key:'dailyGoalHours'}].forEach(({id,key})=>{
    const el=$(id);if(!el)return;
    el.addEventListener('change',()=>{Store.setSetting(key,+el.value);updatePhaseUI();updatePomoStrip();showToast(`${key} updated`,'var(--indigo)');});
  });
}
function renderAppRules(){
  const c=$('appRulesContainer');if(!c)return;
  c.innerHTML=Object.entries(Store.rules()).map(([app,cat])=>`<div class="rule-row"><span class="rule-app">${app}</span><span class="tag tag-${cat==='prod'?'prod':cat==='unprod'?'unprod':'neutral'}" style="font-size:0.65rem">${cat==='prod'?'Productive':cat==='unprod'?'Unproductive':'Neutral'}</span><button onclick="Store.removeRule('${app}');renderAppRules()" class="btn btn-sm" style="margin-left:auto;padding:2px 7px;font-size:0.7rem">×</button></div>`).join('');
}
window.renderAppRules=renderAppRules;
function addAppRule(){
  const name=$('newAppName')?.value.trim(),cat=$('newAppCat')?.value;if(!name)return;
  Store.setRule(name,cat);$('newAppName').value='';renderAppRules();showToast(`Rule: ${name} → ${cat}`,'var(--green)');
}
window.addAppRule=addAppRule;

/* CSV IMPORT */
async function loadSampleCSV(){
  try{
    const res=await fetch('/data/sessions.csv'),text=await res.text();
    const rows=text.trim().split('\n'),headers=rows[0].split(',');let count=0;
    rows.slice(1).forEach(row=>{if(!row.trim())return;const vals=row.split(','),obj={};headers.forEach((h,i)=>obj[h.trim()]=vals[i]?.trim());
      Store.addSession({timestamp:obj.timestamp||new Date().toISOString(),goal:obj.notes||'',duration:parseFloat(obj.duration_min)||0,focusScore:obj.focus_score!==''?parseFloat(obj.focus_score):null,productiveRatio:obj.productive_ratio!==''?parseFloat(obj.productive_ratio):null,attnScore:obj.attn_score!==''?parseFloat(obj.attn_score):null,avgEye:obj.avg_eye!==''?parseFloat(obj.avg_eye):null,avgGaze:obj.avg_gaze!==''?parseFloat(obj.avg_gaze):null,avgPose:obj.avg_pose!==''?parseFloat(obj.avg_pose):null,dominantExpr:obj.dominant_expr||null,totalKeys:obj.total_keys!==''?parseFloat(obj.total_keys):null,topApp:obj.top_app||null,distractions:obj.distractions!==''?parseInt(obj.distractions):0,pomoCount:obj.pomo_count!==''?parseInt(obj.pomo_count):0,sessionLabel:'neutral',notes:''});count++;});
    showToast(`Loaded ${count} sessions`,'var(--green)');analyticsBuilt=false;updateTodayStats();
  }catch(e){showToast('Failed — serve from localhost','var(--red)');console.error(e);}
}
window.loadSampleCSV=loadSampleCSV;

/* Store extension */
Store.getDailyData=function(nDays=14){
  const days=[];for(let i=nDays-1;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);days.push(d.toISOString().split('T')[0]);}
  const byDay={};days.forEach(d=>{byDay[d]={scores:[],durations:[],attn:[],eye:[],gaze:[],pose:[]};});
  Store.getSessions().forEach(s=>{const d=s.timestamp?.split('T')[0];if(!byDay[d])return;if(s.focusScore!=null)byDay[d].scores.push(s.focusScore);if(s.duration!=null)byDay[d].durations.push(s.duration);if(s.attnScore!=null)byDay[d].attn.push(s.attnScore*10);if(s.avgEye!=null)byDay[d].eye.push(s.avgEye);if(s.avgGaze!=null)byDay[d].gaze.push(s.avgGaze);if(s.avgPose!=null)byDay[d].pose.push(s.avgPose);});
  return{days,byDay};
};

/* INIT */
document.addEventListener('DOMContentLoaded',()=>{
  syncSettingsInputs();bindSettingsInputs();
  updatePomoStrip();updatePhaseUI();updateTodayStats();initLiveChart();
  logFeed('System ready','var(--indigo)',new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'}));
  startActivityTracking();
  const initD=ActivityTracker.getCurrentDomain(),initT=document.title||'';
  updateActiveWindowUI(initD,initT,Classifier.classify(initD,initT,Store.rules()));
  bootML();
  const cfg=Store.settings();
  TrackerBridge.init(cfg.trackerPort||7891,data=>{if(data.activeApp){const cls=Classifier.classify(data.activeApp,'',Store.rules());updateActiveWindowUI(data.activeApp,'(system tracker)',cls);}},online=>{['trackerDot','settingsDot'].forEach(id=>{const d=$(id);if(d)d.className='tracker-dot'+(online?' online':'');});['trackerLbl','settingsTrackerLbl'].forEach(id=>set(id,'tracker · '+(online?'online':'offline')));});
  setInterval(updateTodayStats,10000);
});
