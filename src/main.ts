import "./style.css";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { generateAndRenderTerrain } from "../gen_terrain.ts";

const appDiv = document.querySelector<HTMLDivElement>("#app")!;
export const mainScene = new THREE.Scene();
mainScene.background = new THREE.Color(0xc91aaf);
const NUM_LIVES = 3;

let currentScene = mainScene;
let isGraphicsInitialized: boolean = false;
let modelPivot: THREE.Group | null = null;

const Direction = {
  LEFT: "LEFT",
  CENTER: "CENTER",
  RIGHT: "RIGHT",
};

const enemies: Enemie[] = [];
const clock = new THREE.Clock(); // for smooth dt-based motion

let cameraRig: THREE.Group | null = null;

let playerRoot: THREE.Group | null = null; // moves & turns; true heading
const MOVE_SPEED = 8; // units per second, constant forward
const TURN_RATE = THREE.MathUtils.degToRad(180); // heading turn rate (deg/sec)

// input state for continuous turning
let turnLeftHeld = false;
let turnRightHeld = false;

export let lives = NUM_LIVES;

export const PLAYER_HIT_EVENT = "playerhit";
export const PLAYER_SURVIVE_100M_EVENT = "playerSurvive100meteres";
export const PLAYER_DIES_EVENT = "playerdies";

const music = new Audio("/glamour.m4a");
music.loop = true;

const TURN_SPEED = THREE.MathUtils.degToRad(360); // max deg/sec the player can turn
let desiredFacing = Direction.CENTER;

function normalizeAngle(a: number) {
  // wrap to [-PI, PI)
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}
function shortestAngleDelta(from: number, to: number) {
  const a = normalizeAngle(to) - normalizeAngle(from);
  if (a > Math.PI) return a - Math.PI * 2;
  if (a < -Math.PI) return a + Math.PI * 2;
  return a;
}
function yawForFacing(face: string) {
  if (face === Direction.LEFT) return -Math.PI / 4;
  if (face === Direction.RIGHT) return Math.PI / 4;
  return 0; // CENTER
}

function emitPlayerHit(detail: any) {
  document.dispatchEvent(new CustomEvent(PLAYER_HIT_EVENT, { detail }));
}
function emitPlayerSurvive100m(detail: any) {
  document.dispatchEvent(new CustomEvent(PLAYER_SURVIVE_100M_EVENT, { detail }));
}
function emitPlayerDies(detail: any) {
  document.dispatchEvent(new CustomEvent(PLAYER_DIES_EVENT, { detail }));
}

let playerColliderRadius = 0.1; // will be updated once model loads
let playerLoaded = false; // becomes true after GLTF finishes

class Enemie {
  scene: THREE.Scene;
  target: THREE.Object3D;
  mesh: THREE.Mesh;
  speed: number;
  velocity: THREE.Vector3;
  radius: number;

