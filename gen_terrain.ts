import * as THREE from 'three';
import * as noise from 'noisejs';

// Create a single global noise instance with a fixed seed for consistency
const globalNoiseInstance = new noise.Noise(12345);

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
  private baseTileResolution: number = 20; // Vertices per tile at highest LOD

  constructor(
    scene: THREE.Scene,
    chunkSize: number = 16,
    tileScale: number = 5,
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

    // Calculate LOD based on distance from camera
    let lodFactor = 1.0;
    if (camera) {
      const chunkCenterX = worldOffsetX + chunkWorldSize / 2;
      const chunkCenterY = worldOffsetY + chunkWorldSize / 2;
      const distance = camera.position.distanceTo(
        new THREE.Vector3(chunkCenterX, chunkCenterY, 0)
      );
      const maxDistance = this.loadDistance * chunkWorldSize * Math.SQRT2;
      lodFactor = this.calculateLODFactor(distance, maxDistance);
    }

    // Adjust resolution based on LOD
    const tileResolution = Math.max(4, Math.floor(this.baseTileResolution * lodFactor));

    // Generate noise map for entire chunk
    const noiseMap = this.generatePerlinNoiseMap(
      this.chunkSize + 1, // +1 for edge vertices
      this.chunkSize + 1,
      this.tileScale,
      worldOffsetX,
      worldOffsetY
    );

    // Create mesh from noise map
    const meshGroup = this.createMeshFromNoiseMap(
      noiseMap,
      this.tileScale,
      worldOffsetX,
      worldOffsetY
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
  private generatePerlinNoiseMap(
    width: number,
    height: number,
    scale: number,
    offsetX: number,
    offsetY: number
  ): number[][] {
    const map: number[][] = [];
    const noiseFrequency = 20;

    for (let i = 0; i < height; i++) {
      const row: number[] = [];
      for (let j = 0; j < width; j++) {
        const worldX = offsetX + j * scale;
        const worldY = offsetY + i * scale;
        const x = worldX / noiseFrequency;
        const y = worldY / noiseFrequency;
        const height = globalNoiseInstance.perlin2(x, y);
        row.push(height);
      }
      map.push(row);
    }

    return map;
  }

  // Create mesh from noise map
  private createMeshFromNoiseMap(
    noiseMap: number[][],
    scale: number,
    offsetX: number,
    offsetY: number
  ): THREE.Group {
    const group = new THREE.Group();
    const height = noiseMap.length;
    const width = noiseMap[0].length;

    // Combine all triangles into a single geometry for better performance
    const positions: number[] = [];
    const indices: number[] = [];
    let vertexIndex = 0;

    for (let i = 0; i < height - 1; i++) {
      for (let j = 0; j < width - 1; j++) {
        const x = offsetX + j * scale;
        const y = offsetY + i * scale;

        const z0 = noiseMap[i][j] * 10;
        const z1 = noiseMap[i][j + 1] * 10;
        const z2 = noiseMap[i + 1][j] * 10;
        const z3 = noiseMap[i + 1][j + 1] * 10;

        // Add vertices for this quad
        const startIndex = vertexIndex;
        
        positions.push(x, y, z0);
        positions.push(x + scale, y, z1);
        positions.push(x, y + scale, z2);
        positions.push(x + scale, y + scale, z3);

        // First triangle (0, 1, 2)
        indices.push(startIndex, startIndex + 1, startIndex + 2);
        // Second triangle (1, 3, 2)
        indices.push(startIndex + 1, startIndex + 3, startIndex + 2);

        vertexIndex += 4;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      color: 0xff5533,
      side: THREE.DoubleSide,
      flatShading: true
    });

    const mesh = new THREE.Mesh(geometry, material);
    group.add(mesh);

    return group;
  }

  // Calculate LOD factor
  private calculateLODFactor(distance: number, maxDistance: number): number {
    const normalizedDistance = Math.min(distance / maxDistance, 1);
    const falloff = Math.pow(1 - normalizedDistance, 2);
    return Math.max(0.2, falloff);
  }

  // Load chunk if not already loaded
  private loadChunk(chunkX: number, chunkY: number, camera?: THREE.PerspectiveCamera): void {
    const key = this.getChunkKey(chunkX, chunkY);
    
    if (this.chunks.has(key)) {
      // Update access time
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
    
    // Remove from scene
    this.scene.remove(chunk.meshGroup);
    
    // Dispose of geometries and materials
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

    // Check if player moved to a new chunk
    if (playerChunkX === this.lastPlayerChunkX && playerChunkY === this.lastPlayerChunkY) {
      return; // No chunk change, no need to update
    }

    this.lastPlayerChunkX = playerChunkX;
    this.lastPlayerChunkY = playerChunkY;

    console.log(`Player in chunk (${playerChunkX}, ${playerChunkY})`);

    // Load chunks in range
    for (let dx = -this.loadDistance; dx <= this.loadDistance; dx++) {
      for (let dy = -this.loadDistance; dy <= this.loadDistance; dy++) {
        // Use Manhattan distance for chunk loading
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
      
      // Unload if beyond unload distance
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

  enableFog(scene, loadDistance * chunkSize * tileScale);

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