import * as THREE from 'three';

/**
 * Festive serial lights along some compound walls (the strings Bengaluru homes put up for
 * Deepavali and weddings): small round bulbs in red, green, amber and blue, chasing along the
 * string, bright enough for the bloom to give each a glow. Night only. One draw call of points.
 */
export class StringLights {
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;

  /** bulbs: [x, y, z, n] per bulb (n = its number along the string). time: seconds, shared. */
  constructor(bulbs: Float32Array, time: { value: number }) {
    const count = bulbs.length / 4;
    const position = new Float32Array(count * 3);
    const order = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      position.set([bulbs[i * 4], bulbs[i * 4 + 1], bulbs[i * 4 + 2]], i * 3);
      order[i] = bulbs[i * 4 + 3];
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('aBulb', new THREE.BufferAttribute(order, 1));
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: time, uLevel: { value: 0 }, uScale: { value: 800 } },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uScale;
        attribute float aBulb;
        varying vec3 vColour;
        varying float vOn;
        varying float vFade;
        void main() {
          float k = mod(aBulb, 4.0);
          vColour = k < 0.5 ? vec3(1.0, 0.12, 0.08) : k < 1.5 ? vec3(0.18, 1.0, 0.25) : k < 2.5 ? vec3(1.0, 0.72, 0.12) : vec3(0.25, 0.45, 1.0);
          // A chase running along the string, with a slow overall breathing.
          vOn = 0.25 + 0.75 * step(0.45, fract((aBulb - uTime * 5.0) / 6.0));
          vec4 view = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * view;
          float d = -view.z;
          vFade = 1.0 - smoothstep(90.0, 160.0, d);
          gl_PointSize = max(2.0, uScale * 0.13 / max(0.5, d));
        }`,
      fragmentShader: /* glsl */ `
        uniform float uLevel;
        varying vec3 vColour;
        varying float vOn;
        varying float vFade;
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          float core = smoothstep(1.0, 0.2, r);
          float a = core * vOn * vFade * uLevel;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColour * 3.2 * a, 1.0);
        }`,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.points.renderOrder = 3;
  }

  /** night 0–1. */
  setLevel(night: number): void {
    const level = THREE.MathUtils.smoothstep(night, 0.4, 0.85);
    this.material.uniforms.uLevel.value = level;
    this.points.visible = level > 0.01;
  }

  /** Sprite size: call when the screen size or field of view changes. */
  setViewport(heightPx: number, fovDeg: number): void {
    this.material.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
    this.points.removeFromParent();
  }
}
