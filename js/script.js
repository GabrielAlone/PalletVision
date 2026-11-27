
(() => {
"use strict";

/* =====================================================
   PALLETINOVA — SIMULAÇÃO INDUSTRIAL 3D
   Requer Three.js carregado pelo index.html
===================================================== */

const $ = id => document.getElementById(id);

const TOTAL = 125;
const PER_PALLET = 25;

const state = {
  running: false,
  warning: false,
  failure: false,
  boxes: 0,
  seconds: 0,
  speed: 70,
  alerts: [],
  history: [],
  elapsed: 0
};

let scene, camera, renderer, controls, clock;
let robot, shoulder, elbow, wrist, gripper;
let armUpper, armLower;
let fingerLeft, fingerRight;

let conveyorBoxes = [];
let palletObjects = [];
let activeBox = null;

let cycle = 0;
let lastTime = Date.now();
let selectedBelt = 0;
let boxCounter = 0;

const palette = {
  floor: "#aeb9bd",
  floorLine: "#7d898e",
  blue: "#0755a4",
  blueLight: "#1685d1",
  blueDark: "#073b70",
  yellow: "#f2bd25",
  yellowLight: "#ffe16a",
  steel: "#657984",
  steelLight: "#c0cbd0",
  dark: "#26343d",
  rubber: "#263039",
  box: "#b77a3e",
  boxLight: "#d6a36b",
  wood: "#9b6738",
  green: "#00d69a",
  red: "#ed454f"
};

function mat(color, metalness = 0.2, roughness = 0.55) {
  return new THREE.MeshStandardMaterial({
    color,
    metalness,
    roughness
  });
}

const M = {};

Object.keys(palette).forEach(key => {
  M[key] = mat(palette[key]);
});

function add(parent, geometry, material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function cube(parent, w, h, d, material, x, y, z) {
  return add(
    parent,
    new THREE.BoxGeometry(w, h, d),
    material,
    x, y, z
  );
}

function cylinder(parent, radius, height, material, x, y, z, rotation = [0, 0, 0]) {
  const mesh = add(
    parent,
    new THREE.CylinderGeometry(radius, radius, height, 28),
    material,
    x, y, z
  );

  mesh.rotation.set(...rotation);
  return mesh;
}

function sphere(parent, radius, material, x, y, z) {
  return add(
    parent,
    new THREE.SphereGeometry(radius, 24, 18),
    material,
    x, y, z
  );
}

function makeBeam(parent, length, thickness, material, x, y, z) {
  // O comprimento é fixo. O braço não será esticado durante a animação.
  const mesh = cube(
    parent,
    length,
    thickness,
    thickness,
    material,
    x,
    y,
    z
  );

  return mesh;
}

/* =====================================================
   CENÁRIO
===================================================== */

function buildFloor() {
  cube(scene, 22, 0.2, 18, M.floor, 0, -0.14, 0);

  const grid = new THREE.GridHelper(
    22,
    44,
    0x64777e,
    0x879398
  );

  grid.position.y = -0.025;
  scene.add(grid);

  // Faixas de circulação no chão
  for (let z of [-4.1, 4.1]) {
    cube(scene, 18, 0.025, 0.09, M.yellow, 0, 0.005, z);
  }

  for (let x of [-8.5, 8.5]) {
    cube(scene, 0.09, 0.025, 8.2, M.yellow, x, 0.005, 0);
  }
}

function buildWalls() {
  // Fundo industrial discreto
  cube(scene, 19, 0.22, 0.18, M.dark, 0, 3.2, -7.8);

  for (let x = -8; x <= 8; x += 2) {
    cube(scene, 0.07, 3.1, 0.08, M.steel, x, 1.6, -7.7);
  }

  // Colunas e iluminação
  for (let x of [-7, -3.5, 0, 3.5, 7]) {
    cube(scene, 0.16, 3.3, 0.16, M.steel, x, 1.65, -7.4);
  }

  cube(scene, 15, 0.12, 0.55, M.dark, 0, 3.15, -6.8);

  for (let x of [-5, 0, 5]) {
    cube(scene, 1.8, 0.08, 0.38, M.steelLight, x, 3.05, -6.8);
  }
}

function buildFencePanel(x1, z1, x2, z2) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const length = Math.hypot(dx, dz);
  const angle = Math.atan2(dz, dx);

  const group = new THREE.Group();

  group.position.set(
    (x1 + x2) / 2,
    0,
    (z1 + z2) / 2
  );

  group.rotation.y = -angle;
  scene.add(group);

  const height = 1.9;

  cube(group, length, 0.07, 0.07, M.yellow, 0, 0.08, 0);
  cube(group, length, 0.07, 0.07, M.yellow, 0, height, 0);

  for (let x = -length / 2; x <= length / 2; x += 0.65) {
    cube(group, 0.06, height, 0.06, M.yellow, x, height / 2, 0);
  }

  for (let y = 0.2; y < height; y += 0.18) {
    cube(group, length, 0.018, 0.018, M.steel, 0, y, 0);
  }

  for (let x = -length / 2; x <= length / 2; x += 0.18) {
    cube(group, 0.018, height, 0.018, M.steel, x, height / 2, 0);
  }
}

function buildSafetyArea() {
  buildFencePanel(-8, -5, -8, 5);
  buildFencePanel(-8, -5, -5.5, -5);
  buildFencePanel(5.5, -5, 8, -5);
  buildFencePanel(8, -5, 8, 5);
  buildFencePanel(-8, 5, -5.5, 5);
  buildFencePanel(5.5, 5, 8, 5);

  // Colunas de sinalização
  for (const [x, z] of [
    [-7.8, -2], [-7.8, 2],
    [7.8, -2], [7.8, 2],
    [-5.8, -4.8], [5.8, -4.8]
  ]) {
    cylinder(scene, 0.07, 1.7, M.yellow, x, 0.85, z);
    sphere(scene, 0.11, M.green, x, 1.75, z);
  }
}

/* =====================================================
   ESTEIRAS
===================================================== */

function createConveyor(x, z, rotation = 0, length = 5.2) {
  const group = new THREE.Group();

  group.position.set(x, 0, z);
  group.rotation.y = rotation;
  scene.add(group);

  const half = length / 2;

  // Estrutura
  cube(group, length, 0.34, 1.35, M.dark, 0, 0.75, 0);
  cube(group, length, 0.08, 1.27, M.steel, 0, 0.96, 0);

  // Laterais azuis
  for (const side of [-0.69, 0.69]) {
    cube(group, length, 0.2, 0.1, M.steel, 0, 1.08, side);
    cube(group, length, 0.035, 0.11, M.steelLight, 0, 1.19, side);
  }

  // Rolos transversais
  const rollers = [];

  const count = Math.floor(length / 0.24);

  for (let i = 0; i <= count; i++) {
    const xPos = -half + i * (length / count);

    const roller = cylinder(
      group,
      0.065,
      1.22,
      M.steelLight,
      xPos,
      1.02,
      0,
      [Math.PI / 2, 0, 0]
    );

    rollers.push(roller);
  }

  // Pés da estrutura
  for (const xPos of [-half + 0.25, 0, half - 0.25]) {
    for (const zPos of [-0.5, 0.5]) {
      cube(group, 0.13, 0.7, 0.13, M.steel, xPos, 0.35, zPos);
      cube(group, 0.35, 0.08, 0.3, M.dark, xPos, 0.06, zPos);
    }
  }

  // Sensor de entrada
  cube(group, 0.08, 0.6, 0.08, M.yellow, -half + 0.4, 1.35, -0.83);
  sphere(group, 0.09, M.green, -half + 0.4, 1.68, -0.83);

  return {
    group,
    rollers,
    length,
    half,
    rotation
  };
}

let beltOne;
let beltTwo;

function beltPoint(belt, progress) {
  const localX = -belt.half + progress * belt.length;

  const point = new THREE.Vector3(localX, 1.28, 0);

  point.applyMatrix4(belt.group.matrixWorld);

  return point;
}

function buildConveyors() {
  beltOne = createConveyor(-3.1, 0, 0, 5.2);

  // Segunda esteira cruzada, alimentando a área de trabalho
  beltTwo = createConveyor(0.5, -3.15, Math.PI / 2, 5.1);
}

/* =====================================================
   CAIXAS
===================================================== */

function createCrate(parent, x = 0, y = 0, z = 0, scale = 1) {
  const group = new THREE.Group();

  parent.add(group);
  group.position.set(x, y, z);
  group.scale.setScalar(scale);

  cube(group, 0.66, 0.48, 0.62, M.box, 0, 0.24, 0);
  cube(group, 0.67, 0.035, 0.63, M.boxLight, 0, 0.49, 0);

  // Faixas da embalagem
  cube(group, 0.04, 0.49, 0.635, M.wood, -0.22, 0.245, 0);
  cube(group, 0.04, 0.49, 0.635, M.wood, 0.22, 0.245, 0);

  // Etiqueta
  cube(group, 0.23, 0.15, 0.018, M.steelLight, 0, 0.28, 0.32);

  return group;
}

function spawnBeltBoxes() {
  conveyorBoxes.forEach(item => scene.remove(item.mesh));
  conveyorBoxes = [];
  for (let i = 0; i < 4; i++) {
    const mesh = createCrate(scene, 0, 0, 0, 0.82);
    conveyorBoxes.push({ mesh, belt: 0, progress: 0.12 + i * 0.19, speed: 0.105 });
  }
}

function updateConveyorBoxes(dt) {
  if (!beltOne || !beltTwo) return;
  const queue = conveyorBoxes.filter(item => item.belt === 0 && item.mesh !== activeBox).sort((a,b) => b.progress-a.progress);
  if (state.running && !state.failure && !activeBox && queue.length) {
    queue[0].progress = Math.min(0.88, queue[0].progress + dt * queue[0].speed * (state.speed / 70));
  }
  conveyorBoxes.forEach(item => {
    const belt = item.belt === 0 ? beltOne : beltTwo;
    belt.group.updateMatrixWorld(true);
    const p = beltPoint(belt, item.progress);
    item.mesh.position.set(p.x, p.y, p.z);
  });
}

function createPallet(x, z, index) {
  const group = new THREE.Group();

  group.position.set(x, 0, z);
  scene.add(group);

  cube(group, 1.7, 0.14, 1.55, M.wood, 0, 0.12, 0);

  for (let i = -1; i <= 1; i++) {
    cube(
      group,
      1.62,
      0.12,
      0.24,
      M.woodLight,
      0,
      0.25,
      i * 0.5
    );
  }

  const slots = [];

  for (let layer = 0; layer < 5; layer++) {
    for (let position = 0; position < 5; position++) {
      const crate = createCrate(
        group,
        -0.52 + (position % 3) * 0.52,
        0.34 + layer * 0.49,
        -0.32 + Math.floor(position / 3) * 0.64,
        0.7
      );

      crate.visible = false;
      slots.push(crate);
    }
  }

  // Identificação do palete
  cube(group, 0.8, 0.2, 0.05, M.dark, 0, 0.5, 0.82);

  palletObjects.push({ group, slots, index });
}

function buildPallets() {
  palletPositions.forEach(([x, z], index) => {
    createPallet(x, z, index);
  });
}

function updatePallets() {
  const completed = state.boxes;

  palletObjects.forEach((pallet, index) => {
    pallet.slots.forEach((crate, slot) => {
      const globalIndex = index * PER_PALLET + slot;

      crate.visible = globalIndex < completed;
    });
  });
}

/* =====================================================
   ROBÔ INDUSTRIAL ARTICULADO
===================================================== */

function buildRobot() {
  robot = new THREE.Group();
  robot.position.set(0, 0, 0);
  scene.add(robot);

  // Base pesada
  cylinder(robot, 0.78, 0.32, M.dark, 0, 0.16, 0);
  cylinder(robot, 0.65, 0.24, M.blue, 0, 0.42, 0);
  cylinder(robot, 0.43, 0.2, M.blueLight, 0, 0.62, 0);

  // Coluna giratória
  const rotatingBase = new THREE.Group();
  rotatingBase.position.set(0, 0.72, 0);
  robot.add(rotatingBase);

  robot.userData.rotatingBase = rotatingBase;

  cylinder(rotatingBase, 0.32, 0.3, M.blueDark, 0, 0.05, 0);

  // Ombro
  shoulder = new THREE.Group();
  shoulder.position.set(0, 0.2, 0);
  rotatingBase.add(shoulder);

  sphere(shoulder, 0.3, M.blueLight, 0, 0, 0);

  // Braço superior — comprimento fixo
  armUpper = makeBeam(
    shoulder,
    1.55,
    0.34,
    M.blue,
    0.77,
    0,
    0
  );

  cube(shoulder, 1.3, 0.08, 0.38, M.yellow, 0.77, 0.2, 0);

  // Cotovelo
  elbow = new THREE.Group();
  elbow.position.set(1.55, 0, 0);
  shoulder.add(elbow);

  sphere(elbow, 0.25, M.blueLight, 0, 0, 0);

  // Antebraço — também possui comprimento fixo
  armLower = makeBeam(
    elbow,
    1.25,
    0.25,
    M.blueLight,
    0.625,
    0,
    0
  );

  cube(elbow, 1.05, 0.07, 0.29, M.yellow, 0.62, 0.15, 0);

  // Pulso
  wrist = new THREE.Group();
  wrist.position.set(1.25, 0, 0);
  elbow.add(wrist);

  sphere(wrist, 0.18, M.dark, 0, 0, 0);
  cylinder(wrist, 0.13, 0.25, M.yellow, 0.13, -0.18, 0);

  // Garra
  gripper = new THREE.Group();
  gripper.position.set(0.15, -0.35, 0);
  wrist.add(gripper);

  cube(gripper, 0.36, 0.16, 0.32, M.steel, 0, 0, 0);
  cube(gripper, 0.2, 0.12, 0.2, M.blueDark, 0, -0.13, 0);

  fingerLeft = cube(
    gripper,
    0.075,
    0.3,
    0.1,
    M.steelLight,
    -0.16,
    -0.32,
    0
  );

  fingerRight = cube(
    gripper,
    0.075,
    0.3,
    0.1,
    M.steelLight,
    0.16,
    -0.32,
    0
  );

  // Detalhes de articulação
  sphere(shoulder, 0.09, M.yellowLight, 0, 0, 0.27);
  sphere(elbow, 0.08, M.yellowLight, 0, 0, 0.23);
}

/* =====================================================
   MOVIMENTO DO ROBÔ
===================================================== */

function smooth(a, b, t) {
  const v = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return v * v * (3 - 2 * v);
}

function animateRobot(t) {
  if (!robot) return;

  const base = robot.userData.rotatingBase;

  // Ciclo de movimento mais rápido e suave
  const pick = selectedBelt === 0
    ? { yaw: -0.15, shoulder: -0.48, elbow: 0.9 }
    : { yaw: -Math.PI / 2, shoulder: -0.42, elbow: 0.85 };

  const place = {
    yaw: 0.65,
    shoulder: -0.62,
    elbow: 1.05
  };

  let yaw = pick.yaw;
  let shoulderAngle = pick.shoulder;
  let elbowAngle = pick.elbow;
  let closed = false;

  if (!state.running || state.failure) {
    base.rotation.y += (0 - base.rotation.y) * 0.035;
    shoulder.rotation.z += (-0.3 - shoulder.rotation.z) * 0.035;
    elbow.rotation.z += (0.8 - elbow.rotation.z) * 0.035;
    return;
  }

  const tCycle = (t % 1);

  if (tCycle < 0.25) {
    const v = smooth(0, 0.25, tCycle);

    shoulderAngle = THREE.MathUtils.lerp(-0.3, pick.shoulder, v);
    elbowAngle = THREE.MathUtils.lerp(0.8, pick.elbow, v);

  } else if (tCycle < 0.43) {
    closed = true;
    shoulderAngle = pick.shoulder;
    elbowAngle = pick.elbow;

  } else if (tCycle < 0.75) {
    const v = smooth(0.43, 0.75, tCycle);

    yaw = THREE.MathUtils.lerp(pick.yaw, place.yaw, v);
    shoulderAngle = THREE.MathUtils.lerp(
      pick.shoulder,
      place.shoulder,
      v
    );

    elbowAngle = THREE.MathUtils.lerp(
      pick.elbow,
      place.elbow,
      v
    );

    closed = true;

  } else {
    const v = smooth(0.75, 1, tCycle);

    yaw = place.yaw;
    shoulderAngle = place.shoulder;
    elbowAngle = place.elbow;

    closed = v < 0.7;
  }

  base.rotation.y += (yaw - base.rotation.y) * 0.12;
  shoulder.rotation.z +=
    (shoulderAngle - shoulder.rotation.z) * 0.12;

  elbow.rotation.z +=
    (elbowAngle - elbow.rotation.z) * 0.12;

  const fingerGap = closed ? 0.075 : 0.16;

  fingerLeft.position.x +=
    (-fingerGap - fingerLeft.position.x) * 0.25;

  fingerRight.position.x +=
    (fingerGap - fingerRight.position.x) * 0.25;
}

/* =====================================================
   CICLO DE PALETIZAÇÃO
===================================================== */

function getCurrentPalletPosition() {
  const index = Math.min(
    Math.floor(state.boxes / PER_PALLET),
    4
  );

  return palletPositions[index];
}

function getTargetForBox() {
  const [x, z] = getCurrentPalletPosition();

  const position = state.boxes % PER_PALLET;
  const slotInLayer = position % 5;
  const layer = Math.floor(position / 5);
  const column = slotInLayer % 3;
  const row = Math.floor(slotInLayer / 3);
  return new THREE.Vector3(x - 0.52 + column * 0.52, 0.55 + layer * 0.49, z - 0.32 + row * 0.64);
}

function startNewCycle() {
  if (activeBox || !state.running || state.failure) return;
  selectedBelt = 0;
  const candidates = conveyorBoxes.filter(item => item.belt === 0).sort((a,b) => b.progress-a.progress);
  if (!candidates.length || candidates[0].progress < 0.87) return;
  activeBox = candidates[0].mesh;
  cycle = 0;
}

function updatePickAndPlace(dt) {
  if (!state.running || state.failure) return;

  if (!activeBox) {
    startNewCycle();
    return;
  }

  // Ciclo de aproximadamente 2,8 segundos
  cycle += dt * (0.36 + state.speed / 100 * 0.28);

  const t = Math.min(cycle, 1);

  const belt = selectedBelt === 0 ? beltOne : beltTwo;
  belt.group.updateMatrixWorld(true);

  const source = beltPoint(belt, 0.92);
  const destination = getTargetForBox();

  const lift = new THREE.Vector3(
    source.x,
    2.6,
    source.z
  );

  const carry = new THREE.Vector3(
    destination.x,
    2.8,
    destination.z
  );

  let position;

  if (t < 0.24) {
    const v = smooth(0, 0.24, t);
    position = source.clone().lerp(lift, v);

    $("sceneStep").textContent = "Robô alcançando a caixa";

  } else if (t < 0.38) {
    position = lift.clone();

    $("sceneStep").textContent = "Garra prendendo a caixa";

  } else if (t < 0.78) {
    const v = smooth(0.38, 0.78, t);
    position = lift.clone().lerp(carry, v);

    $("sceneStep").textContent = "Transportando caixa até o palete";

  } else {
    const v = smooth(0.78, 1, t);
    position = carry.clone().lerp(destination, v);

    $("sceneStep").textContent = "Posicionando caixa no palete";
  }

  activeBox.position.copy(position);

  if (t >= 1) {
    const target = getTargetForBox();

    activeBox.position.copy(target);
    activeBox.rotation.set(0, 0, 0);

    const itemIndex = conveyorBoxes.findIndex(item => item.mesh === activeBox);
    if (itemIndex !== -1) {
      scene.remove(conveyorBoxes[itemIndex].mesh);
      conveyorBoxes.splice(itemIndex, 1);
    }

    scene.remove(activeBox);
    activeBox = null;

    state.boxes++;
    if (state.boxes < TOTAL) {
      const fresh = createCrate(scene, 0, 0, 0, 0.82);
      conveyorBoxes.push({ mesh: fresh, belt: 0, progress: 0.08, speed: 0.105 });
    }
    updatePallets();
    addHistory("Caixa " + state.boxes + " posicionada");

    if (state.boxes % PER_PALLET === 0) {
      addHistory("Palete " + (state.boxes / PER_PALLET) + " concluído");
    }

    renderDashboard();

    if (state.boxes >= TOTAL) {
      finishProcess();
    }
  }
}

/* =====================================================
   CÂMERA E RENDERIZAÇÃO
===================================================== */

function buildScene() {
  const host = $("scene3d");

  if (!window.THREE) {
    show3DError(
      "Three.js não carregou. Verifique a conexão com a internet."
    );
    return;
  }

  try {
    scene = new THREE.Scene();
    scene.background = new THREE.Color("#aeb9bd");
    scene.fog = new THREE.Fog("#aeb9bd", 24, 42);

    camera = new THREE.PerspectiveCamera(
      42,
      host.clientWidth / host.clientHeight,
      0.1,
      100
    );

    camera.position.set(10, 10, 12);

    renderer = new THREE.WebGLRenderer({
      antialias: true
    });

    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    if ("outputColorSpace" in renderer) {
      renderer.outputColorSpace = THREE.SRGBColorSpace;
    } else {
      renderer.outputEncoding = THREE.sRGBEncoding;
    }

    host.innerHTML = "";
    host.appendChild(renderer.domElement);

    if (THREE.OrbitControls) {
      controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 0.7, 0);
      controls.enableDamping = true;
      controls.maxPolarAngle = Math.PI / 2.05;
      controls.minDistance = 7;
      controls.maxDistance = 23;
    }

    const hemi = new THREE.HemisphereLight(
      0xffffff,
      0x59636a,
      1.6
    );

    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffffff, 2.1);
    sun.position.set(-7, 13, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    scene.add(sun);

    const fill = new THREE.DirectionalLight(0xd5eaff, 0.8);
    fill.position.set(8, 7, -8);
    scene.add(fill);

    buildFloor();
    buildWalls();
    buildSafetyArea();
    buildConveyors();
    buildPallets();
    buildRobot();
    spawnBeltBoxes();

    window.addEventListener("resize", resizeScene);

    renderer.domElement.addEventListener("dblclick", () => {
      camera.position.set(10, 10, 12);

      if (controls) {
        controls.target.set(0, 0.7, 0);
      }
    });

    clock = new THREE.Clock();

    animate();

  } catch (error) {
    console.error(error);
    show3DError("Erro ao montar o cenário 3D: " + error.message);
  }
}

function show3DError(message) {
  const error = $("sceneError");

  if (!error) return;

  error.hidden = false;
  error.textContent = message;
}

function resizeScene() {
  if (!renderer || !camera) return;

  const host = $("scene3d");

  camera.aspect = host.clientWidth / host.clientHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(host.clientWidth, host.clientHeight);
}

function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.04);

  if (state.running && !state.failure) {
    beltOne.rollers.forEach(roller => {
      roller.rotation.z += dt * 3.5;
    });

  }

  updateConveyorBoxes(dt);

  if (state.running && !state.failure) {
    updatePickAndPlace(dt);

    const cycleProgress = activeBox ? cycle : 0;
    animateRobot(cycleProgress);
  } else {
    animateRobot(0);
  }

  if (controls) controls.update();

  renderer.render(scene, camera);
}

