import * as THREE from 'three';

/**
 * Leaves and petals drifting down from the trees near you: green-gold leaves from the rain
 * trees and neem, orange-red petals from the gulmohar, pink from the tabebuia, magenta from
 * bougainvillea. Each one tumbles and sways down on the breeze (more of them, and faster, in a
 * storm), lies on the ground a while, then fades and starts again from another tree. Only the
 * trees actually drawn near you drop anything. One draw call of points.
 */
const LEAVES = 260;
const NEAR_M = 38;

/** Per species (treeModels order): crown height (m, 0 = drops nothing), and colour. */
const SPECIES: [crown: number, colour: number][] = [
  [6.2, 0x9aa43a], // rain tree
  [5.2, 0x6e8f2e], // ashoka
  [1.2, 0x7f9a3a], // bush
  [5.0, 0xb5a23a], // neem (yellowing leaves)
  [5.3, 0xe4572e], // gulmohar petals
  [5.3, 0xf2a7c3], // tabebuia petals
  [0, 0], // coconut palm
  [1.6, 0xd6338a], // bougainvillea
];

/** The same colours in the renderer's working (linear) space. */
const LEAF_COLOURS = SPECIES.map(([, hex]) => new THREE.Color(hex));

interface Leaf {
  x: number;
  y: number;
  z: number;
  ground: number;
  age: number;
  /** Seconds lying on the ground so far (−1 = still falling). */
  lying: number;
  speed: number;
  phase: number;
  species: number;
}

export class FallingLeaves {
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;
  private readonly leaves: Leaf[] = [];
  private readonly position = new Float32Array(LEAVES * 3);
  private readonly data = new Float32Array(LEAVES * 4); // r, g, b, alpha·spin
  /** Trees near you (x, base y, z, species). */
  private nearTrees: number[] = [];
  private searchIn = 0;
  private wind = 0;
  private time = 0;
  /** Drawn trees: variant → mesh (from the world). */
  private readonly meshes: (THREE.InstancedMesh | null)[];

