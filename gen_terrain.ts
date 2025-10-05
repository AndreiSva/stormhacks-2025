import * as THREE from 'three'; import * as noise from 'noisejs'; 
// Import the noisejs module 
// Function to generate a 2D Perlin noise map 



export function generatePerlinNoiseMap(width: number, height: number, scale: number): number[][] {
  console.log("Generating Perlin Noise Map...");
  const noiseInstance = new noise.Noise(Math.random());
  const map: number[][] = [];

  for (let y = 0; y < height; y++) {
    const row: number[] = [];
    for (let x = 0; x < width; x++) {
      const value = noiseInstance.perlin2(x / scale, y / scale);
      row.push(value);
    }
    map.push(row);
  }

  console.log("Noise Map:", map);
  return map;
}


export function addTriangles(scene: THREE.Scene, triangles: Array<Array<THREE.Vector3>>) {
  console.log("Adding triangles to the scene...");
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
export function createMeshFromNoiseMap(scene: THREE.Scene, noiseMap: number[][], width: number, height: number, scale: number) {
  const triangles: Array<Array<THREE.Vector3>> = [];
  
  // Iterate over the grid of points to create triangles from each square
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const x0 = x * scale, y0 = y * scale, z0 = noiseMap[y][x] * 10;
      const x1 = (x + 1) * scale, y1 = y * scale, z1 = noiseMap[y][x + 1] * 10;
      const x2 = x * scale, y2 = (y + 1) * scale, z2 = noiseMap[y + 1][x] * 10;
      const x3 = (x + 1) * scale, y3 = (y + 1) * scale, z3 = noiseMap[y + 1][x + 1] * 10;

      // Create two triangles per square
      triangles.push([
        new THREE.Vector3(x0, y0, z0),
        new THREE.Vector3(x1, y1, z1),
        new THREE.Vector3(x2, y2, z2)
      ]);
      triangles.push([
        new THREE.Vector3(x1, y1, z1),
        new THREE.Vector3(x3, y3, z3),
        new THREE.Vector3(x2, y2, z2)
      ]);
    }
  }

  // Add triangles to the scene
  addTriangles(scene, triangles);
}
