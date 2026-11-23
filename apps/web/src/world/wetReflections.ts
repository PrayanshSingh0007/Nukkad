import * as THREE from 'three';

/**
 * Lights mirrored in the wet road at night: under every street lamp (and traffic's head and tail
 * lights), a long glowing streak on the ground that runs from the light towards you, the way
 * lamps smear across wet asphalt in the rain. A wet road is a rough mirror: you see a lamp at the point where the
 * line from your eye to its mirror image meets the ground (closer to you the higher the lamp),
 * blurred along the line of sight into a streak.
 *
 * One draw call (an instanced strip per light), placed on the graphics card each frame from the
 * camera's position. Additive, never written to depth; the ambient-occlusion pass skips it.
 * It cannot tell when something stands between you and the light, so low lights that are often
 * behind walls (the gate globes) are left out: their mirror images floated in front of the walls.
 */
const PARS_VERTEX = /* glsl */ `
  attribute vec4 aLight; // x, ground y, z, light height above the ground
  attribute vec4 aTint;  // r, g, b (can be brighter than 1), streak width (m)
  varying vec3 vTint;
  varying float vDelta;  // metres from the mirror point (+ towards you)
  varying float vReach;  // how far the tail towards you reaches (m)
  varying float vBack;   // and the short tail towards the light (m)
  varying float vAcross; // -1 … 1
  varying float vDist;
  varying float vFar;
`;
const MAIN_VERTEX = /* glsl */ `
  vec2 toCam = cameraPosition.xz - aLight.xz;
  float d = max(length(toCam), 0.001);
  vec2 dir = toCam / d;
  vec2 side = vec2(-dir.y, dir.x);
  float eye = max(0.4, cameraPosition.y - aLight.y);
  // Distance from the light's foot to its mirror image's point on the ground.
  float mirror = d * aLight.w / (aLight.w + eye);
  // A rough wet road smears the image along your line of sight: longer the further it is.
  float reach = 0.6 + mirror * 0.12;
  float back = 0.25 + mirror * 0.06;
  float sFrom = max(0.0, mirror - back * 2.5);
  float sTo = max(sFrom, min(d - 1.2, mirror + reach * 2.5));
  float along = mix(sFrom, sTo, position.y);
  // Even width on screen (a strip of even width on the ground would fan out into a cone as it
  // comes towards you): narrower in metres the nearer it gets.
  vec3 centre = vec3(aLight.x + dir.x * along, aLight.y + 0.16, aLight.z + dir.y * along);
  vec3 mirrorPoint = vec3(aLight.x + dir.x * mirror, aLight.y + 0.16, aLight.z + dir.y * mirror);
  // ...and a little wider far off (a rough road blurs a far light more).
  float width = aTint.w * (1.0 + mirror * 0.025) * length(cameraPosition - centre) / max(0.5, length(cameraPosition - mirrorPoint));
  vec2 xz = centre.xz + side * position.x * width;
  vec4 world = vec4(xz.x, centre.y, xz.y, 1.0);
  vec4 view = viewMatrix * world;
  gl_Position = projectionMatrix * view;
  vTint = aTint.rgb;
  vDelta = along - mirror;
  vReach = reach;
  vFar = mirror;
  vBack = back;
  vAcross = position.x * 2.0;
  vDist = -view.z;
`;
const FRAGMENT = /* glsl */ `
  uniform float uStrength;
  varying vec3 vTint;
  varying float vDelta;
  varying float vReach;
  varying float vBack;
  varying float vAcross;
  varying float vDist;
  varying float vFar;
  void main() {
    // Brightest at the mirror point, a long soft tail towards you, a short one towards the light.
    float k = vDelta / (vDelta > 0.0 ? vReach : vBack);
    float along = exp(-k * k);
    float across = 1.0 - vAcross * vAcross;
    across *= across;
    // Gone far away, and fading right at your feet.
    float fade = (1.0 - smoothstep(60.0, 140.0, vDist)) * smoothstep(1.5, 5.0, vDist);
    // A wet road gives back about a third of a light (more in a puddle, less on rough tar).
    // Far lights' mirror images are dimmer (more road between, more of it rough).
    float glow = uStrength * 0.28 * along * across * fade * mix(1.0, 0.35, smoothstep(10.0, 45.0, vFar));
    if (glow < 0.002) discard;
    gl_FragColor = vec4(vTint * glow, 1.0);
  }
`;

export class WetReflections {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly light: THREE.InstancedBufferAttribute;
  private readonly tint: THREE.InstancedBufferAttribute;
  private used = 0;

  /**
   * capacity: how many lights at most. `lights` (optional, for lights that never move):
   * [x, groundY, z, height, r, g, b, width] per light. Colours can be above 1 so the bloom pass
   * catches the brightest part. Moving lights use `set` and `commit` every frame instead.
   */
  constructor(capacity: number, lights?: Float32Array) {
    const strip = new THREE.PlaneGeometry(1, 1, 1, 8).translate(0, 0.5, 0); // x −0.5…0.5, y 0…1
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.index = strip.index;
    this.geometry.setAttribute('position', strip.getAttribute('position'));
    this.light = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, capacity) * 4), 4);
    this.tint = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, capacity) * 4), 4);
    if (!lights) {
      this.light.setUsage(THREE.DynamicDrawUsage);
      this.tint.setUsage(THREE.DynamicDrawUsage);
    }
    this.geometry.setAttribute('aLight', this.light);
    this.geometry.setAttribute('aTint', this.tint);
    this.geometry.instanceCount = 0;
    if (lights) {
      const count = Math.min(capacity, lights.length / 8);
      for (let i = 0; i < count; i++) {
        (this.light.array as Float32Array).set(lights.subarray(i * 8, i * 8 + 4), i * 4);
        (this.tint.array as Float32Array).set(lights.subarray(i * 8 + 4, i * 8 + 8), i * 4);
      }
      this.used = count;
      this.commit();
    }
    this.material = new THREE.ShaderMaterial({
      uniforms: { uStrength: { value: 0 } },
      vertexShader: `${PARS_VERTEX}\nvoid main() {\n${MAIN_VERTEX}\n}`,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 1;
    // The ambient-occlusion pass hides lines (and Line2 meshes) while it draws the scene's
    // shapes; flagging the streaks like one keeps it from shading the road under them.
    (this.mesh as unknown as { isLine2: boolean }).isLine2 = true;
  }

  /** Moving lights: start this frame's list. */
  begin(): void {
    this.used = 0;
  }

  /** Moving lights: one light (ignored when full). */
  set(x: number, ground: number, z: number, height: number, r: number, g: number, b: number, width: number): void {
    if (this.used >= this.light.count) return;
    const i = this.used++;
    (this.light.array as Float32Array).set([x, ground, z, height], i * 4);
    (this.tint.array as Float32Array).set([r, g, b, width], i * 4);
  }

  /** Moving lights: send this frame's list to the graphics card. */
  commit(): void {
    this.geometry.instanceCount = this.used;
    this.light.needsUpdate = true;
    this.tint.needsUpdate = true;
  }

  /** night: 0 day … 1 night; wet: 0 dry … 1 soaked. */
  setLevel(night: number, wet: number): void {
    const strength = THREE.MathUtils.smoothstep(night, 0.3, 0.85) * THREE.MathUtils.smoothstep(wet, 0.05, 0.6);
    this.material.uniforms.uStrength.value = strength;
    this.mesh.visible = strength > 0.01 && this.used > 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }
}