/* =====================================================
   PAINEL E INDICADORES
===================================================== */

function timeString() {
  return new Date().toLocaleTimeString("pt-BR");
}

function formatElapsed(seconds) {
  return (
    String(Math.floor(seconds / 60)).padStart(2, "0") +
    ":" +
    String(seconds % 60).padStart(2, "0")
  );
}

function addHistory(message) {
  state.history.unshift({
    message,
    time: timeString()
  });

  state.history = state.history.slice(0, 7);

  renderHistory();
}

function renderHistory() {
  const list = $("historyList");

  if (!list) return;

  list.innerHTML = "";

  state.history.forEach(item => {
    const li = document.createElement("li");
    const span = document.createElement("span");
    const time = document.createElement("time");

    span.textContent = item.message;
    time.textContent = item.time;

    li.append(span, time);
    list.append(li);
  });
}

function addAlert(type, title, message) {
  state.alerts.unshift({
    type,
    title,
    message,
    time: timeString()
  });

  state.alerts = state.alerts.slice(0, 7);

  renderAlerts();
}

function renderAlerts() {
  const list = $("alertList");

  if (list) {
    list.innerHTML = "";

    state.alerts.forEach(alert => {
      const li = document.createElement("li");
      const info = document.createElement("div");
      const title = document.createElement("b");
      const description = document.createElement("small");
      const tag = document.createElement("span");

      title.textContent = alert.title;

      description.textContent =
        alert.message + " · " + alert.time;

      info.append(title, description);

      tag.className = "alert-level " + alert.type;

      tag.textContent =
        alert.type === "failure"
          ? "FALHA"
          : alert.type === "warning"
          ? "ATENÇÃO"
          : "INFO";

      li.append(info, tag);
      list.append(li);
    });
  }

  const active = state.alerts.filter(
    alert => alert.type !== "normal"
  );

  if ($("alertCount")) {
    $("alertCount").textContent = active.length + " ATIVOS";
  }

  const summary = $("alertSummary");

  if (!summary) return;

  if (state.failure) {
    summary.className = "alert-summary failure";
    $("alertTitle").textContent = "FALHA NO ROBÔ PALETIZADOR";
    $("alertDescription").textContent =
      "Operação interrompida. Verifique o equipamento.";

    summary.querySelector(".alert-symbol").textContent = "!";

  } else if (state.warning) {
    summary.className = "alert-summary warning";
    $("alertTitle").textContent = "ATENÇÃO NA LINHA DE PRODUÇÃO";
    $("alertDescription").textContent =
      "Ocorrência simulada: verifique a área indicada.";

    summary.querySelector(".alert-symbol").textContent = "!";

  } else {
    summary.className = "alert-summary";
    $("alertTitle").textContent = "Sistema operando normalmente";
    $("alertDescription").textContent =
      "Nenhuma ocorrência ativa.";

    summary.querySelector(".alert-symbol").textContent = "✓";
  }
}