  constructor(opts: {
    scene: THREE.Scene;
    target: THREE.Object3D;
    position?: THREE.Vector3;
    speed?: number;
    velocity?: THREE.Vector3;
  }) {
    const { scene, target } = opts;
    this.scene = scene;
    this.target = target;
    this.speed = opts.speed ?? 5.0; // <-- respect provided speed
    this.velocity = opts.velocity?.clone()?.normalize() ?? new THREE.Vector3(0, -1, 0); // default +Y

    const r = 2;
    const geom = new THREE.SphereGeometry(r, 16, 16);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffeb3b,
      emissive: 0x2b2500,
      metalness: 0.1,
      roughness: 0.6,
    });

    this.mesh = new THREE.Mesh(geom, mat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;

    this.radius = r;

    if (opts.position) {
      this.mesh.position.copy(opts.position);
    }

    scene.add(this.mesh);
  }

  update(dt: number): boolean {
    this.mesh.position.addScaledVector(this.velocity, this.speed * dt);

    const playerPos = new THREE.Vector3();
    this.target.getWorldPosition(playerPos);

    // Cull after it has passed the player by 10 units in its travel direction
    const relY = this.mesh.position.y - playerPos.y;
    if (this.velocity.y < 0 && relY < -50) return false; // moving down, passed below
    if (this.velocity.y > 0 && relY > 50) return false; // moving up, passed above

    if (this.mesh.position.lengthSq() > 1e6) return false; // safety
    return true;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }

  static spawnFromNegativeZ(opts: {
    scene: THREE.Scene;
    target: THREE.Object3D;
    zMin?: number;
    zMax?: number;
    xSpread?: number;
    y?: number;
    speed?: number;
  }): Enemie {
    const zMin = opts.zMin ?? 20;
    const zMax = opts.zMax ?? 40;
    const xSpread = opts.xSpread ?? 6;
    const y = opts.y ?? 0.6;

    const targetPos = new THREE.Vector3();
    opts.target.getWorldPosition(targetPos);

    // pick a z behind the player (more negative)
    const behind = -(zMin + Math.random() * (zMax - zMin));
    const pos = new THREE.Vector3(
      targetPos.x + (Math.random() * 2 - 1) * xSpread, // lateral jitter
      y,
      targetPos.z + behind
    );

    return new Enemie({
      scene: opts.scene,
      target: opts.target,
      position: pos,
      speed: opts.speed ?? 2.2,
    });
  }

  static spawnFromNegativeY(opts: {
    scene: THREE.Scene;
    target: THREE.Object3D;
    yMin?: number; // how far below to start (near)
    yMax?: number; // how far below to start (far)
    xSpread?: number; // +/- range around target.x
    zSpread?: number; // +/- range around target.z
    speed?: number;
  }): Enemie {
    const yMin = opts.yMin ?? 20;
    const yMax = opts.yMax ?? 40;
    const xSpread = opts.xSpread ?? 6;
    const zSpread = opts.zSpread ?? 6;

    const targetPos = new THREE.Vector3();
    opts.target.getWorldPosition(targetPos);

    const below = -(yMin + Math.random() * (yMax - yMin)); // negative offset
    const pos = new THREE.Vector3(
      targetPos.x + (Math.random() * 2 - 1) * xSpread, // lateral jitter (X)
      targetPos.y + below, // start below
      targetPos.z + (Math.random() * 2 - 1) * zSpread // lateral jitter (Z)
    );

    return new Enemie({
      scene: opts.scene,
      target: opts.target,
      position: pos,
      speed: opts.speed ?? 2.2,
    });
  }

  static spawnFromAboveY(opts: {
    scene: THREE.Scene;
    target: THREE.Object3D;
    yMin?: number; // near distance above (positive)
    yMax?: number; // far distance above (positive)
    xSpread?: number;
    zSpread?: number;
    speed?: number;
  }): Enemie {
    const yMin = opts.yMin ?? 18; // positive distances
    const yMax = opts.yMax ?? 36;
    const xSpread = opts.xSpread ?? 6;
    const zSpread = opts.zSpread ?? 6;

    const targetPos = new THREE.Vector3();
    opts.target.getWorldPosition(targetPos);

    const dist = yMin + Math.random() * (yMax - yMin); // 18..36
    const pos = new THREE.Vector3(
      targetPos.x + (Math.random() * 2 - 1) * xSpread,
      targetPos.y + dist, // actually above the player
      targetPos.z + (Math.random() * 2 - 1) * zSpread
    );

    return new Enemie({
      scene: opts.scene,
      target: opts.target,
      position: pos,
      speed: opts.speed ?? 2.2,
      velocity: new THREE.Vector3(0, -1, 0), // straight down
    });
  }
}

class Player {
  constructor(scene: THREE.Scene, camera?: THREE.PerspectiveCamera) {
    const loader = new GLTFLoader();
    loader.load(
      "/low_poly_violin/scene.gltf",
      (gltf) => {
        const root = gltf.scene;
        root.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) {
            (o as THREE.Mesh).castShadow = true;
            (o as THREE.Mesh).receiveShadow = true;
          }
        });

        // 1) center the pivot at the model's bbox center
        const box = new THREE.Box3().setFromObject(root);
        let center = box.getCenter(new THREE.Vector3());

        // shift the model so its center sits at the pivot origin
        root.position.sub(center);

        // HELP ME OH SO HELP ME GOD WHAT THE HELL IS THIS CODE WHAT THE HELL

        // create the hierarchy:
        // playerRoot (moves & rotates actual heading)
        //   └─ modelPivot (keeps visual yaw/lean)
        //        └─ gltf root
        playerRoot = new THREE.Group();
        scene.add(playerRoot);
        playerRoot.position.z = 10.0;

        modelPivot = new THREE.Group();

