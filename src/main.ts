import './style.css'
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const appDiv = document.querySelector<HTMLDivElement>("#app")!;
export const mainScene = new THREE.Scene();
let currentScene = mainScene;
let isGraphicsInitialized: boolean = false;

class Player {
  constructor(scene: THREE.Scene) {
    const loader = new GLTFLoader();
    loader.load(
	  'low_poly_violin/scene.gltf',
	  function (gltf) {
		scene.add(gltf.scene);

		gltf.animations; // Array<THREE.AnimationClip>
		gltf.scene; // THREE.Group
		gltf.scenes; // Array<THREE.Group>
		gltf.cameras; // Array<THREE.Camera>
		gltf.asset; // Object

	  },
	  // called while loading is progressing
	  function (xhr) {

		console.log((xhr.loaded / xhr.total * 100) + '% loaded');

	  },
	  // called when loading has errors
	  function (error) {
		console.log('An error happened: ' + error);
	  }
    );
  }
}

export function setCurrentScene(scene: THREE.Scene) {
  currentScene = scene;
}

function render(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
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

export function startGame() {
  if (!isGraphicsInitialized) {
    console.log("startGame() needs graphics initialized");
    return;
  }

  let player = new Player(mainScene);
}

export function graphicsInit() {
  console.log("Initializing Graphics...")

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
  hemi.position.set(0, 1, 0);
  mainScene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 1.2);
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
}


document.addEventListener("DOMContentLoaded", () => {
  console.log("Content Loaded");
  graphicsInit();
  startGame();
})