function renderEquipment() {
  const list = $("equipmentList");

  if (!list) return;

  list.innerHTML = "";

  [
    "Esteira principal",
    "Esteira auxiliar",
    "Sensor de presença",
    "Robô paletizador",
    "Garra mecânica"
  ].forEach((name, index) => {
    const li = document.createElement("li");
    const label = document.createElement("span");
    const status = document.createElement("b");

    label.textContent = name;
    status.id = "equip" + index;
    status.className = "equip-status";

    li.append(label, status);
    list.append(li);
  });

  updateEquipment();
}

function updateEquipment() {
  for (let i = 0; i < 5; i++) {
    const element = $("equip" + i);

    if (!element) continue;

    const off = state.failure && i === 3;

    element.textContent = off ? "● OFFLINE" : "● ONLINE";
    element.classList.toggle("off", off);
  }

  if ($("onlineCount")) {
    $("onlineCount").textContent =
      state.failure ? "4 ONLINE" : "5 ONLINE";
  }
}

function renderGrid() {
  const grid = $("positionGrid");

  if (!grid) return;

  grid.innerHTML = "";

  for (let i = 0; i < 25; i++) {
    grid.append(document.createElement("i"));
  }
}

function renderDashboard() {
  const boxes = state.boxes;
  const percentage = boxes / TOTAL * 100;
  const completedPallets = Math.floor(boxes / PER_PALLET);
  const currentBoxes = boxes % PER_PALLET;

  if ($("kBoxes")) $("kBoxes").textContent = boxes;

  if ($("productionBar")) {
    $("productionBar").style.width = percentage + "%";
  }

  if ($("productionPct")) {
    $("productionPct").textContent =
      Math.round(percentage) + "% concluído";
  }

  if ($("remaining")) {
    $("remaining").textContent =
      TOTAL - boxes + " restantes";
  }

  if ($("efficiency")) {
    $("efficiency").textContent =
      state.running ? state.speed : "—";
  }

  if ($("efficiencyText")) {
    $("efficiencyText").textContent =
      state.running ? "Rendimento simulado" : "Linha parada";
  }

  if ($("pallets")) {
    $("pallets").textContent = completedPallets;
  }

  if ($("palletBar")) {
    $("palletBar").style.width =
      completedPallets / 5 * 100 + "%";
  }

  if ($("currentPallet")) {
    $("currentPallet").textContent =
      completedPallets >= 5
        ? "Lote finalizado"
        : "Palete atual: " + (completedPallets + 1);
  }

  if ($("palletPosition")) {
    $("palletPosition").textContent =
      currentBoxes + " / 25 caixas";
  }

  if ($("palletCount")) {
    $("palletCount").textContent =
      String(currentBoxes).padStart(2, "0");
  }

  if ($("palletPct")) {
    $("palletPct").textContent =
      Math.round(currentBoxes / 25 * 100) + "%";
  }

  if ($("layer")) {
    $("layer").textContent =
      "CAMADA " + Math.min(5, Math.floor(currentBoxes / 5) + 1);
  }

  if ($("positionGrid")) {
    [...$("positionGrid").children].forEach((element, index) => {
      element.classList.toggle("filled", index < currentBoxes);
    });
  }

  if ($("elapsed")) {
    $("elapsed").textContent = formatElapsed(state.seconds);
  }

  if ($("cycleTime")) {
    $("cycleTime").textContent =
      state.running ? "Ciclo automático" : "Ciclo: —";
  }

  if (state.failure) {
    $("statusText").textContent = "FALHA NO PROCESSO";
    $("statusMessage").textContent = "Operação interrompida";
    $("statusLight").style.background = "var(--red)";
    $("sceneState").textContent = "● FALHA";

  } else if (state.warning) {
    $("statusText").textContent = "ATENÇÃO NA LINHA";
    $("statusMessage").textContent = "Verifique a ocorrência";
    $("statusLight").style.background = "var(--yellow)";
    $("sceneState").textContent = "● ATENÇÃO";

  } else if (state.running) {
    $("statusText").textContent = "PROCESSO EM OPERAÇÃO";
    $("statusMessage").textContent = "Esteiras e robô em funcionamento";
    $("statusLight").style.background = "var(--green)";
    $("sceneState").textContent = "● EM OPERAÇÃO";

  } else {
    $("statusText").textContent = "PROCESSO PARADO";
    $("statusMessage").textContent = "Aguardando início da operação";
    $("statusLight").style.background = "var(--yellow)";
    $("sceneState").textContent = "● EM ESPERA";
  }

  if ($("sceneState")) {
    $("sceneState").style.color =
      state.failure
        ? "var(--red)"
        : state.warning
        ? "var(--yellow)"
        : state.running
        ? "var(--green)"
        : "";
  }

  if ($("bToggle")) {
    $("bToggle").textContent =
      state.running ? "Ⅱ Pausar processo" : "▶ Iniciar processo";
  }

  if ($("currentStep")) {
    $("currentStep").textContent =
      state.running
        ? "Robô executando ciclo"
        : state.failure
        ? "Falha interrompeu a operação"
        : "Aguardando início";
  }

  if ($("nextStep")) {
    $("nextStep").textContent =
      state.running
        ? "Buscar e posicionar caixa"
        : state.failure
        ? "Verificar equipamento"
        : "Iniciar processo";
  }

  if ($("updated")) $("updated").textContent = timeString();

  updateEquipment();
  renderAlerts();
}