        playerRoot = new THREE.Group();
        scene.add(playerRoot);
        playerRoot.add(modelPivot);

        // shift model so its center sits at pivot origin
        {
          const box = new THREE.Box3().setFromObject(root);
          let center = box.getCenter(new THREE.Vector3());
        }
        root.position.sub(center);

        // add the mesh
        modelPivot.add(root);

        // compute a reasonable collider radius
        const tmpBox = new THREE.Box3().setFromObject(root);
        const tmpSphere = tmpBox.getBoundingSphere(new THREE.Sphere());
        playerColliderRadius = Math.max(0.5, tmpSphere.radius);
        playerLoaded = true;

        if (camera && camera instanceof THREE.PerspectiveCamera) {
          cameraRig = new THREE.Group();
          // IMPORTANT: rig follows the true heading on playerRoot, not modelPivot
          playerRoot.add(cameraRig);

          cameraRig.position.set(0, 0, 0);
          cameraRig.add(camera);

          // a nice offset behind/above the player
          camera.position.set(0, -20.0, 20.0);
          camera.near = 0.1;
          camera.far = 1000;
          camera.updateProjectionMatrix();

          camera.rotation.x = THREE.MathUtils.degToRad(50);
        }
      },
      (xhr) => {
        const pct = xhr.total ? (xhr.loaded / xhr.total) * 100 : 0;
        console.log(pct.toFixed(1) + "% loaded");
      },
      (error) => {
        console.error("GLTF load error:", error);
      }
    );
  }
}

export function setCurrentScene(scene: THREE.Scene) {
  currentScene = scene;
}

function render(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
  const dt = clock.getDelta();

  //
  // 1) Update visual yaw on the child (modelPivot) — this is the lean/look
  //
  if (modelPivot) {
    const targetYaw = yawForFacing(desiredFacing);
    const curYaw = modelPivot.rotation.y;
    const delta = shortestAngleDelta(curYaw, targetYaw);
    const maxStep = TURN_SPEED * dt;
    const step = THREE.MathUtils.clamp(delta, -maxStep, maxStep);
    modelPivot.rotation.y = normalizeAngle(curYaw + step);
  }

  //
  // 2) Update true heading on the parent (playerRoot) and advance forward constantly
  //
  if (playerRoot) {
    let turnInput = 0;
    if (turnLeftHeld) turnInput -= 1;
    if (turnRightHeld) turnInput += 1;

    playerRoot.rotation.z = normalizeAngle(playerRoot.rotation.z + turnInput * TURN_RATE * dt);

    // Move in the direction the player is facing
    const forwardLocal = new THREE.Vector3(0, 1, 0); // local forward
    forwardLocal.applyQuaternion(playerRoot.quaternion); // rotate by current facing
    playerRoot.position.addScaledVector(forwardLocal, MOVE_SPEED * dt);
  }

  // Update enemies
  for (let i = enemies.length - 1; i >= 0; i--) {
    const keep = enemies[i].update(dt);
    if (!keep) {
      enemies[i].dispose();
      enemies.splice(i, 1);
    }
  }

  // Collision: enemies vs player
  if (playerLoaded && playerRoot && modelPivot) {
    const playerPos = new THREE.Vector3();
    (playerRoot ?? modelPivot)!.getWorldPosition(playerPos);
    modelPivot.getWorldPosition(playerPos);

    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      const dist = e.mesh.position.distanceTo(playerPos);
      if (dist <= e.radius + playerColliderRadius - 10) {
        // Fire the custom event with some useful context
        emitPlayerHit({
          time: performance.now(),
          enemyIndex: i,
          enemyPosition: e.mesh.position.clone(),
          playerPosition: playerPos.clone(),
          remainingLives: Math.max(0, lives - 1),
        });

        lives = Math.max(0, lives - 1);
        if (lives <= 0) {
          emitPlayerDies({
            time: performance.now(),
          });
        }

        // Remove the enemy so it doesn't trigger again this frame
        e.dispose();
        enemies.splice(i, 1);
      }
    }
  }

  renderer.render(currentScene, camera);
}

