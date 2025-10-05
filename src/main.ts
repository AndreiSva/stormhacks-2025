import './style.css'
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { generatePerlinNoiseMap, createMeshFromNoiseMap } from '../gen_terrain.ts';

const appDiv = document.querySelector<HTMLDivElement>("#app")!;
export const mainScene = new THREE.Scene();
mainScene.background = new THREE.Color(0xc91aaf);

let currentScene = mainScene;
let isGraphicsInitialized: boolean = false;
let modelPivot: THREE.Group | null = null;

const Direction = {
  LEFT: "LEFT",
  CENTER: "CENTER",
  RIGHT: "RIGHT"
};

const enemies: Enemie[] = [];
const clock = new THREE.Clock(); // for smooth dt-based motion



class Enemie {
  scene: THREE.Scene;
  target: THREE.Object3D;
  mesh: THREE.Mesh;
  speed: number;
  velocity: THREE.Vector3

  constructor(opts: {
    scene: THREE.Scene,
    target: THREE.Object3D,
    position?: THREE.Vector3,
    speed?: number
    velocity?: THREE.Vector3
  }) {
    const { scene, target } = opts;
    this.scene = scene;
    this.target = target;
    this.speed = opts.speed ?? 5.0; // <-- respect provided speed
    this.velocity = opts.velocity?.clone()?.normalize() ?? new THREE.Vector3(0, -1, 0); // default +Y

    const r = 3;
    const geom = new THREE.SphereGeometry(r, 16, 16);
    const mat  = new THREE.MeshStandardMaterial({
      color: 0xffeb3b,
      emissive: 0x2b2500,
      metalness: 0.1,
      roughness: 0.6
    });

    this.mesh = new THREE.Mesh(geom, mat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;

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
    if (this.velocity.y < 0 && relY < -10) return false; // moving down, passed below
    if (this.velocity.y > 0 && relY > 10)  return false; // moving up, passed above

    if (this.mesh.position.lengthSq() > 1e6) return false; // safety
    return true;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }

  static spawnFromNegativeZ(opts: {
    scene: THREE.Scene,
    target: THREE.Object3D,
    zMin?: number,
    zMax?: number,
    xSpread?: number,
    y?: number,
    speed?: number
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
      speed: opts.speed ?? 2.2
    });
  }

  static spawnFromNegativeY(opts: {
    scene: THREE.Scene,
    target: THREE.Object3D,
    yMin?: number,       // how far below to start (near)
    yMax?: number,       // how far below to start (far)
    xSpread?: number,    // +/- range around target.x
    zSpread?: number,    // +/- range around target.z
    speed?: number
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
      targetPos.y + below,                              // start below
      targetPos.z + (Math.random() * 2 - 1) * zSpread   // lateral jitter (Z)
    );

    return new Enemie({
      scene: opts.scene,
      target: opts.target,
      position: pos,
      speed: opts.speed ?? 2.2
    });
  }

  static spawnFromAboveY(opts: {
    scene: THREE.Scene,
    target: THREE.Object3D,
    yMin?: number,       // near distance above (positive)
    yMax?: number,       // far distance above (positive)
    xSpread?: number,
    zSpread?: number,
    speed?: number
  }): Enemie {
    const yMin = opts.yMin ?? 18;   // positive distances
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
      velocity: new THREE.Vector3(0, -1, 0) // straight down
    });
  }

}

