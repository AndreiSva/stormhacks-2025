import * as THREE from 'three';
import * as noise from 'noisejs';
// @ts-ignore
import Delaunator from 'https://cdn.skypack.dev/delaunator@5.0.0';

// Create a single global noise instance with a fixed seed for consistency
const globalNoiseInstance = new noise.Noise(12345);
// A list of 7 colors to map to your terrain heights
const colorGradient = [
  new THREE.Color(0x000000),  // Black
  new THREE.Color(0x5a5a5a),  // Dark gray
  new THREE.Color(0x999999),  // Gray
  new THREE.Color(0x66cc66),  // Greenish
  new THREE.Color(0x339933),  // Dark green
  new THREE.Color(0x8b4513),  // Brown
  new THREE.Color(0xffffff)   // White
];

// Chunk management system
interface ChunkData {
  key: string;
  meshGroup: THREE.Group;
  noiseMap: number[][];
  worldX: number;
  worldY: number;
  lastAccessTime: number;
}

class TerrainChunkManager {
  private chunks: Map<string, ChunkData> = new Map();
  private scene: THREE.Scene;
  private chunkSize: number; // Number of tiles per chunk side
  private tileScale: number; // Scale of each tile
  private loadDistance: number; // Distance in chunks to load
  private unloadDistance: number; // Distance in chunks to unload
  private lastPlayerChunkX: number = NaN;
  private lastPlayerChunkY: number = NaN;
  private maxPointsPerChunk: number = 400; // Max sampled points for Delaunay

  constructor(
    scene: THREE.Scene,
    chunkSize: number = 40,
    tileScale: number = 2,
    loadDistance: number = 3,
    unloadDistance: number = 5
  ) {
    this.scene = scene;
    this.chunkSize = chunkSize;
    this.tileScale = tileScale;
    this.loadDistance = loadDistance;
    this.unloadDistance = unloadDistance;
  }

  // Convert world position to chunk coordinates
  private worldToChunk(worldX: number, worldY: number): { chunkX: number; chunkY: number } {
    const chunkWorldSize = this.chunkSize * this.tileScale;
    return {
      chunkX: Math.floor(worldX / chunkWorldSize),
      chunkY: Math.floor(worldY / chunkWorldSize)
    };
  }

  // Generate unique key for chunk
  private getChunkKey(chunkX: number, chunkY: number): string {
    return `${chunkX},${chunkY}`;
  }

  // Generate a chunk at given chunk coordinates
  private generateChunk(chunkX: number, chunkY: number, camera?: THREE.PerspectiveCamera): ChunkData {
    const key = this.getChunkKey(chunkX, chunkY);
    
    // Calculate world offset for this chunk
    const chunkWorldSize = this.chunkSize * this.tileScale;
    const worldOffsetX = chunkX * chunkWorldSize;
    const worldOffsetY = chunkY * chunkWorldSize;

    // Generate noise map for entire chunk (with extra padding for edge calculations)
    const noiseMap = this.generatePerlinNoiseMap(
      this.chunkSize + 1,
      this.chunkSize + 1,
      this.tileScale,
      worldOffsetX,
      worldOffsetY
    );

    // Compute gradients
    const gradients = this.computeGradientMagnitude(noiseMap);

    // Sample points based on gradient
    const sampledPoints = this.samplePointsByGradient(
      noiseMap,
      gradients,
      this.maxPointsPerChunk,
      worldOffsetX,
      worldOffsetY
    );

    // Create mesh using Delaunay triangulation
    const meshGroup = this.createMeshFromDelaunay(
      sampledPoints,
      worldOffsetX,
      worldOffsetY,
      chunkWorldSize
    );

    const chunkData: ChunkData = {
      key,
      meshGroup,
      noiseMap,
      worldX: worldOffsetX,
      worldY: worldOffsetY,
      lastAccessTime: performance.now()
    };

    return chunkData;
  }