export function startGame(camera: THREE.PerspectiveCamera) {
  if (!isGraphicsInitialized) {
    console.log("startGame() needs graphics initialized");
    return;
  }

  // Define terrain parameters
  const scale = 5; // Scale of the terrain
  const genDistance = 4; // Distance to generate terrain around the player
  const renderDistance = 3; // Distance to render the terrain around the player

  // Initialize player position
  let posX = 0;
  let posY = 0;
  if (modelPivot) {
    posX = modelPivot.position.x;
    posY = modelPivot.position.y;
  }

  // Generate and render the terrain based on the player's position
  // Pass the camera parameter
  generateAndRenderTerrain(
    posX,
    posY,
    scale,
    genDistance,
    renderDistance,
    mainScene,
    camera // Add camera parameter
  );

  let player = new Player(mainScene, camera);

  let facing = Direction.CENTER;
  document.addEventListener("keydown", (e) => {
    if (e.key === "a" || e.key === "ArrowLeft") desiredFacing = Direction.LEFT;
    if (e.key === "d" || e.key === "ArrowRight") desiredFacing = Direction.RIGHT;
    if (e.key === "s" || e.key === "ArrowDown") desiredFacing = Direction.CENTER;
  });

  const surviveHandle = setInterval(() => {
    emitPlayerSurvive100m({
      time: performance.now(),
    });
  }, 1000);

  const spawnHandle = setInterval(() => {
    const targetForEnemies = playerRoot ?? modelPivot; // fallback if load not done
    if (!targetForEnemies) return;

    enemies.push(
      Enemie.spawnFromAboveY({
        scene: mainScene,
        target: targetForEnemies,
        yMin: 20,
        yMax: 30,
        xSpread: 32,
        zSpread: 0,
        speed: 2.2,
      })
    );

    if (enemies.length > 100) {
      const e = enemies.shift();
      e?.dispose();
    }
  }, 1500); // faster cadence feels better when they come in lanes

  document.addEventListener("keydown", (e) => {
    // visual yaw (lean) — unchanged semantics
    if (e.key === "a" || e.key === "ArrowLeft") {
      desiredFacing = Direction.LEFT;
      turnLeftHeld = true;
    }
    if (e.key === "d" || e.key === "ArrowRight") {
      desiredFacing = Direction.RIGHT;
      turnRightHeld = true;
    }
    if (e.key === "s" || e.key === "ArrowDown") {
      desiredFacing = Direction.CENTER;
    }
  });

  document.addEventListener("keyup", (e) => {
    if (e.key === "a" || e.key === "ArrowLeft") turnLeftHeld = false;
    if (e.key === "d" || e.key === "ArrowRight") turnRightHeld = false;
  });

  document.addEventListener("keyup", () => {
    desiredFacing = Direction.CENTER;
  });
}

export function graphicsInit() {
  console.log("Initializing Graphics...");

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.6);
  hemi.position.set(0, 1, 0);
  mainScene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 8.2);
  dir.position.set(5, 10, 7);
  dir.castShadow = true;
  mainScene.add(dir);

  // Use temporary aspect; we'll immediately update it from appDiv's rect.
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.set(0, 1.2, 3);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  appDiv.appendChild(renderer.domElement);

  function resizeToApp() {
    const rect = appDiv.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // Pass false so Three.js doesn't set canvas CSS size (we control it by parent)
    renderer.setSize(w, h, false);
  }

  // Initial sizing
  resizeToApp();

  // React to element resizes (layout, flex, grid, sidebars, etc.)
  const ro = new ResizeObserver(resizeToApp);
  ro.observe(appDiv);

  renderer.setAnimationLoop(() => {
    render(renderer, camera);
  });

  isGraphicsInitialized = true;
  console.log("Graphics initialized.");
  document.addEventListener("startgame", () => {
    console.log("startgame event received");
    startGame(camera);
    console.log("Game started");
  });
}

document.addEventListener("DOMContentLoaded", () => {
  console.log("Content Loaded");
  graphicsInit();
});

document.addEventListener(PLAYER_HIT_EVENT, (e: Event) => {
  const ce = e as CustomEvent;
  console.log("[EVENT] playerhit", ce.detail);
});

document.addEventListener(PLAYER_SURVIVE_100M_EVENT, (e: Event) => {
  const ce = e as CustomEvent;
  //console.log("[EVENT] playerSurvive100meteres", ce.detail);
});

document.addEventListener(PLAYER_DIES_EVENT, (e: Event) => {
  const ce = e as CustomEvent;
  console.log("[EVENT] playerdies", ce.detail);
});
