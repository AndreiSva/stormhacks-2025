import * as THREE from "three";
import * as noise from "noisejs";

// Create a single global noise instance with a fixed seed for consistency
const globalNoiseInstance = new noise.Noise(12345); // Use fixed seed for reproducible terrain

// Generate a 2D Perlin noise map
export function generatePerlinNoiseMap(
  xWidth: number,
  yWidth: number,
  scale: number,
  offsetX: number,
  offsetY: number
): number[][] {
  const map: number[][] = [];

  for (let i = 0; i < yWidth; i++) {
    const row: number[] = [];
    for (let j = 0; j < xWidth; j++) {
      // Calculate absolute world position for this point
      const worldX = offsetX + j * scale;
      const worldY = offsetY + i * scale;

      // Sample noise at world coordinates (divided by frequency factor)
      const noiseFrequency = 20; // Adjust this to change terrain frequency
      const x = worldX / noiseFrequency;
      const y = worldY / noiseFrequency;

      // Sample from the global noise field
      const height = globalNoiseInstance.perlin2(x, y);
      row.push(height);
    }
    map.push(row);
  }

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
      "position",
      new THREE.Float32BufferAttribute([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z], 3)
    );

    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      color: 0xff5533,
      side: THREE.DoubleSide,
      flatShading: true,
    });

    const triangleMesh = new THREE.Mesh(geometry, material);
    scene.add(triangleMesh);
  });
}

export function createMeshFromNoiseMap(
  scene: THREE.Scene,
  noiseMap: number[][],
  scale: number,
  offsetX: number,
  offsetY: number
): THREE.Group {
  const triangles: Array<Array<THREE.Vector3>> = [];
  const height = noiseMap.length;
  const width = noiseMap[0].length;

  console.log(`Creating mesh at offset (${offsetX}, ${offsetY}) with size ${width}x${height}`);

  // Iterate over the grid to create triangles
  for (let i = 0; i < height - 1; i++) {
    for (let j = 0; j < width - 1; j++) {
      // Calculate world positions
      const x = offsetX + j * scale;
      const y = offsetY + i * scale;

      // Get heights from noise map
      const z0 = noiseMap[i][j] * 10;
      const z1 = noiseMap[i][j + 1] * 10;
      const z2 = noiseMap[i + 1][j] * 10;
      const z3 = noiseMap[i + 1][j + 1] * 10;

      // Create vertices
      const a = new THREE.Vector3(x, y, z0);
      const b = new THREE.Vector3(x + scale, y, z1);
      const c = new THREE.Vector3(x, y + scale, z2);
      const d = new THREE.Vector3(x + scale, y + scale, z3);

      // Two triangles per quad
      triangles.push([a, b, c]);
      triangles.push([b, d, c]);
    }
  }

  // Create a group to hold all triangles for this tile
  const tileGroup = new THREE.Group();

  triangles.forEach((triangle) => {
    const a = triangle[0];
    const b = triangle[1];
    const c = triangle[2];

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z], 3)
    );

    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      color: 0xff5533,
      side: THREE.DoubleSide,
      flatShading: true,
    });

    const triangleMesh = new THREE.Mesh(geometry, material);
    tileGroup.add(triangleMesh);
  });

  scene.add(tileGroup);
  return tileGroup;
}

export function generateAndRenderTerrain(
  posX: number,
  posY: number,
  scale: number,
  genDistance: number,
  renderDistance: number,
  scene: THREE.Scene,
  camera?: THREE.PerspectiveCamera
) {
  const width = genDistance * 2 + 1;
  const height = genDistance * 2 + 1;

  // Base tile dimensions (points per tile at highest detail)
  const baseTileSize = 20; // Higher = more detail at close range

  // Initialize arrays
  const mapArray: number[][][] = [];
  const renderArray: (THREE.Group | null)[][] = [];

  // Maximum distance for LOD calculation (diagonal distance across generation area)
  const maxDistance = Math.sqrt(2) * (genDistance * (baseTileSize - 1) * scale);
  enableFog(scene, renderDistance);
  // Generate the terrain with LOD
  for (let i = 0; i < width; i++) {
    const mapRow: number[][] = [];
    const renderRow: (THREE.Group | null)[] = [];

    for (let j = 0; j < height; j++) {
      const tileX = i - genDistance;
      const tileY = j - genDistance;

      // Check if within generation distance
      if (Math.abs(tileX) + Math.abs(tileY) <= genDistance) {
        // Calculate world offset for this tile (using base tile size for positioning)
        const worldOffsetX = posX + tileX * (baseTileSize - 1) * scale;
        const worldOffsetY = posY + tileY * (baseTileSize - 1) * scale;

        // Calculate distance from camera to tile center (if camera is provided)
        let lodFactor = 1.0; // Default to full detail
        if (camera) {
          const tileCenterX = worldOffsetX + ((baseTileSize - 1) * scale) / 2;
          const tileCenterY = worldOffsetY + ((baseTileSize - 1) * scale) / 2;
          const tileDistance = camera.position.distanceTo(new THREE.Vector3(tileCenterX, tileCenterY, 0));
          lodFactor = calculateLODFactor(tileDistance, maxDistance);
        }

        // Adjust tile size based on LOD (less vertices = lower detail)
        const tileSize = Math.max(4, Math.floor(baseTileSize * lodFactor));

        // Generate noise map for this tile with adjusted resolution
        const noiseMap = generatePerlinNoiseMap(
          tileSize,
          tileSize,
          (scale * (baseTileSize - 1)) / (tileSize - 1), // Adjust scale to maintain tile size
          worldOffsetX,
          worldOffsetY
        );
        mapRow.push(noiseMap);

        // Check if within render distance
        if (Math.abs(tileX) + Math.abs(tileY) <= renderDistance) {
          console.log(`Rendering tile at (${tileX}, ${tileY}) with LOD ${lodFactor.toFixed(2)} (${tileSize} points)`);
          const terrainMesh = createMeshFromNoiseMap(
            scene,
            noiseMap,
            (scale * (baseTileSize - 1)) / (tileSize - 1),
            worldOffsetX,
            worldOffsetY
          );
          renderRow.push(terrainMesh);
        } else {
          console.log(`Generated but not rendering tile at (${tileX}, ${tileY})`);
          renderRow.push(null);
        }
      } else {
        mapRow.push([]);
        renderRow.push(null);
      }
    }

    mapArray.push(mapRow);
    renderArray.push(renderRow);
  }

  return { mapArray, renderArray };
}

// Calculate LOD factor based on distance from camera
// Returns a value between 0.2 (far/low detail) and 1.0 (close/high detail)
function calculateLODFactor(distance: number, maxDistance: number): number {
  // Normalize distance to [0, 1]
  const normalizedDistance = Math.min(distance / maxDistance, 1);

  // Inverse relationship: closer = high resolution, farther = low resolution
  // Use a power function for smoother falloff
  const falloff = Math.pow(1 - normalizedDistance, 2);

  // Keep factor between 0.2 and 1.0
  return Math.max(0.2, falloff);
}
export function enableFog(scene: THREE.Scene, renderDistance: number, fogColor: number = 0x87ceeb) {
  // Optional: set default fog color to sky blue )
  // Set the background color of the scene to match the fog color
  scene.background = new THREE.Color(fogColor);

  // Set the fog for the scene
  // The fog will start at 1 unit and extend up to renderDistance * 1.5
  scene.fog = new THREE.Fog(fogColor, 1, renderDistance * 30);
}
