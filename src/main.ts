import './style.css'
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { generatePerlinNoiseMap, createMeshFromNoiseMap } from '../gen_terrain.ts';

const appDiv = document.querySelector<HTMLDivElement>("#app")!;
export const mainScene = new THREE.Scene();
let currentScene = mainScene;
let isGraphicsInitialized: boolean = false;
let modelPivot: THREE.Group | null = null;

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
        const center = box.getCenter(new THREE.Vector3());

        // shift the model so its center sits at the pivot origin
        root.position.sub(center);

        // create a pivot at the original center and parent the model to it
        modelPivot = new THREE.Group();
        modelPivot.position.copy(center);
        modelPivot.add(root);
        scene.add(modelPivot);

        modelPivot.rotation.x = -(Math.PI / 2 - Math.PI / 4);

        if (camera && camera instanceof THREE.PerspectiveCamera) {
          const box = new THREE.Box3().setFromObject(root);
          const size = box.getSize(new THREE.Vector3()).length();
          const center = box.getCenter(new THREE.Vector3());

          const fitDist = size / (2 * Math.tan((camera.fov * Math.PI) / 360));
          const dir = new THREE.Vector3(0, 0, 1);
          camera.position.copy(center.clone().add(dir.multiplyScalar(fitDist * 1.2)));
          camera.near = size / 100;
          camera.far = size * 10;
          camera.updateProjectionMatrix();
          camera.lookAt(center);
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
  if (modelPivot) {
    modelPivot.position.x = Math.sin(Date.now() * 0.001) * 2;
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

  const Direction = {
    LEFT: "LEFT",
    CENTER: "CENTER",
    RIGHT: "RIGHT"
  };

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

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 1.2, 3);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);

  renderer.outputColorSpace = THREE.SRGBColorSpace;

  renderer.setAnimationLoop(() => { render(renderer, camera) });
  appDiv.appendChild(renderer.domElement);
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  isGraphicsInitialized = true;
  startGame(camera);
}


document.addEventListener("DOMContentLoaded", () => {
  console.log("Content Loaded");
  graphicsInit();
})
