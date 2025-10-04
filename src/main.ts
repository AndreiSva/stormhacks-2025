import './style.css'
import * as THREE from 'three';

const appDiv = document.querySelector<HTMLDivElement>("#app")!;
export const mainScene = new THREE.Scene();
let currentScene = mainScene;

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
      side: THREE.DoubleSide,   // see front & back; remove if you want back-face culling
      flatShading: true
    });

    const triangleMesh = new THREE.Mesh(geometry, material);
    scene.add(triangleMesh);
  });
}

export function graphicsInit() {
  console.log("Initializing Graphics...")
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  const renderer = new THREE.WebGLRenderer({antialias: true});
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setAnimationLoop(() => {render(renderer, camera)});
  appDiv.appendChild(renderer.domElement);
}

document.addEventListener("DOMContentLoaded", () => {
  console.log("Content Loaded");
  graphicsInit();
})