  constructor(meshes: (THREE.InstancedMesh | null)[]) {
    this.meshes = meshes;
    for (let i = 0; i < LEAVES; i++) this.leaves.push({ x: 0, y: -999, z: 0, ground: 0, age: 0, lying: 99, speed: 0.7, phase: Math.random() * 6.28, species: 0 });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.position, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aLeaf', new THREE.BufferAttribute(this.data, 4).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uScale: { value: 800 }, uLight: { value: new THREE.Color(1, 1, 1) } },
      vertexShader: /* glsl */ `
        uniform float uScale;
        attribute vec4 aLeaf;
        varying vec4 vLeaf;
        void main() {
          vLeaf = aLeaf;
          vec4 view = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * view;
          float d = -view.z;
          gl_PointSize = aLeaf.a <= 0.0 ? 0.0 : min(18.0, uScale * 0.09 / max(0.5, d));
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uLight;
        varying vec4 vLeaf;
        void main() {
          // A small leaf: an ellipse squashed by its tumble (alpha's fraction carries the spin).
          float spin = fract(vLeaf.a * 7.0) * 6.283;
          vec2 q = gl_PointCoord - 0.5;
          vec2 r = vec2(cos(spin) * q.x - sin(spin) * q.y, sin(spin) * q.x + cos(spin) * q.y);
          float squash = 0.35 + 0.65 * abs(cos(spin * 1.7));
          float shape = length(vec2(r.x / 0.5, r.y / (0.5 * squash)));
          if (shape > 1.0) discard;
          gl_FragColor = vec4(vLeaf.rgb * uLight * (0.8 + 0.2 * (1.0 - shape)), clamp(floor(vLeaf.a) / 100.0, 0.0, 1.0));
        }`,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  /** wind 0–1 (storms), light = the daylight colour (dim at night). */
  setWorld(wind: number, light: THREE.Color): void {
    this.wind = wind;
    this.material.uniforms.uLight.value.copy(light);
  }

  setViewport(heightPx: number, fovDeg: number): void {
    this.material.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  update(dt: number, x: number, z: number): void {
    this.time += dt;
    this.searchIn -= dt;
    if (this.searchIn <= 0) {
      this.searchIn = 1;
      this.nearTrees = [];
      const m = new THREE.Matrix4();
      this.meshes.forEach((mesh, species) => {
        if (!mesh || !SPECIES[species] || SPECIES[species][0] === 0) return;
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, m);
          const e = m.elements;
          if (Math.abs(e[12] - x) < NEAR_M && Math.abs(e[14] - z) < NEAR_M) this.nearTrees.push(e[12], e[13], e[14], species);
        }
      });
    }
    const trees = this.nearTrees.length / 4;
    // Gusts: more leaves let go, and they blow further.
    const gust = 0.5 + 0.5 * Math.sin(this.time * 0.4) * Math.sin(this.time * 0.23 + 1.3);
    const blow = 0.35 + this.wind * 2.2 + gust * 0.4;
    let shown = 0;
    this.leaves.forEach((leaf, i) => {
      if (leaf.lying >= 0) {
        leaf.lying += dt;
        // Respawn after lying a while (sooner in a storm), from a random tree near you.
        if (leaf.lying > 7 - this.wind * 4 && trees > 0 && Math.random() < dt * (0.6 + this.wind * 2)) {
          const t = Math.floor(Math.random() * trees);
          const species = this.nearTrees[t * 4 + 3];
          const crown = SPECIES[species][0];
          const spread = crown > 3 ? 3.2 : 1.2;
          leaf.x = this.nearTrees[t * 4] + (Math.random() - 0.5) * spread * 2;
          leaf.z = this.nearTrees[t * 4 + 2] + (Math.random() - 0.5) * spread * 2;
          leaf.ground = this.nearTrees[t * 4 + 1];
          leaf.y = leaf.ground + crown * (0.75 + Math.random() * 0.35);
          leaf.species = species;
          leaf.lying = -1;
          leaf.age = 0;
          leaf.speed = 0.45 + Math.random() * 0.45;
        }
      } else {
        leaf.age += dt;
        // Fluttering down: slow fall, side-to-side sway, carried by the breeze.
        const sway = Math.sin(leaf.age * 2.4 + leaf.phase);
        leaf.y -= dt * leaf.speed * (0.8 + 0.4 * Math.abs(sway)) * (1 + this.wind * 0.8);
        leaf.x += dt * (sway * 0.6 + blow * 0.7);
        leaf.z += dt * (Math.cos(leaf.age * 1.9 + leaf.phase) * 0.4 + blow * 0.3);
        if (leaf.y <= leaf.ground + 0.04) {
          leaf.y = leaf.ground + 0.04;
          leaf.lying = 0;
        }
      }
      // Lying leaves fade away over their last two seconds.
      const fade = leaf.lying < 0 ? Math.min(1, leaf.age * 2) : Math.max(0, 1 - Math.max(0, leaf.lying - 5) / 2);
      const visible = leaf.y > -900 && Math.hypot(leaf.x - x, leaf.z - z) < NEAR_M + 10 ? fade : 0;
      this.position.set([leaf.x, leaf.y, leaf.z], i * 3);
      const colour = LEAF_COLOURS[leaf.species];
      const spin = leaf.lying < 0 ? (leaf.age * 0.35 + leaf.phase) % 1 : leaf.phase % 1;
      // alpha (whole part, 0–100) and spin (fraction) packed in one number.
      this.data.set([colour.r, colour.g, colour.b, visible > 0.01 ? Math.round(visible * 100) + spin * 0.999 : 0], i * 4);
      if (visible > 0.01) shown++;
    });
    this.points.visible = shown > 0;
    const g = this.points.geometry;
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aLeaf') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
    this.points.removeFromParent();
  }
}
