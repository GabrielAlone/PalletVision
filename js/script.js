(() => {
"use strict";

const $ = id => document.getElementById(id);
const TOTAL = 135, PER_PALLET = 27;
const state = {
  running:false, warning:false, failure:false, boxes:0, seconds:0,
  speed:90, alerts:[], history:[], elapsed:0, stops:0
};

let scene, camera, renderer, controls, clock;
let beltIn, beltOut, queue=[], activeBox=null, pallet=null, pallets=[];
let cycle=0, palletTransfer=null, lastTick=Date.now();
let robotRig, upperLink, lowerLink, wrist, fingerL, fingerR;
let sensorLamp, robotLamp;

const C = {
  floor:0x687277, floorLine:0x3c474c, wall:0x252d31,
  steel:0x9aa8ae, steelLight:0x60717a, steelDark:0x252d32,
  rubber:0x111619, robot:0xb5c0c5, robotDark:0x171e22,
  box:0xc98543, boxTop:0xf0bd72, tape:0x70401f,
  wood:0x79502f, woodLight:0xa97542, green:0x00d6a0,
  blue:0x12a6c7, amber:0xffb52e, red:0xe34b58, white:0xeaf3f6
};
const LAYER_CAPACITY = 9;
const PALLET_LAYERS = 3;
const material = (color, metalness=.25, roughness=.55) =>
  new THREE.MeshStandardMaterial({color,metalness,roughness});
const M = Object.fromEntries(Object.entries(C).map(([k,v])=>[k,material(v)]));
const V = (x,y,z)=>new THREE.Vector3(x,y,z);
const HOME_POINT = V(-.85,2.38,.05);
const ARM_SEGMENT_LENGTH = 1.35;

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
  box(g,.62,.46,.56,M.box,0,.23,0);
  box(g,.63,.035,.57,M.boxTop,0,.475,0);
  box(g,.045,.465,.575,M.tape,-.2,.235,0);
  box(g,.045,.465,.575,M.tape,.2,.235,0);
  box(g,.075,.022,.58,M.tape,0,.505,0);
  box(g,.22,.13,.018,M.boxTop,0,.28,.288);
  box(g,.14,.018,.02,M.tape,0,.28,.302);
  return g;
}
function createConveyor(x,z,length,output=false) {
  const g=new THREE.Group(); g.position.set(x,0,z); scene.add(g);
  const width=output?2.4:1.55;
  const edge=width/2-.055;
  box(g,length,.34,width,M.steelDark,0,.68,0);
  box(g,length,.08,width-.08,M.steelDark,0,.89,0);
  box(g,length*.96,.025,width-.14,M.rubber,0,.945,0);
  for(const side of [-edge,edge]) {
    box(g,length*.92,.035,.025,M.blue,0,1.115,side);
    box(g,length,.17,.09,M.steelDark,0,1.02,side);
    box(g,length,.035,.1,M.blue,0,1.12,side);
    box(g,length*.88,.025,.105,M.green,0,1.145,side);
  }
  const rollers=[];
  const n=Math.floor(length/.25);
  for(let i=0;i<=n;i++) {
    const roller=cylinder(g,.065,width-.18,M.steelDark,-length/2+i*length/n,.94,0,Math.PI/2);
    rollers.push(roller);
    // Anéis coloridos nas extremidades dão acabamento sem criar peças giratórias soltas.
    for(const side of [-1,1]) {
      const ring=cylinder(g,.071,.045,M.blue,-length/2+i*length/n,.94,side*(width-.18)/2,Math.PI/2);
      roller.userData.rings=roller.userData.rings||[];
      roller.userData.rings.push(ring);
    }
  }
  for(const px of [-length/2+.2,0,length/2-.2]) for(const pz of [-width/2+.16,width/2-.16]) {
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
  box(g,2.12,.14,1.92,M.wood,0,.12,0);
  for(let z of [-.62,0,.62]) box(g,1.98,.13,.20,M.woodLight,0,.25,z);
  for(let x of [-.82,0,.82]) box(g,.12,.08,1.72,M.wood,x,.07,0);
  return {group:g,boxes:[]};
}
function buildRobot() {
  const base=new THREE.Group(); scene.add(base); base.position.set(-.1,0,-.2);
  cylinder(base,.72,.25,M.robotDark,0,.13,0);
  cylinder(base,.56,.2,M.robot,0,.35,0);
  cylinder(base,.35,.22,M.steelDark,0,.56,0);
  cylinder(base,.29,.25,M.robot,0,.78,0);
  cylinder(base,.31,.045,M.green,0,.68,0);
  // Coluna estrutural liga a base ao ombro do braço, evitando aparência de garra solta.
  cylinder(base,.19,1.55,M.robotDark,0,1.62,0);
  cylinder(base,.24,.16,M.robot,0,2.42,0);
  const shoulder=V(-.1,2.55,-.2);
  upperLink=cylinder(scene,.19,1,M.robot,0,0,0);
  lowerLink=cylinder(scene,.155,1,M.steelDark,0,0,0);
  upperLink.scale.y=ARM_SEGMENT_LENGTH;
  lowerLink.scale.y=ARM_SEGMENT_LENGTH;
  wrist=new THREE.Group(); scene.add(wrist);
  cylinder(wrist,.16,.2,M.robotDark,0,0,0);
  box(wrist,.34,.14,.3,M.steel,0,-.14,0);
  box(wrist,.09,.32,.1,M.blue,-.14,-.34,0);
  box(wrist,.09,.32,.1,M.blue,.14,-.34,0);
  fingerL=wrist.children[wrist.children.length-2];
  fingerR=wrist.children[wrist.children.length-1];
  box(wrist,.11,.075,.14,M.amber,-.14,-.49,.015);
  box(wrist,.11,.075,.14,M.amber,.14,-.49,.015);
  box(wrist,.13,.045,.13,M.green,0,-.23,.17);
  const elbowJoint=mesh(scene,new THREE.SphereGeometry(.22,24,16),M.robotDark);
  const wristJoint=mesh(scene,new THREE.SphereGeometry(.19,24,16),M.steelLight);
  robotRig={shoulder,base,elbowJoint,wristJoint};
  robotLamp=mesh(base,new THREE.SphereGeometry(.075,16,12),M.green,0,1.02,.28);
}
function setLink(link,a,b) {
  const direction=b.clone().sub(a);
  link.position.copy(a).add(b).multiplyScalar(.5);
  link.scale.set(1,ARM_SEGMENT_LENGTH,1);
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
  beltOut=createConveyor(6.0,1.75,5.8,true);
  buildRobot();
  pallet=buildPallet(); pallet.group.position.set(1.55,0,1.75);
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
  const layer=Math.floor(index/LAYER_CAPACITY);
  const slot=index%LAYER_CAPACITY;
  const positions=[
    [-.64,-.58],[0,-.58],[.64,-.58],
    [-.64,0],[0,0],[.64,0],
    [-.64,.58],[0,.58],[.64,.58]
  ];
  const [x,z]=positions[slot];
  return V(1.55+x,.32+layer*.48,1.75+z);
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
  const axis=point.clone().sub(shoulder);
  const distance=axis.length();
  axis.normalize();
  // Dois segmentos rígidos de tamanho fixo: o cotovelo articula sem esticar o braço.
  const reference=Math.abs(axis.y)>.88?V(1,0,0):V(0,1,0);
  const bend=new THREE.Vector3().crossVectors(axis,reference).normalize();
  const half=Math.min(distance/2,ARM_SEGMENT_LENGTH-.02);
  const height=Math.sqrt(Math.max(.04,ARM_SEGMENT_LENGTH*ARM_SEGMENT_LENGTH-half*half));
  const elbow=shoulder.clone().add(point.clone().sub(shoulder).multiplyScalar(.5)).add(bend.multiplyScalar(height));
  setLink(upperLink,shoulder,elbow);
  setLink(lowerLink,elbow,point);
  robotRig.elbowJoint.position.copy(elbow);
  robotRig.wristJoint.position.copy(point);
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
  activeBox.parent.remove(activeBox);
  pallet.group.add(activeBox);
  activeBox.position.set(target.x-pallet.group.position.x,target.y-pallet.group.position.y,target.z-pallet.group.position.z);
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
    palletTransfer={elapsed:0,group:pallet.group,fromX:1.55,toX:6.0,fromY:0,toY:1.02};
    pallet=null;
  }
  renderDashboard();
  if(state.boxes>=TOTAL) {
    state.running=false;
    addHistory("Lote de 135 caixas concluído");
    addAlert("normal","Lote finalizado","Os cinco paletes foram concluídos.");
  }
}
function updateCycle(dt) {
  if(!state.running||state.failure) return;
  if(!activeBox) { beginCycle(); return; }
  cycle+=dt*(.72+state.speed/100*.36);
  const t=Math.min(cycle,1);
  const source=beltPosition(.94);
  const target=palletTarget(state.boxes%PER_PALLET);
  const start=V(source.x,source.y+1.05,source.z);
  const pick=V(source.x,source.y+.48,source.z);
  const carry=V(target.x,Math.max(2.85,target.y+1.05),target.z);
  const drop=V(target.x,target.y+.48,target.z);
  let point, boxPoint=source, closed=false;

  if(t<.15) {
    const p=t/.15;
    point=start.clone().lerp(pick,p);
  } else if(t<.22) {
    point=pick;
    closed=true;
  } else if(t<.66) {
    const p=(t-.22)/.44;
    point=cubic(pick,V(-.3,3.25,.2),V(target.x-.6,3.35,target.z),carry,p);
    boxPoint=point.clone().add(V(0,-.48,0));
    closed=true;
  } else if(t<.78) {
    const p=(t-.66)/.12;
    point=carry.clone().lerp(drop,p);
    boxPoint=point.clone().add(V(0,-.48,0));
    closed=true;
  } else if(t<.86) {
    point=drop;
    boxPoint=V(target.x,target.y,target.z);
  } else {
    const p=(t-.86)/.14;
    point=cubic(drop,V(target.x,2.8,target.z),V(-.7,3.15,.1),HOME_POINT,p);
    boxPoint=V(target.x,target.y,target.z);
  }

  updateRobotForPoint(point,closed);
  if(t>=.22) activeBox.position.copy(boxPoint);
  if(t>=1) completeBox();
}
function updatePalletTransfer(dt) {
  if(!palletTransfer) return;
  palletTransfer.elapsed+=dt;
  // Primeiro eleva o palete até a altura dos roletes; depois transfere pela esteira.
  const liftT=Math.min(1,palletTransfer.elapsed/.75);
  const moveT=Math.max(0,Math.min(1,(palletTransfer.elapsed-.75)/2.6));
  const liftEase=liftT*liftT*(3-2*liftT);
  const moveEase=moveT*moveT*(3-2*moveT);
  palletTransfer.group.position.y=THREE.MathUtils.lerp(palletTransfer.fromY,palletTransfer.toY,liftEase);
  palletTransfer.group.position.x=THREE.MathUtils.lerp(palletTransfer.fromX,palletTransfer.toX,moveEase);
  if(moveT>=1) {
    scene.remove(palletTransfer.group);
    pallets.push(palletTransfer.group);
    palletTransfer=null;
    if(state.boxes<TOTAL) {
      pallet=buildPallet(); pallet.group.position.set(1.55,0,1.75);
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
  // Posição de repouso: mantém o braço apoiado e a garra junto ao conjunto do robô.
  updateRobotForPoint(V(-.85,2.38,.05),false);
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
    const feeding=!activeBox&&!palletTransfer&&queue.some(q=>q.progress<.94);
    if(feeding) beltIn.rollers.forEach(r=>r.rotateY(dt*2.8));
    if(palletTransfer) beltOut.rollers.forEach(r=>r.rotateY(dt*3.0));
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
  const activeCount=state.failure||state.warning?1:0;
  if($("alertCount")) $("alertCount").textContent=activeCount+" ATIVOS";
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
    const off=state.failure&&(i===3||i===4);
    const attention=state.warning&&i===2;
    el.textContent=off?"● OFFLINE":attention?"● ATENÇÃO":"● ONLINE";
    el.classList.toggle("off",off);
    el.classList.toggle("attention",attention);
  }
  if($("onlineCount")) $("onlineCount").textContent=state.failure?"3 ONLINE":state.warning?"4 ONLINE · 1 ATENÇÃO":"5 ONLINE";
}
function renderGrid() {
  const grid=$("positionGrid");if(!grid)return;grid.innerHTML="";
  for(let layer=0;layer<PALLET_LAYERS;layer++) {
    const section=document.createElement("div");
    section.className="pallet-layer";
    const head=document.createElement("div");
    head.className="pallet-layer-head";
    const name=document.createElement("span");
    name.textContent="CAMADA "+(layer+1);
    const count=document.createElement("b");
    count.className="layer-count";
    count.textContent="0 / 9";
    head.append(name,count);
    const slots=document.createElement("div");
    slots.className="layer-slots";
    for(let i=0;i<LAYER_CAPACITY;i++) slots.append(document.createElement("i"));
    section.append(head,slots);
    grid.append(section);
  }
}
function renderDashboard() {
  const boxes=state.boxes, pct=boxes/TOTAL*100, done=Math.floor(boxes/PER_PALLET);
  const current=(palletTransfer||boxes>=TOTAL)?PER_PALLET:boxes%PER_PALLET;
  if($("kBoxes")) $("kBoxes").textContent=boxes;
  if($("productionBar")) $("productionBar").style.width=pct+"%";
  if($("productionPct")) $("productionPct").textContent=Math.round(pct)+"% concluído";
  if($("remaining")) $("remaining").textContent=(TOTAL-boxes)+" restantes";
  if($("efficiency")) $("efficiency").textContent=state.running?state.speed:"—";
  if($("efficiencyText")) $("efficiencyText").textContent=state.running?"Velocidade configurada":"Linha parada";
  if($("pallets")) $("pallets").textContent=done;
  if($("palletBar")) $("palletBar").style.width=done/5*100+"%";
  if($("currentPallet")) $("currentPallet").textContent=boxes>=TOTAL?"Lote finalizado":"Palete atual: "+(done+1);
  if($("palletPosition")) $("palletPosition").textContent=current+" / "+PER_PALLET+" caixas";
  if($("palletCount")) $("palletCount").textContent=String(current).padStart(2,"0");
  if($("palletPct")) $("palletPct").textContent=Math.round(current/PER_PALLET*100)+"%";
  if($("layer")) $("layer").textContent=current>=PER_PALLET?"PALETE COMPLETO":"CAMADA "+Math.min(PALLET_LAYERS,Math.floor(current/LAYER_CAPACITY)+1);
  if($("positionGrid")) {
    [...$("positionGrid").querySelectorAll(".pallet-layer")].forEach((layerEl,layerIndex)=>{
      const amount=Math.max(0,Math.min(LAYER_CAPACITY,current-layerIndex*LAYER_CAPACITY));
      const count=layerEl.querySelector(".layer-count");
      if(count) count.textContent=amount+" / 9";
      layerEl.classList.toggle("complete",amount===LAYER_CAPACITY);
      [...layerEl.querySelectorAll(".layer-slots i")].forEach((slot,i)=>slot.classList.toggle("filled",i<amount));
    });
  }
  if($("stopCount")) $("stopCount").textContent=state.stops+" registradas";
  updateProductionMetrics();
  if($("elapsed")) $("elapsed").textContent=String(Math.floor(state.seconds/60)).padStart(2,"0")+":"+String(state.seconds%60).padStart(2,"0");
  if($("cycleTime")) $("cycleTime").textContent=state.running?"Ciclo automático":"Ciclo: —";
  const status=$("statusText"),msg=$("statusMessage"),light=$("statusLight");
  if(state.failure) {status.textContent="FALHA NO PROCESSO";msg.textContent="Operação interrompida";light.style.background="var(--red)";}
  else if(state.warning) {status.textContent="ATENÇÃO NA LINHA";msg.textContent="Verifique a ocorrência";light.style.background="var(--amber)";}
  else if(state.running) {status.textContent="PROCESSO EM OPERAÇÃO";msg.textContent="Alimentação e paletização em andamento";light.style.background="var(--green)";}
  else {status.textContent=boxes>=TOTAL?"LOTE CONCLUÍDO":"PROCESSO PARADO";msg.textContent=boxes>=TOTAL?"135 caixas processadas":"Aguardando comando do operador";light.style.background="var(--steel-light)";}
  if($("sceneState")) $("sceneState").textContent=state.failure?"● FALHA":state.warning?"● ATENÇÃO":state.running?"● EM OPERAÇÃO":"● EM ESPERA";

  const notice=$("lineNotice");
  if(notice) {
    notice.hidden=!(state.failure||state.warning);
    notice.classList.toggle("warning-notice",state.warning&&!state.failure);
    if(state.failure) {
      $("noticeIcon").textContent="!";
      $("noticeTitle").textContent="FALHA: robô paletizador interrompido";
      $("noticeText").textContent="A simulação foi pausada. Verifique o robô e reconheça a ocorrência antes de reiniciar.";
    } else if(state.warning) {
      $("noticeIcon").textContent="!";
      $("noticeTitle").textContent="ATENÇÃO: sensor fotoelétrico";
      $("noticeText").textContent="Foi detectada uma condição de atenção simulada. Confira a entrada de caixas e a central de alertas.";
    }
  }
  if($("bAcknowledge")) $("bAcknowledge").disabled=!(state.failure||state.warning);
  const robotPhase=!activeBox?"Aguardando caixa na entrada":
    cycle<.15?"Aproximando a garra da caixa":
    cycle<.22?"Prendendo a caixa":
    cycle<.66?"Transportando até o palete":
    cycle<.78?"Descendo para posicionar":
    cycle<.86?"Liberando a caixa":
    "Garra retornando à posição inicial";
  if($("sceneStep")) $("sceneStep").textContent=state.failure?"Operação interrompida":palletTransfer?"Transferindo palete completo":state.running?robotPhase:"Aguardando início";
  if($("bToggle")) $("bToggle").textContent=state.running?"Ⅱ Pausar processo":"▶ Iniciar processo";
  if($("currentStep")) $("currentStep").textContent=state.running?(activeBox?robotPhase:"Alimentação da próxima caixa"):"Aguardando início";
  if($("nextStep")) $("nextStep").textContent=state.running?(palletTransfer?"Expedir palete completo":activeBox?(cycle>=.86?"Iniciar próxima coleta":"Retornar garra e preparar próxima coleta"):"Alimentar estação"):state.failure?"Verificar equipamento":"Iniciar processo";
  const flowStage=state.failure?"":palletTransfer?"exit":activeBox?(cycle<.22?"pick":"stack"):state.running?"feed":"idle";
  ["flowFeed","flowPick","flowStack","flowExit"].forEach((id,i)=>{
    const el=$(id); if(!el)return;
    const stages=["feed","pick","stack","exit"];
    el.classList.toggle("active",flowStage===stages[i]);
    el.classList.toggle("done",flowStage&&stages.indexOf(flowStage)>i);
  });
  if($("updated")) $("updated").textContent=timeString();
  updateEquipment();renderAlerts();
}
function updateProductionMetrics() {
  const rate=state.seconds>0?(state.boxes/(state.seconds/60)):0;
  const average=state.boxes>0?state.seconds/state.boxes:0;
  if($("throughput")) $("throughput").textContent=rate.toFixed(1).replace(".",",");
  if($("averageCycle")) $("averageCycle").textContent=state.boxes?average.toFixed(1).replace(".",",")+" s/caixa":"— s/caixa";
}
function exportReport() {
  const rows = [
    ["RELATÓRIO DE PRODUÇÃO - PALLETINOVA"],
    ["Data de exportação", new Date().toLocaleString("pt-BR")],
    ["Célula", "PAL-01"], ["Origem dos dados", "Simulação local"],
    ["Caixas posicionadas", state.boxes], ["Meta de caixas", TOTAL],
    ["Paletes concluídos", Math.floor(state.boxes/PER_PALLET)],
    ["Tempo de operação (segundos)", state.seconds], ["Velocidade configurada (%)", state.speed],
    ["Paradas registradas", state.stops],
    ["Estado atual", state.failure ? "Falha" : state.warning ? "Atenção" : state.running ? "Em operação" : state.boxes>=TOTAL ? "Lote concluído" : "Parado"],
    [], ["HISTÓRICO DE ATIVIDADES"], ["Horário", "Evento"],
    ...state.history.slice().reverse().map(item => [item.time, item.message]),
    [], ["REGISTRO DE ALERTAS"], ["Horário", "Tipo", "Ocorrência", "Detalhes"],
    ...state.alerts.slice().reverse().map(item => [item.time, item.type, item.title, item.message])
  ];
  const csv = "\uFEFF" + rows.map(row => row.map(value => '"' + String(value ?? "").replace(/"/g, '""') + '"').join(";")).join("\r\n");
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8;"});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href=url; link.download="relatorio-palletinova-"+new Date().toISOString().slice(0,10)+".csv";
  document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  addHistory("Relatório CSV exportado pelo operador");
}
function acknowledgeAlert() {
  const hadOccurrence=state.warning||state.failure;
  if(state.failure) state.running=false;
  state.warning=false;
  state.failure=false;
  if(hadOccurrence) {
    addHistory("Ocorrência reconhecida pelo operador");
    addAlert("normal","Ocorrência reconhecida","O aviso foi retirado pelo operador. Verifique a linha antes de reiniciar.");
  }
  renderDashboard();
}
function startProcess() {
  if(state.failure||state.boxes>=TOTAL)return;
  state.running=true;state.warning=false;addHistory("Ciclo automático iniciado");
  addAlert("normal","Processo iniciado","Esteira de entrada e robô em operação.");renderDashboard();
}
function pauseProcess(){
  if(state.running) state.stops++;
  state.running=false;
  addHistory("Processo pausado pelo operador");
  renderDashboard();
}
function resetProcess() {
  if(!window.confirm("Deseja reiniciar o lote? A produção e o histórico atuais serão zerados.")) return;
  state.running=false;state.warning=false;state.failure=false;state.boxes=0;state.seconds=0;state.elapsed=0;state.stops=0;
  cycle=0;activeBox=null;
  if(palletTransfer && palletTransfer.group) scene.remove(palletTransfer.group);
  palletTransfer=null;pallets=[];
  if(pallet)scene.remove(pallet.group);
  pallet=buildPallet();pallet.group.position.set(1.55,0,1.75);
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
  if(state.running) state.stops++;
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
  updateProductionMetrics();
}
function init() {
  renderGrid();renderEquipment();addHistory("Sistema de monitoramento inicializado");
  $("bToggle").addEventListener("click",()=>state.running?pauseProcess():startProcess());
  $("bReset").addEventListener("click",resetProcess);
  if($("bExport")) $("bExport").addEventListener("click",exportReport);
  $("bWarn").addEventListener("click",simulateWarning);
  $("bFail").addEventListener("click",simulateFailure);
  if($("bAcknowledge")) $("bAcknowledge").addEventListener("click",acknowledgeAlert);
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