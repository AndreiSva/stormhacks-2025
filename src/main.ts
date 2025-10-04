import './style.css'
import * as THREE from 'three';

const appDiv = document.querySelector<HTMLDivElement>("#app")!;
export const mainScene = new THREE.Scene();
let currentScene = mainScene;

function render(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
  renderer.render(currentScene, camera);
}

export function setCurrentScene(scene: THREE.Scene) {
  currentScene = scene;
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
  graphicsInit();
})