  // Generate noise map
  // Generate noise map using Fractal Brownian Motion (fBm)
  // Generate noise map using Fractal Brownian Motion (fBm)
  private generatePerlinNoiseMap(
    width: number,
    height: number,
    scale: number,
    offsetX: number,
    offsetY: number
  ): number[][] {
    const map: number[][] = [];
    const noiseFrequency = 20;
    
    // fBm parameters
    const octaves = 8; // Number of noise layers
    const lacunarity = 2.0; // Frequency multiplier per octave
    const persistence = 0.5; // Amplitude multiplier per octave

    for (let i = 0; i < height; i++) {
      const row: number[] = [];
      for (let j = 0; j < width; j++) {
        const worldX = offsetX + j * scale;
        const worldY = offsetY + i * scale;
        
        // Compute fBm
        let amplitude = 5;
        let frequency = 2.0;
        let noiseValue = 1.0;
        let maxValue = 0.0; // For normalization
        
        for (let octave = 0; octave < octaves; octave++) {
          const x = (worldX / noiseFrequency) * frequency;
          const y = (worldY / noiseFrequency) * frequency;
          
          const sample = globalNoiseInstance.perlin2(x, y);
          noiseValue += sample * amplitude;
          maxValue += amplitude;
          
          amplitude *= persistence;
          frequency *= lacunarity;
        }
        
        // Normalize to [-1, 1] range
        noiseValue /= maxValue;
        
        row.push(noiseValue);
      }
      map.push(row);
    }

    return map;
  }

  // Compute gradient magnitude for a heightmap
  private computeGradientMagnitude(heightmap: number[][]): number[][] {
    const height = heightmap.length;
    const width = heightmap[0].length;
    const gradients: number[][] = [];

    for (let i = 0; i < height; i++) {
      const row: number[] = [];
      for (let j = 0; j < width; j++) {
        const dx = this.sobelX(heightmap, i, j, width, height);
        const dy = this.sobelY(heightmap, i, j, width, height);
        const magnitude = Math.sqrt(dx * dx + dy * dy);
        row.push(magnitude);
      }
      gradients.push(row);
    }

    return gradients;
  }

  // Sobel operator for X direction
  private sobelX(map: number[][], i: number, j: number, width: number, height: number): number {
    const get = (y: number, x: number) => {
      const cy = Math.max(0, Math.min(height - 1, y));
      const cx = Math.max(0, Math.min(width - 1, x));
      return map[cy][cx];
    };

    return (
      -get(i - 1, j - 1) - 2 * get(i, j - 1) - get(i + 1, j - 1) +
      get(i - 1, j + 1) + 2 * get(i, j + 1) + get(i + 1, j + 1)
    );
  }

  // Sobel operator for Y direction
  private sobelY(map: number[][], i: number, j: number, width: number, height: number): number {
    const get = (y: number, x: number) => {
      const cy = Math.max(0, Math.min(height - 1, y));
      const cx = Math.max(0, Math.min(width - 1, x));
      return map[cy][cx];
    };

    return (
      -get(i - 1, j - 1) - 2 * get(i - 1, j) - get(i - 1, j + 1) +
      get(i + 1, j - 1) + 2 * get(i + 1, j) + get(i + 1, j + 1)
    );
  }

