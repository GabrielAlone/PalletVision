(() => {
"use strict";

const $ = id => document.getElementById(id);
const TOTAL = 125, PER_PALLET = 25;
const state = {
  running:false, warning:false, failure:false, boxes:0, seconds:0,
  speed:70, alerts:[], history:[], elapsed:0
};

let scene, camera, renderer, controls, clock;
let beltIn, beltOut, queue=[], activeBox=null, pallet=null, pallets=[];
let cycle=0, palletTransfer=null, lastTick=Date.now();
let robotRig, upperLink, lowerLink, wrist, fingerL, fingerR;
let sensorLamp, robotLamp;

const C = {
  floor:0x737d80, floorLine:0x4c575b, wall:0x30393d,
  steel:0x8b969b, steelLight:0xc2c9cc, steelDark:0x3b454a,
  rubber:0x252b2e, robot:0x929da2, robotDark:0x515c62,
  box:0xb9824b, boxTop:0xd4a36d, tape:0x8e5e32,
  wood:0x8a603b, woodLight:0xb18555, green:0x00c58b,
  amber:0xd59a43, red:0xd84d4d, white:0xe7ecee
};
const material = (color, metalness=.25, roughness=.55) =>
  new THREE.MeshStandardMaterial({color,metalness,roughness});
const M = Object.fromEntries(Object.entries(C).map(([k,v])=>[k,material(v)]));
const V = (x,y,z)=>new THREE.Vector3(x,y,z);

function mesh(parent, geo, mat, x=0,y=0,z=0) {
  const m=new THREE.Mesh(geo,mat); m.position.set(x,y,z);
  m.castShadow=true; m.receiveShadow=true; parent.add(m); return m;
}
function box(parent,w,h,d,mat,x=0,y=0,z=0) {
  return mesh(parent,new THREE.BoxGeometry(w,h,d),mat,x,y,z);
}
function cylinder(parent,r,h,mat,x=0,y=0,z=0,rx=0,rz=0) {
  const m=mesh(parent,new THREE.CylinderGeometry(r,r,h,24),mat,x,y,z);
  m.rotation.set(rx,0,rz); return m;
}
function addLabel(text,x,y,z,scale=1) {
  const canvas=document.createElement("canvas"); canvas.width=512; canvas.height=128;
  const ctx=canvas.getContext("2d");
  ctx.fillStyle="#20282c"; ctx.fillRect(0,0,512,128);
  ctx.fillStyle="#dce3e6"; ctx.font="bold 42px Arial"; ctx.fillText(text,22,82);
  const tex=new THREE.CanvasTexture(canvas);
  const m=mesh(scene,new THREE.PlaneGeometry(2.1*scale,.52*scale),new THREE.MeshBasicMaterial({map:tex,transparent:false}),x,y,z);
  m.rotation.x=-Math.PI/2; return m;
}
function createCrate(parent) {
  const g=new THREE.Group(); parent.add(g);
  box(g,.68,.48,.62,M.box,0,.24,0);
  box(g,.69,.035,.63,M.boxTop,0,.49,0);
  box(g,.055,.485,.635,M.tape,-.22,.245,0);
  box(g,.055,.485,.635,M.tape,.22,.245,0);
  box(g,.24,.15,.018,M.steelLight,0,.29,.318);
  box(g,.16,.02,.02,M.steelDark,0,.29,.332);
  return g;
}
function createConveyor(x,z,length,output=false) {
  const g=new THREE.Group(); g.position.set(x,0,z); scene.add(g);
  box(g,length,.34,1.35,M.steelDark,0,.68,0);
  box(g,length,.08,1.28,M.steel,0,.89,0);
  for(const side of [-.69,.69]) {
    box(g,length,.17,.09,M.steelDark,0,1.02,side);
    box(g,length,.035,.1,M.steelLight,0,1.12,side);
  }
  const rollers=[];
  const n=Math.floor(length/.25);
  for(let i=0;i<=n;i++) {
    rollers.push(cylinder(g,.065,1.23,M.steelLight,-length/2+i*length/n,.94,0,Math.PI/2));
  }
  for(const px of [-length/2+.2,0,length/2-.2]) for(const pz of [-.5,.5]) {
    box(g,.12,.62,.12,M.steelDark,px,.31,pz);
    box(g,.28,.06,.25,M.rubber,px,.04,pz);
  }
  if(!output) {
    const sensor=box(g,.07,.42,.07,M.steelDark,-length/2+.35,1.25,-.83);
    sensorLamp=mesh(g,new THREE.SphereGeometry(.09,16,12),M.green,-length/2+.35,1.51,-.83);
  }
  return {group:g,rollers,length};
}
function buildPallet() {
  const g=new THREE.Group(); scene.add(g);
  box(g,1.85,.14,1.65,M.wood,0,.12,0);
  for(let z of [-.55,0,.55]) box(g,1.72,.13,.22,M.woodLight,0,.25,z);
  for(let x of [-.72,.72]) box(g,.12,.08,1.45,M.wood,x,.07,0);
  return {group:g,boxes:[]};
}
function buildRobot() {
  const base=new THREE.Group(); scene.add(base); base.position.set(-.1,0,-.2);
  cylinder(base,.72,.25,M.robotDark,0,.13,0);
  cylinder(base,.56,.2,M.robot,0,.35,0);
  cylinder(base,.35,.22,M.steelDark,0,.56,0);
  cylinder(base,.29,.25,M.robot,0,.78,0);
  const shoulder=V(-.1,2.55,-.2);
  upperLink=cylinder(scene,.19,1,M.robot,0,0,0);
  lowerLink=cylinder(scene,.145,1,M.steel,0,0,0);
  wrist=new THREE.Group(); scene.add(wrist);
  cylinder(wrist,.16,.2,M.robotDark,0,0,0);
  box(wrist,.34,.14,.3,M.steel,0,-.14,0);
  box(wrist,.09,.32,.1,M.steelLight,-.14,-.34,0);
  box(wrist,.09,.32,.1,M.steelLight,.14,-.34,0);
  fingerL=wrist.children[wrist.children.length-2];
  fingerR=wrist.children[wrist.children.length-1];
  robotRig={shoulder,base};
  robotLamp=mesh(base,new THREE.SphereGeometry(.075,16,12),M.green,0,1.02,.28);
}
function setLink(link,a,b) {
  const direction=b.clone().sub(a);
  link.position.copy(a).add(b).multiplyScalar(.5);
  link.scale.set(1,direction.length(),1);
  link.quaternion.setFromUnitVectors(V(0,1,0),direction.normalize());
}
function buildEnvironment() {
  scene.background=new THREE.Color(0x68757b);
  scene.fog=new THREE.Fog(0x68757b,23,42);
  const floor=box(scene,24,.22,19,M.floor,0,-.14,0);
  const grid=new THREE.GridHelper(24,48,0x4b585d,0x879196); grid.position.y=-.02; scene.add(grid);
  for(let z of [-4.7,4.7]) box(scene,22,.025,.055,M.amber,0,.005,z);
  // Parede industrial e pilares
  box(scene,22,4,.25,M.wall,0,2,-8.7);
  for(let x=-10;x<=10;x+=2.5) {
    box(scene,.16,4,.2,M.steelDark,x,2,-8.52);
    box(scene,1.3,.06,.16,M.steel,x,3.7,-8.4);
  }
  // Treliças superiores e luminárias
  for(let x of [-7,-2,3,8]) {
    box(scene,.12,.12,13,M.steelDark,x,4.1,-1.8);
    const lamp=box(scene,1.5,.08,.38,M.white,x,3.85,-1.8);
    lamp.material= new THREE.MeshStandardMaterial({color:0xe5ecef,emissive:0x8d9da3,emissiveIntensity:.45});
  }
  // Proteções laterais em tela metálica
  for(const x of [-8.5,8.5]) {
    box(scene,.09,1.8,10,M.steelDark,x,.9,-.1);
    for(let z=-4.5;z<=4.5;z+=.5) box(scene,.025,1.8,.025,M.steel,x,.9,z);
    for(let y=.3;y<1.8;y+=.3) box(scene,.09,.025,10,M.steel,x,y,-.1);
  }
  // Faixas de segurança discretas
  for(let x of [-5.8,5.8]) box(scene,.07,.02,7.8,M.amber,x,.005,0);
  addLabel("CELULA PAL-01",-5.5,.02,-5.7,.8);
  beltIn=createConveyor(-3.75,.45,4.8,false);
  beltOut=createConveyor(4.9,1.75,4.6,true);
  buildRobot();
  pallet=buildPallet(); pallet.group.position.set(2.1,0,1.75);
  for(let i=0;i<3;i++) {
    const c=createCrate(scene);
    queue.push({mesh:c,progress:.12+i*.25});
  }
}
function resetQueue() {
  queue.forEach(q=>scene.remove(q.mesh)); queue=[];
  for(let i=0;i<3;i++) {
    const c=createCrate(scene);
    queue.push({mesh:c,progress:.12+i*.25});
  }
  activeBox=null;
}
function beltPosition(progress) {
  return V(-3.75-2.4+progress*4.8,1.03,.45);
}
function palletTarget(index) {
  const layer=Math.floor(index/5), slot=index%5;
  const positions=[[-.48,-.32],[0,-.32],[.48,-.32],[-.24,.32],[.24,.32]];
  const [x,z]=positions[slot];
  return V(2.1+x,.32+layer*.49,1.75+z);
}
function updateQueue(dt) {
  const waiting=queue.filter(q=>q.mesh!==activeBox).sort((a,b)=>b.progress-a.progress);
  if(state.running&&!state.failure&&!activeBox&&!palletTransfer&&waiting.length) {
    const head=waiting[0];
    head.progress=Math.min(.94,head.progress+dt*(.15+state.speed/100*.35));
  }
  for(const item of queue) if(item.mesh!==activeBox) item.mesh.position.copy(beltPosition(item.progress));
}
function updateRobotForPoint(point,close) {
  const shoulder=robotRig.shoulder;
  const elbow=V(
    THREE.MathUtils.lerp(shoulder.x,point.x,.48),
    Math.max(2.0,(shoulder.y+point.y)*.5+.35),
    THREE.MathUtils.lerp(shoulder.z,point.z,.48)
  );
  setLink(upperLink,shoulder,elbow);
  setLink(lowerLink,elbow,point);
  wrist.position.copy(point);
  const gap=close?.075:.16;
  fingerL.position.x=-gap; fingerR.position.x=gap;
}
function cubic(a,b,c,d,t) {
  const u=1-t;
  return a.clone().multiplyScalar(u*u*u)
    .add(b.clone().multiplyScalar(3*u*u*t))
    .add(c.clone().multiplyScalar(3*u*t*t))
    .add(d.clone().multiplyScalar(t*t*t));
}
function beginCycle() {
  if(activeBox||!state.running||state.failure||palletTransfer) return;
  const head=queue.slice().sort((a,b)=>b.progress-a.progress)[0];
  if(!head||head.progress<.93) return;
  activeBox=head.mesh; cycle=0;
}
function completeBox() {
  const idx=state.boxes%PER_PALLET;
  const target=palletTarget(idx);
  activeBox.position.set(target.x,target.y,target.z);
  activeBox.rotation.set(0,0,0);
  activeBox.position.x-=2.1; activeBox.position.z-=1.75;
  activeBox.position.y-=0;
  activeBox.position.x+=2.1; activeBox.position.z+=1.75;
  activeBox.parent.remove(activeBox);
  pallet.group.add(activeBox);
  activeBox.position.set(target.x-2.1,target.y,target.z-1.75);
  activeBox.rotation.set(0,0,0);
  pallet.boxes.push(activeBox);
  queue=queue.filter(q=>q.mesh!==activeBox);
  activeBox=null;
  state.boxes++;
  if(state.boxes<TOTAL) {
    const fresh=createCrate(scene); queue.push({mesh:fresh,progress:.08});
  }
  addHistory("Caixa "+state.boxes+" posicionada");
  if(state.boxes%PER_PALLET===0) {
    addHistory("Palete "+(state.boxes/PER_PALLET)+" completo — encaminhado para saída");
    palletTransfer={elapsed:0,group:pallet.group};
    pallet=null;
  }
  renderDashboard();
  if(state.boxes>=TOTAL) {
    state.running=false;
    addHistory("Lote de 125 caixas concluído");
    addAlert("normal","Lote finalizado","Os cinco paletes foram concluídos.");
  }
}
function updateCycle(dt) {
  if(!state.running||state.failure) return;
  if(!activeBox) { beginCycle(); return; }
  cycle+=dt*(.38+state.speed/100*.34);
  const t=Math.min(cycle,1);
  const source=beltPosition(.94);
  const target=palletTarget(state.boxes%PER_PALLET);
  const start=V(source.x,source.y+.48,source.z);
  const pick=V(source.x,source.y+.48,source.z);
  const carry=V(target.x,2.65,target.z);
  const drop=V(target.x,target.y+.48,target.z);
  let point, boxPoint, closed=false;
  if(t<.2) {
    const p=t/.2; point=start.clone().lerp(pick,p); boxPoint=source;
  } else if(t<.32) {
    point=pick; boxPoint=source; closed=true;
  } else if(t<.82) {
    const p=(t-.32)/.5;
    point=cubic(pick,V(-.3,3.2,.2),V(target.x-.6,3.25,target.z),carry,p);
    boxPoint=point.clone().add(V(0,-.48,0)); closed=true;
  } else {
    const p=(t-.82)/.18;
    point=carry.clone().lerp(drop,p);
    boxPoint=point.clone().add(V(0,-.48,0)); closed=true;
  }
  updateRobotForPoint(point,closed);
  if(t>=.32) activeBox.position.copy(boxPoint);
  if(t>=1) completeBox();
}
function updatePalletTransfer(dt) {
  if(!palletTransfer) return;
  palletTransfer.elapsed+=dt;
  const t=Math.min(1,palletTransfer.elapsed/2.8);
  const eased=t*t*(3-2*t);
  palletTransfer.group.position.x=THREE.MathUtils.lerp(2.1,7.5,eased);
  if(t>=1) {
    scene.remove(palletTransfer.group);
    pallets.push(palletTransfer.group);
    palletTransfer=null;
    if(state.boxes<TOTAL) {
      pallet=buildPallet(); pallet.group.position.set(2.1,0,1.75);
      addHistory("Novo palete vazio posicionado na estação");
    }
    renderDashboard();
  }
}
function buildScene() {
  const host=$("scene3d");
  if(!window.THREE) throw new Error("Three.js não foi carregado. Verifique a conexão com a internet.");
  scene=new THREE.Scene();
  camera=new THREE.PerspectiveCamera(43,host.clientWidth/host.clientHeight,.1,100);
  camera.position.set(10,9,13);
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  renderer.setSize(host.clientWidth,host.clientHeight);
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  if("outputColorSpace" in renderer) renderer.outputColorSpace=THREE.SRGBColorSpace;
  else renderer.outputEncoding=THREE.sRGBEncoding;
  host.innerHTML=""; host.appendChild(renderer.domElement);
  if(THREE.OrbitControls) {
    controls=new THREE.OrbitControls(camera,renderer.domElement);
    controls.target.set(0,.8,0); controls.enableDamping=true;
    controls.maxPolarAngle=Math.PI/2.05; controls.minDistance=7; controls.maxDistance=23;
  }
  scene.add(new THREE.HemisphereLight(0xffffff,0x4a5358,1.45));
  const key=new THREE.DirectionalLight(0xffffff,2.1);
  key.position.set(-7,13,8); key.castShadow=true; key.shadow.mapSize.set(2048,2048); scene.add(key);
  const fill=new THREE.DirectionalLight(0xdce5e8,.65); fill.position.set(8,7,-8); scene.add(fill);
  buildEnvironment();
  clock=new THREE.Clock();
  renderer.domElement.addEventListener("dblclick",()=>{
    camera.position.set(10,9,13); if(controls) controls.target.set(0,.8,0);
  });
  window.addEventListener("resize",resizeScene);
  animate();
}
function resizeScene() {
  if(!renderer||!camera) return;
  const host=$("scene3d"); if(!host.clientWidth||!host.clientHeight) return;
  camera.aspect=host.clientWidth/host.clientHeight; camera.updateProjectionMatrix();
  renderer.setSize(host.clientWidth,host.clientHeight);
}
function animate() {
  requestAnimationFrame(animate);
  if(!renderer) return;
  const dt=Math.min(clock.getDelta(),.04);
  if(state.running&&!state.failure) {
    beltIn.rollers.forEach(r=>r.rotation.z+=dt*5);
    beltOut.rollers.forEach(r=>r.rotation.z+=dt*3);
  }
  updateQueue(dt); updateCycle(dt); updatePalletTransfer(dt);
  if(controls) controls.update();
  renderer.render(scene,camera);
}
function timeString(){return new Date().toLocaleTimeString("pt-BR");}
function addHistory(message) {
  state.history.unshift({message,time:timeString()});
  state.history=state.history.slice(0,6); renderHistory();
}
function renderHistory() {
  const list=$("historyList"); if(!list)return; list.innerHTML="";
  state.history.forEach(item=>{
    const li=document.createElement("li"), a=document.createElement("span"), t=document.createElement("time");
    a.textContent=item.message;t.textContent=item.time;li.append(a,t);list.append(li);
  });
}
function addAlert(type,title,message) {
  state.alerts.unshift({type,title,message,time:timeString()});
  state.alerts=state.alerts.slice(0,6);renderAlerts();
}
function renderAlerts() {
  const list=$("alertList"); if(list) {
    list.innerHTML="";
    state.alerts.forEach(a=>{
      const li=document.createElement("li"), info=document.createElement("div");
      const b=document.createElement("b"),small=document.createElement("small"),tag=document.createElement("span");
      b.textContent=a.title;small.textContent=a.message+" · "+a.time;
      info.append(b,small);tag.className="alert-level "+a.type;
      tag.textContent=a.type==="failure"?"FALHA":a.type==="warning"?"ATENÇÃO":"INFO";
      li.append(info,tag);list.append(li);
    });
  }
  const active=state.alerts.filter(a=>a.type!=="normal");
  if($("alertCount")) $("alertCount").textContent=active.length+" ATIVOS";
  const summary=$("alertSummary"); if(!summary)return;
  const symbol=summary.querySelector(".alert-symbol");
  if(state.failure) {
    summary.className="alert-summary failure";$("alertTitle").textContent="FALHA NO ROBÔ PALETIZADOR";
    $("alertDescription").textContent="Operação interrompida. Verifique o equipamento.";if(symbol)symbol.textContent="!";
  } else if(state.warning) {
    summary.className="alert-summary warning";$("alertTitle").textContent="ATENÇÃO NA LINHA DE PRODUÇÃO";
    $("alertDescription").textContent="Ocorrência simulada: verifique a área indicada.";if(symbol)symbol.textContent="!";
  } else {
    summary.className="alert-summary";$("alertTitle").textContent="Sistema operando normalmente";
    $("alertDescription").textContent="Nenhuma ocorrência ativa.";if(symbol)symbol.textContent="✓";
  }
}
function renderEquipment() {
  const list=$("equipmentList"); if(!list)return; list.innerHTML="";
  ["Esteira de entrada","Esteira de saída","Sensor fotoelétrico","Robô paletizador","Garra pneumática"].forEach((name,i)=>{
    const li=document.createElement("li"),label=document.createElement("span"),status=document.createElement("b");
    label.textContent=name;status.id="equip"+i;status.className="equip-status";li.append(label,status);list.append(li);
  });
  updateEquipment();
}
function updateEquipment() {
  for(let i=0;i<5;i++) {
    const el=$("equip"+i);if(!el)continue;
    const off=state.failure&&i===3;el.textContent=off?"● OFFLINE":"● ONLINE";el.classList.toggle("off",off);
  }
  if($("onlineCount")) $("onlineCount").textContent=state.failure?"4 ONLINE":"5 ONLINE";
}
function renderGrid() {
  const grid=$("positionGrid");if(!grid)return;grid.innerHTML="";
  for(let i=0;i<25;i++)grid.append(document.createElement("i"));
}
function renderDashboard() {
  const boxes=state.boxes, pct=boxes/TOTAL*100, done=Math.floor(boxes/PER_PALLET);
  const current=palletTransfer?25:boxes%PER_PALLET;
  if($("kBoxes")) $("kBoxes").textContent=boxes;
  if($("productionBar")) $("productionBar").style.width=pct+"%";
  if($("productionPct")) $("productionPct").textContent=Math.round(pct)+"% concluído";
  if($("remaining")) $("remaining").textContent=(TOTAL-boxes)+" restantes";
  if($("efficiency")) $("efficiency").textContent=state.running?state.speed:"—";
  if($("efficiencyText")) $("efficiencyText").textContent=state.running?"Velocidade configurada":"Linha parada";
  if($("pallets")) $("pallets").textContent=done;
  if($("palletBar")) $("palletBar").style.width=done/5*100+"%";
  if($("currentPallet")) $("currentPallet").textContent=boxes>=TOTAL?"Lote finalizado":"Palete atual: "+(done+1);
  if($("palletPosition")) $("palletPosition").textContent=current+" / 25 caixas";
  if($("palletCount")) $("palletCount").textContent=String(current).padStart(2,"0");
  if($("palletPct")) $("palletPct").textContent=Math.round(current/25*100)+"%";
  if($("layer")) $("layer").textContent="CAMADA "+Math.min(5,Math.floor(current/5)+1);
  if($("positionGrid")) [...$("positionGrid").children].forEach((el,i)=>el.classList.toggle("filled",i<current));
  if($("elapsed")) $("elapsed").textContent=String(Math.floor(state.seconds/60)).padStart(2,"0")+":"+String(state.seconds%60).padStart(2,"0");
  if($("cycleTime")) $("cycleTime").textContent=state.running?"Ciclo automático":"Ciclo: —";
  const status=$("statusText"),msg=$("statusMessage"),light=$("statusLight");
  if(state.failure) {status.textContent="FALHA NO PROCESSO";msg.textContent="Operação interrompida";light.style.background="var(--red)";}
  else if(state.warning) {status.textContent="ATENÇÃO NA LINHA";msg.textContent="Verifique a ocorrência";light.style.background="var(--amber)";}
  else if(state.running) {status.textContent="PROCESSO EM OPERAÇÃO";msg.textContent="Alimentação e paletização em andamento";light.style.background="var(--green)";}
  else {status.textContent=boxes>=TOTAL?"LOTE CONCLUÍDO":"PROCESSO PARADO";msg.textContent=boxes>=TOTAL?"125 caixas processadas":"Aguardando comando do operador";light.style.background="var(--steel-light)";}
  if($("sceneState")) $("sceneState").textContent=state.failure?"● FALHA":state.warning?"● ATENÇÃO":state.running?"● EM OPERAÇÃO":"● EM ESPERA";
  if($("sceneStep")) $("sceneStep").textContent=state.failure?"Operação interrompida":state.running?(activeBox?"Robô posicionando caixa":"Aguardando caixa na entrada"):"Aguardando início";
  if($("bToggle")) $("bToggle").textContent=state.running?"Ⅱ Pausar processo":"▶ Iniciar processo";
  if($("currentStep")) $("currentStep").textContent=state.running?"Ciclo de coleta e posicionamento":"Aguardando início";
  if($("nextStep")) $("nextStep").textContent=state.running?"Transferir próxima caixa":state.failure?"Verificar equipamento":"Iniciar processo";
  if($("updated")) $("updated").textContent=timeString();
  updateEquipment();renderAlerts();
}
function startProcess() {
  if(state.failure||state.boxes>=TOTAL)return;
  state.running=true;state.warning=false;addHistory("Ciclo automático iniciado");
  addAlert("normal","Processo iniciado","Esteira de entrada e robô em operação.");renderDashboard();
}
function pauseProcess(){state.running=false;addHistory("Processo pausado pelo operador");renderDashboard();}
function resetProcess() {
  state.running=false;state.warning=false;state.failure=false;state.boxes=0;state.seconds=0;state.elapsed=0;
  cycle=0;activeBox=null;
  if(palletTransfer && palletTransfer.group) scene.remove(palletTransfer.group);
  palletTransfer=null;pallets=[];
  if(pallet)scene.remove(pallet.group);
  pallet=buildPallet();pallet.group.position.set(2.1,0,1.75);
  queue.forEach(q=>scene.remove(q.mesh));queue=[];
  for(let i=0;i<3;i++){const c=createCrate(scene);queue.push({mesh:c,progress:.12+i*.25});}
  state.alerts=[];state.history=[];addHistory("Novo lote preparado");renderDashboard();
}
function simulateWarning() {
  if(state.failure)return;state.warning=true;
  addAlert("warning","Atenção na linha","Verificação simulada do sensor fotoelétrico.");
  addHistory("Alerta de atenção simulado");renderDashboard();
}
function simulateFailure() {
  state.running=false;state.failure=true;
  addAlert("failure","Falha no robô paletizador","Movimento interrompido pelo operador.");
  addHistory("Falha simulada no robô paletizador");renderDashboard();
}
function tick() {
  const now=Date.now();
  if(state.running&&!state.failure) {
    state.elapsed+=(now-lastTick)/1000;
    if(state.elapsed>=1){const n=Math.floor(state.elapsed);state.seconds+=n;state.elapsed-=n;}
  }
  lastTick=now;
  if($("clock")) $("clock").textContent=timeString();
  if($("elapsed")) $("elapsed").textContent=String(Math.floor(state.seconds/60)).padStart(2,"0")+":"+String(state.seconds%60).padStart(2,"0");
}
function init() {
  renderGrid();renderEquipment();addHistory("Sistema de monitoramento inicializado");
  $("bToggle").addEventListener("click",()=>state.running?pauseProcess():startProcess());
  $("bReset").addEventListener("click",resetProcess);
  $("bWarn").addEventListener("click",simulateWarning);
  $("bFail").addEventListener("click",simulateFailure);
  if($("speed")) $("speed").addEventListener("input",e=>{
    state.speed=Number(e.target.value);if($("speedValue"))$("speedValue").textContent=state.speed+"%";renderDashboard();
  });
  renderDashboard();
  try { buildScene(); } catch(err) {
    console.error(err);const error=$("sceneError");if(error){error.hidden=false;error.textContent="Falha ao iniciar a visualização 3D: "+err.message;}
  }
  setInterval(tick,500);
}
init();
})();