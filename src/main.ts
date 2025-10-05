import "./style.css";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  initializeInfiniteTerrain,
  updateInfiniteTerrain,
  getTerrainStats,
  disposeInfiniteTerrain
} from "../gen_terrain.ts";

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
let musicPlaying = false;
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
    this.speed = opts.speed ?? 5.0;
    this.velocity = opts.velocity?.clone()?.normalize() ?? new THREE.Vector3(0, -1, 0);

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
    if (this.velocity.y < 0 && relY < -50) return false;
    if (this.velocity.y > 0 && relY > 50) return false;

    if (this.mesh.position.lengthSq() > 1e6) return false;
    return true;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }

  static spawnFromAboveY(opts: {
    scene: THREE.Scene;
    target: THREE.Object3D;
    yMin?: number;
    yMax?: number;
    xSpread?: number;
    zSpread?: number;
    speed?: number;
  }): Enemie {
    const yMin = opts.yMin ?? 18;
    const yMax = opts.yMax ?? 36;
    const xSpread = opts.xSpread ?? 6;
    const zSpread = opts.zSpread ?? 6;

    const targetPos = new THREE.Vector3();
    opts.target.getWorldPosition(targetPos);

    const dist = yMin + Math.random() * (yMax - yMin);
    const pos = new THREE.Vector3(
      targetPos.x + (Math.random() * 2 - 1) * xSpread,
      targetPos.y + dist,
      targetPos.z + (Math.random() * 2 - 1) * zSpread
    );

    return new Enemie({
      scene: opts.scene,
      target: opts.target,
      position: pos,
      speed: opts.speed ?? 2.2,
      velocity: new THREE.Vector3(0, -1, 0),
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

        const box = new THREE.Box3().setFromObject(root);
        let center = box.getCenter(new THREE.Vector3());
        root.position.sub(center);

        playerRoot = new THREE.Group();
        scene.add(playerRoot);
        playerRoot.position.set(0, 0, 10.0);

        modelPivot = new THREE.Group();
        playerRoot.add(modelPivot);

        root.position.sub(center);
        modelPivot.add(root);

        const tmpBox = new THREE.Box3().setFromObject(root);
        const tmpSphere = tmpBox.getBoundingSphere(new THREE.Sphere());
        playerColliderRadius = Math.max(0.5, tmpSphere.radius);
        playerLoaded = true;

        if (camera && camera instanceof THREE.PerspectiveCamera) {
          cameraRig = new THREE.Group();
          playerRoot.add(cameraRig);

          cameraRig.position.set(0, 0, 0);
          cameraRig.add(camera);

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

  // Update visual yaw on the child (modelPivot)
  if (modelPivot) {
    const targetYaw = yawForFacing(desiredFacing);
    const curYaw = modelPivot.rotation.y;
    const delta = shortestAngleDelta(curYaw, targetYaw);
    const maxStep = TURN_SPEED * dt;
    const step = THREE.MathUtils.clamp(delta, -maxStep, maxStep);
    modelPivot.rotation.y = normalizeAngle(curYaw + step);
  }

  // Update true heading on the parent (playerRoot) and advance forward
  if (playerRoot) {
    let turnInput = 0;
    if (turnLeftHeld) turnInput -= 1;
    if (turnRightHeld) turnInput += 1;

    playerRoot.rotation.z = normalizeAngle(playerRoot.rotation.z + turnInput * TURN_RATE * dt);

    const forwardLocal = new THREE.Vector3(0, 1, 0);
    forwardLocal.applyQuaternion(playerRoot.quaternion);
    playerRoot.position.addScaledVector(forwardLocal, MOVE_SPEED * dt);

    // Update infinite terrain based on player position
    updateInfiniteTerrain(
      playerRoot.position.x,
      playerRoot.position.y,
      camera as THREE.PerspectiveCamera
    );
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
    modelPivot.getWorldPosition(playerPos);

    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      const dist = e.mesh.position.distanceTo(playerPos);
      if (dist <= e.radius + playerColliderRadius - 10) {
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

  // Initialize infinite terrain system
  const chunkSize = 30; // tiles per chunk
  const tileScale = 5; // units per tile
  const loadDistance = 4; // chunks to load around player
  const unloadDistance = 5; // chunks to unload beyond

  initializeInfiniteTerrain(
    mainScene,
    camera,
    chunkSize,
    tileScale,
    loadDistance,
    unloadDistance
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
    const targetForEnemies = playerRoot ?? modelPivot;
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
  }, 1500);

  document.addEventListener("keydown", (e) => {
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
    if (e.key === "s" || e.key === "ArrowDown") desiredFacing = Direction.CENTER;
  });

  document.addEventListener("keyup", () => {
    desiredFacing = Direction.CENTER;
  });

  // Log terrain stats periodically (optional)
  setInterval(() => {
    const stats = getTerrainStats();
    if (stats) {
      console.log(`Terrain: ${stats.loadedChunks} chunks, ${stats.totalVertices} vertices`);
    }
  }, 5000);
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
    renderer.setSize(w, h, false);
  }

  resizeToApp();

  const ro = new ResizeObserver(resizeToApp);
  ro.observe(appDiv);

  renderer.setAnimationLoop(() => {
    render(renderer, camera);
  });

  isGraphicsInitialized = true;
  console.log("Graphics initialized.");

  document.addEventListener("startgame", () => {
    console.log("startgame event received");

    if (!musicPlaying) {
      music.play();
      musicPlaying = true;
    }

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