  // Sample points based on gradient (more samples on steep areas)
  private samplePointsByGradient(
    noiseMap: number[][],
    gradients: number[][],
    maxPoints: number,
    offsetX: number,
    offsetY: number
  ): { x: number; y: number; z: number }[] {
    const height = noiseMap.length;
    const width = noiseMap[0].length;
    
    // Combined loop: find max gradient and build probability map simultaneously
    let maxGrad = 0;
    const probMap: number[] = [];
    const positions: { i: number; j: number }[] = [];

    for (let i = 0; i < height; i++) {
      for (let j = 0; j < width; j++) {
        maxGrad = Math.max(maxGrad, gradients[i][j]);
        probMap.push(gradients[i][j]); // Store raw gradient temporarily
        positions.push({ i, j });
      }
    }
    
    // Normalize probabilities and compute total in single pass
    let totalProb = 0;
    for (let idx = 0; idx < probMap.length; idx++) {
      probMap[idx] = maxGrad > 0 ? (probMap[idx] / maxGrad) + 0.1 : 1;
      totalProb += probMap[idx];
    }

    const sampledPoints: { x: number; y: number; z: number }[] = [];
    const sampledIndices = new Set<number>();

    // Always include corner points for seamless boundaries
    const corners = [
      { i: 0, j: 0 },
      { i: 0, j: width - 1 },
      { i: height - 1, j: 0 },
      { i: height - 1, j: width - 1 }
    ];

    for (const corner of corners) {
      sampledPoints.push({
        x: offsetX + corner.j * this.tileScale,
        y: offsetY + corner.i * this.tileScale,
        z: noiseMap[corner.i][corner.j] * 10
      });
      const idx = corner.i * width + corner.j;
      sampledIndices.add(idx);
    }

    // Add edge points for better chunk boundaries
    const edgeSpacing = Math.floor(Math.max(width, height) / 8);
    for (let i = 0; i < height; i += edgeSpacing) {
      if (i === 0 || i === height - 1) continue;
      // Left edge
      sampledPoints.push({
        x: offsetX,
        y: offsetY + i * this.tileScale,
        z: noiseMap[i][0] * 10
      });
      sampledIndices.add(i * width);
      // Right edge
      sampledPoints.push({
        x: offsetX + (width - 1) * this.tileScale,
        y: offsetY + i * this.tileScale,
        z: noiseMap[i][width - 1] * 10
      });
      sampledIndices.add(i * width + width - 1);
    }
    for (let j = 0; j < width; j += edgeSpacing) {
      if (j === 0 || j === width - 1) continue;
      // Top edge
      sampledPoints.push({
        x: offsetX + j * this.tileScale,
        y: offsetY,
        z: noiseMap[0][j] * 10
      });
      sampledIndices.add(j);
      // Bottom edge
      sampledPoints.push({
        x: offsetX + j * this.tileScale,
        y: offsetY + (height - 1) * this.tileScale,
        z: noiseMap[height - 1][j] * 10
      });
      sampledIndices.add((height - 1) * width + j);
    }

    // Sample remaining points weighted by gradient using alias method for O(1) sampling
    const actualMaxPoints = Math.min(maxPoints, probMap.length);
    
    // Build cumulative distribution for faster sampling
    const cumulative: number[] = new Array(probMap.length);
    cumulative[0] = probMap[0];
    for (let i = 1; i < probMap.length; i++) {
      cumulative[i] = cumulative[i - 1] + probMap[i];
    }
    
    let attempts = 0;
    const maxAttempts = actualMaxPoints * 2; // Reduced from 3x

    while (sampledPoints.length < actualMaxPoints && attempts < maxAttempts) {
      attempts++;
      const r = Math.random() * totalProb;
      
      // Binary search for faster lookup
      let left = 0;
      let right = cumulative.length - 1;
      let selectedIdx = -1;
      
      while (left <= right) {
        const mid = (left + right) >> 1; // Bitwise operation for floor division
        if (cumulative[mid] < r) {
          left = mid + 1;
        } else {
          selectedIdx = mid;
          right = mid - 1;
        }
      }

      if (selectedIdx >= 0 && !sampledIndices.has(selectedIdx)) {
        sampledIndices.add(selectedIdx);
        const { i, j } = positions[selectedIdx];
        sampledPoints.push({
          x: offsetX + j * this.tileScale,
          y: offsetY + i * this.tileScale,
          z: noiseMap[i][j] * 10
        });
      }
    }

    return sampledPoints;
  }

  // Create mesh using Delaunay triangulation
  // Create mesh using Delaunay triangulation
  private createMeshFromDelaunay(
    points: { x: number; y: number; z: number }[],
    offsetX: number,
    offsetY: number,
    chunkWorldSize: number
  ): THREE.Group {
    const group = new THREE.Group();

    if (points.length < 3) {
      console.warn('Not enough points for triangulation');
      return group;
    }

    // Prepare coordinates for Delaunator (only x, y for 2D triangulation)
    // Use flat array constructor for best performance
    const coords: number[] = new Array(points.length * 2);
    for (let i = 0; i < points.length; i++) {
      coords[i * 2] = points[i].x;
      coords[i * 2 + 1] = points[i].y;
    }

    // Perform Delaunay triangulation using flat array constructor
    const delaunay = new Delaunator(coords);

    // Build geometry from triangulation
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];