/* =====================================================
   CONTROLES
===================================================== */

function startProcess() {
  if (state.failure || state.boxes >= TOTAL) return;

  state.running = true;
  state.warning = false;

  addHistory("Processo de paletização iniciado");

  addAlert(
    "normal",
    "Processo iniciado",
    "As duas esteiras e o robô estão em funcionamento."
  );

  renderDashboard();
}

function pauseProcess() {
  state.running = false;

  addHistory("Processo pausado pelo operador");
  renderDashboard();
}

function finishProcess() {
  state.running = false;

  addHistory("Lote de 125 caixas finalizado");

  addAlert(
    "normal",
    "Produção finalizada",
    "Todas as caixas foram posicionadas nos paletes."
  );

  renderDashboard();
}

function resetProcess() {
  state.running = false;
  state.warning = false;
  state.failure = false;
  state.boxes = 0;
  state.seconds = 0;
  state.elapsed = 0;

  if (activeBox) {
    scene.remove(activeBox);
    activeBox = null;
  }

  cycle = 0;
  boxCounter = 0;

  palletObjects.forEach(pallet => {
    pallet.slots.forEach(crate => {
      crate.visible = false;
    });
  });

  state.alerts = [];
  state.history = [];

  spawnBeltBoxes();

  addHistory("Novo lote preparado");

  if ($("sceneStep")) {
    $("sceneStep").textContent = "Aguardando início";
  }

  renderDashboard();
}