class Player {
  constructor(scene: THREE.Scene, camera?: THREE.PerspectiveCamera) {
    const loader = new GLTFLoader();
    loader.load(
      '/low_poly_violin/scene.gltf',
      (gltf) => {
        const root = gltf.scene;
        root.traverse(o => {
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

        // create a pivot at the original center and parent the model to it
        modelPivot = new THREE.Group();
        modelPivot.position.copy(center);
        modelPivot.add(root);
        scene.add(modelPivot);

        if (camera && camera instanceof THREE.PerspectiveCamera) {
          const box = new THREE.Box3().setFromObject(root);
          const size = box.getSize(new THREE.Vector3()).length();
          const center = box.getCenter(new THREE.Vector3());

          const fitDist = size / (2 * Math.tan((camera.fov * Math.PI) / 360));
          const dir = new THREE.Vector3(0, 0, 1);
          camera.position.copy(center.clone().add(dir.multiplyScalar(fitDist * 1.2)));
          camera.position.y -= 20;
          camera.near = size / 100;
          camera.far = size * 10;
          camera.updateProjectionMatrix();
          camera.lookAt(center);
          camera.rotation.x = THREE.MathUtils.degToRad(35);
        }
      },
      (xhr) => {
        const pct = xhr.total ? (xhr.loaded / xhr.total) * 100 : 0;
        console.log(pct.toFixed(1) + '% loaded');
      },
      (error) => {
        console.error('GLTF load error:', error);
      }
    );
  }
}


export function setCurrentScene(scene: THREE.Scene) {
  currentScene = scene;
}

function render(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
  const dt = clock.getDelta();
  if (modelPivot) {
    modelPivot.position.x = Math.sin(Date.now() * 0.001) * 2;
  }
  // Update enemies
  for (let i = enemies.length - 1; i >= 0; i--) {
    const keep = enemies[i].update(dt);
    if (!keep) {
      enemies[i].dispose();
      enemies.splice(i, 1);
    }
  }

  renderer.render(currentScene, camera);
}

function addTriangles(scene: THREE.Scene, triangles: Array<Array<THREE.Vector3>>) {
  triangles.forEach((triangle) => {
    const a = triangle[0];
    const b = triangle[1];
    const c = triangle[2];

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([
        a.x, a.y, a.z,
        b.x, b.y, b.z,
        c.x, c.y, c.z
      ], 3)
    );

    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      color: 0xff5533,
      side: THREE.DoubleSide,
      flatShading: true
    });

    const triangleMesh = new THREE.Mesh(geometry, material);
    triangleMesh.position.set(1000, 0, 10000);
    scene.add(triangleMesh);
  });
}

export function startGame(camera: THREE.PerspectiveCamera) {
  if (!isGraphicsInitialized) {
    console.log("startGame() needs graphics initialized");
    return;
  }
  // Generate Perlin noise map
  const width = 100;  // Width of the terrain grid
  const height = 100; // Height of the terrain grid
  const scale = 5;    // Scale of the terrain (controls smoothness)

  const noiseMap = generatePerlinNoiseMap(width, height, scale);
  // Create terrain mesh from the noise map and add it to the scene
  createMeshFromNoiseMap(mainScene, noiseMap, width, height, scale);

  let player = new Player(mainScene, camera);

  let facing = Direction.CENTER;
  document.addEventListener("keydown", (e) => {
    if (e.key === 'a' || e.key === 'ArrowLeft') {
      if (facing != Direction.LEFT) {
        modelPivot!.rotation.y = -Math.PI / 4;
      }
      facing = Direction.LEFT;
    }

    if (e.key === 'd' || e.key === 'ArrowRight') {
      if (facing != Direction.RIGHT) {
        modelPivot!.rotation.y = Math.PI / 4;
      }
      facing = Direction.RIGHT;
    }

    if (e.key === 's' || e.key === 'ArrowDown') {
      if (facing != Direction.CENTER) {
        modelPivot!.rotation.y = 0;
      }
      facing = Direction.CENTER;
    }
  });

  const spawnHandle = setInterval(() => {
    if (!modelPivot) return; // wait for GLTF to finish
    enemies.push(Enemie.spawnFromAboveY({
      scene: mainScene,
      target: modelPivot!,
      yMin: 18,
      yMax: 36,
      xSpread: 8,
      zSpread: 8,
      speed: 2.2
    }));


    if (enemies.length > 100) {
      const e = enemies.shift();
      e?.dispose();
    }
  }, 1500); // faster cadence feels better when they come in lanes

}

export function graphicsInit() {
  console.log("Initializing Graphics...")

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.6);
  hemi.position.set(0, 1, 0);
  mainScene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 8.2);
  dir.position.set(5, 10, 7);
  dir.castShadow = true;
  mainScene.add(dir);

  // Use temporary aspect; we’ll immediately update it from appDiv’s rect.
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

  renderer.setAnimationLoop(() => { render(renderer, camera) });

  isGraphicsInitialized = true;
  startGame(camera);
}

document.addEventListener("DOMContentLoaded", () => {
  console.log("Content Loaded");
  graphicsInit();
})