    // Find min and max heights for this chunk
    // Safe initialization - we already checked points.length >= 3
    let minHeight = points[0].z;
    let maxHeight = points[0].z;
    for (let i = 1; i < points.length; i++) {
      const z = points[i].z;
      if (z < minHeight) minHeight = z;
      if (z > maxHeight) maxHeight = z;
    }

    // Prevent division by zero
    const heightRange = maxHeight - minHeight || 1;

    // Process triangles and calculate colors
    const validTriangles: number[][] = [];
    for (let i = 0; i < delaunay.triangles.length; i += 3) {
      const i0 = delaunay.triangles[i];
      const i1 = delaunay.triangles[i + 1];
      const i2 = delaunay.triangles[i + 2];

      const p0 = points[i0];
      const p1 = points[i1];
      const p2 = points[i2];

      // Filter out very large triangles
      const d01 = Math.hypot(p0.x - p1.x, p0.y - p1.y);
      const d12 = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const d20 = Math.hypot(p2.x - p0.x, p2.y - p0.y);

      const maxEdge = chunkWorldSize * 0.5;
      if (d01 < maxEdge && d12 < maxEdge && d20 < maxEdge) {
        // Calculate triangle center height
        const centerHeight = (p0.z + p1.z + p2.z) / 3;
        
        // Normalize height to [0, 1]
        const normalizedHeight = (centerHeight - minHeight) / heightRange;
        
        // Map to color gradient
        const colorIndex = normalizedHeight * (colorGradient.length - 1);
        const lowerIndex = Math.floor(colorIndex);
        const upperIndex = Math.min(lowerIndex + 1, colorGradient.length - 1);
        const t = colorIndex - lowerIndex;
        
        // Interpolate between colors
        const color = new THREE.Color();
        color.lerpColors(colorGradient[lowerIndex], colorGradient[upperIndex], t);

        validTriangles.push([i0, i1, i2, color.r, color.g, color.b]);
      }
    }

    // Build geometry with vertex colors
    const vertexMap = new Map<number, number>();
    let vertexIndex = 0;

    validTriangles.forEach(([i0, i1, i2, r, g, b]) => {
      const triangle = [i0, i1, i2];
      
      triangle.forEach(originalIndex => {
        if (!vertexMap.has(originalIndex)) {
          const p = points[originalIndex];
          positions.push(p.x, p.y, p.z);
          vertexMap.set(originalIndex, vertexIndex);
          vertexIndex++;
        }
        
        const mappedIndex = vertexMap.get(originalIndex)!;
        indices.push(mappedIndex);
        colors.push(r, g, b);
      });
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      flatShading: true
    });

    const mesh = new THREE.Mesh(geometry, material);
    group.add(mesh);