function simulateWarning() {
  if (state.failure) return;

  state.warning = true;

  addAlert(
    "warning",
    "Atenção na linha",
    "Sensor de presença identificou uma ocorrência simulada."
  );

  addHistory("Alerta de atenção simulado");
  renderDashboard();
}

function simulateFailure() {
  state.running = false;
  state.failure = true;

  if (activeBox) {
    activeBox = null;
  }

  addAlert(
    "failure",
    "Falha no robô paletizador",
    "Equipamento interrompido na simulação."
  );

  addHistory("Falha simulada no robô paletizador");
  renderDashboard();
}

function tick() {
  const now = Date.now();

  if (state.running && !state.failure) {
    state.elapsed += (now - lastTime) / 1000;

    if (state.elapsed >= 1) {
      const passed = Math.floor(state.elapsed);

      state.seconds += passed;
      state.elapsed -= passed;

      if ($("elapsed")) {
        $("elapsed").textContent = formatElapsed(state.seconds);
      }
    }
  }

  lastTime = now;

  if ($("clock")) {
    $("clock").textContent = timeString();
  }
}

/* =====================================================
   INICIALIZAÇÃO
===================================================== */

function init() {
  renderGrid();
  renderEquipment();

  addHistory("Sistema de monitoramento inicializado");

  $("bToggle").addEventListener("click", () => {
    if (state.failure) return;

    if (state.running) {
      pauseProcess();
    } else {
      startProcess();
    }
  });

  $("bReset").addEventListener("click", resetProcess);
  $("bWarn").addEventListener("click", simulateWarning);
  $("bFail").addEventListener("click", simulateFailure);

  if ($("speed")) {
    $("speed").addEventListener("input", event => {
      state.speed = Number(event.target.value);

      if ($("speedValue")) {
        $("speedValue").textContent = state.speed + "%";
      }

      renderDashboard();
    });
  }

  renderDashboard();
  buildScene();

  setInterval(tick, 500);
}

init();

})();