    return group;
  }

  // Load chunk if not already loaded
  private loadChunk(chunkX: number, chunkY: number, camera?: THREE.PerspectiveCamera): void {
    const key = this.getChunkKey(chunkX, chunkY);
    
    if (this.chunks.has(key)) {
      const chunk = this.chunks.get(key)!;
      chunk.lastAccessTime = performance.now();
      return;
    }

    console.log(`Loading chunk (${chunkX}, ${chunkY})`);
    
    const chunkData = this.generateChunk(chunkX, chunkY, camera);
    this.chunks.set(key, chunkData);
    this.scene.add(chunkData.meshGroup);
  }

  // Unload chunk
  private unloadChunk(chunkX: number, chunkY: number): void {
    const key = this.getChunkKey(chunkX, chunkY);
    const chunk = this.chunks.get(key);
    
    if (!chunk) return;

    console.log(`Unloading chunk (${chunkX}, ${chunkY})`);
    
    this.scene.remove(chunk.meshGroup);
    
    chunk.meshGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (obj.material instanceof THREE.Material) {
          obj.material.dispose();
        }
      }
    });

    this.chunks.delete(key);
  }

  // Update terrain based on player position
  update(playerX: number, playerY: number, camera?: THREE.PerspectiveCamera): void {
    const { chunkX: playerChunkX, chunkY: playerChunkY } = this.worldToChunk(playerX, playerY);

    if (playerChunkX === this.lastPlayerChunkX && playerChunkY === this.lastPlayerChunkY) {
      return;
    }

    this.lastPlayerChunkX = playerChunkX;
    this.lastPlayerChunkY = playerChunkY;

    console.log(`Player in chunk (${playerChunkX}, ${playerChunkY})`);

    // Load chunks in range
    for (let dx = -this.loadDistance; dx <= this.loadDistance; dx++) {
      for (let dy = -this.loadDistance; dy <= this.loadDistance; dy++) {
        if (Math.abs(dx) + Math.abs(dy) <= this.loadDistance) {
          this.loadChunk(playerChunkX + dx, playerChunkY + dy, camera);
        }
      }
    }

    // Unload chunks out of range
    const chunksToUnload: string[] = [];
    this.chunks.forEach((chunk, key) => {
      const [chunkXStr, chunkYStr] = key.split(',');
      const chunkX = parseInt(chunkXStr);
      const chunkY = parseInt(chunkYStr);
      
      const dx = Math.abs(chunkX - playerChunkX);
      const dy = Math.abs(chunkY - playerChunkY);
      
      if (dx + dy > this.unloadDistance) {
        chunksToUnload.push(key);
      }
    });

    chunksToUnload.forEach(key => {
      const [chunkXStr, chunkYStr] = key.split(',');
      this.unloadChunk(parseInt(chunkXStr), parseInt(chunkYStr));
    });
  }

  // Get statistics
  getStats(): { loadedChunks: number; totalVertices: number } {
    let totalVertices = 0;
    this.chunks.forEach(chunk => {
      chunk.meshGroup.traverse(obj => {
        if (obj instanceof THREE.Mesh && obj.geometry) {
          const posAttr = obj.geometry.getAttribute('position');
          if (posAttr) totalVertices += posAttr.count;
        }
      });
    });

    return {
      loadedChunks: this.chunks.size,
      totalVertices
    };
  }

  // Clean up all chunks
  dispose(): void {
    this.chunks.forEach((chunk) => {
      this.scene.remove(chunk.meshGroup);
      chunk.meshGroup.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (obj.material instanceof THREE.Material) {
            obj.material.dispose();
          }
        }
      });
    });
    this.chunks.clear();
  }
}

// Enable fog
export function enableFog(
  scene: THREE.Scene,
  renderDistance: number,
  fogColor: number = 0x87CEEB
): void {
  scene.background = new THREE.Color(fogColor);
  scene.fog = new THREE.Fog(fogColor, 1, renderDistance * 1);
}

// Create and manage terrain with infinite chunks
let terrainManager: TerrainChunkManager | null = null;

export function initializeInfiniteTerrain(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  chunkSize: number = 16,
  tileScale: number = 5,
  loadDistance: number = 3,
  unloadDistance: number = 5
): TerrainChunkManager {
  if (terrainManager) {
    terrainManager.dispose();
  }

  terrainManager = new TerrainChunkManager(
    scene,
    chunkSize,
    tileScale,
    loadDistance,
    unloadDistance
  );

  enableFog(scene, loadDistance * chunkSize * tileScale * 0.75);

  return terrainManager;
}

export function updateInfiniteTerrain(
  playerX: number,
  playerY: number,
  camera?: THREE.PerspectiveCamera
): void {
  if (terrainManager) {
    terrainManager.update(playerX, playerY, camera);
  }
}

export function getTerrainStats(): { loadedChunks: number; totalVertices: number } | null {
  return terrainManager ? terrainManager.getStats() : null;
}

export function disposeInfiniteTerrain(): void {
  if (terrainManager) {
    terrainManager.dispose();
    terrainManager = null;
  }
}