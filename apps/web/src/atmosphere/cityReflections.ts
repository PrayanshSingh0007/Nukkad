import * as THREE from 'three';

/**
 * What shiny things (car paint, car glass) reflect: the real sky colours from the atmosphere,
 * a band of city buildings along the horizon, the sun, and grey asphalt below. Built with a
 * PMREM (blurred for rough surfaces) and rebuilt only when the sun has moved a few degrees, night
 * falls or the rain changes (every ten seconds or so as the game's day runs).
 */
export class CityReflections {
  texture: THREE.Texture;
  private readonly scene = new THREE.Scene();
  private readonly material: THREE.ShaderMaterial;
  private readonly builtSun = new THREE.Vector3(0, 1, 0);
  private builtNight = -1;
  private builtRain = 0;
  private readonly renderer: THREE.WebGLRenderer;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(-0.8, 0.4, 0.4).normalize() },
        uSunColor: { value: new THREE.Color(1, 0.92, 0.8) },
        uTop: { value: new THREE.Color(0.3, 0.5, 0.9) },
        uHorizon: { value: new THREE.Color(0.85, 0.85, 0.85) },
        uNight: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform vec3 uTop;
        uniform vec3 uHorizon;
        uniform float uNight;
        varying vec3 vDir;
        float h(float n) { return fract(sin(n * 127.1) * 43758.5453); }
        void main() {
          vec3 d = normalize(vDir);
          float el = d.y;
          vec3 sky = mix(uHorizon, uTop, pow(max(el, 0.0), 0.5)) * 1.15;
          float s = max(dot(d, uSunDir), 0.0);
          sky += uSunColor * (pow(s, 900.0) * 60.0 + pow(s, 24.0) * 0.8) * (1.0 - uNight);
          // City along the horizon: blocks of different heights and shades, with window rows.
          float az = atan(d.z, d.x) * 46.0;
          float col = floor(az);
          float top = 0.025 + 0.16 * h(col) * h(col + 31.0);
          vec3 wall = mix(vec3(0.34, 0.33, 0.31), vec3(0.62, 0.6, 0.56), h(col + 7.0)) * (uHorizon * 0.6 + 0.15);
          float win = step(0.55, fract(el * 90.0)) * step(0.3, fract(az * 3.0));
          wall = mix(wall, wall * 0.55 + vec3(1.0, 0.75, 0.45) * uNight * 0.9 * step(0.6, h(col + floor(el * 90.0))), win * 0.6);
          vec3 c = el > top ? sky : wall;
          // Asphalt and kerbs below the horizon, a little lighter towards it.
          if (el < 0.0) c = mix(vec3(0.16, 0.16, 0.17), vec3(0.08, 0.08, 0.085), smoothstep(0.0, 0.5, -el)) * (uHorizon * 0.7 + 0.2);
          gl_FragColor = vec4(c * (1.0 - uNight * 0.8), 1.0);
        }`,
    });
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 64, 32), this.material));
    this.texture = this.build();
  }

  /**
   * Rebuilds when the sun has moved or the night level changed. Returns true when the texture
   * is new (the old one is disposed, so callers must hand the new one out right away).
   */
  update(sunDir: THREE.Vector3, sunColor: THREE.Color, top: THREE.Color, horizon: THREE.Color, night: number, rain = 0): boolean {
    if (this.builtNight >= 0 && sunDir.angleTo(this.builtSun) < 0.05 && Math.abs(night - this.builtNight) < 0.08 && Math.abs(rain - this.builtRain) < 0.1) return false;
    const u = this.material.uniforms;
    u.uSunDir.value.copy(sunDir);
    u.uSunColor.value.copy(sunColor).multiplyScalar(1 - rain * 0.95); // overcast: no sun to mirror
    this.builtRain = rain;
    u.uTop.value.copy(top);
    u.uHorizon.value.copy(horizon);
    u.uNight.value = night;
    this.builtSun.copy(sunDir);
    this.builtNight = night;
    const old = this.texture;
    this.texture = this.build();
    old.dispose();
    return true;
  }

  private build(): THREE.Texture {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const texture = pmrem.fromScene(this.scene, 0, 0.1, 100).texture;
    pmrem.dispose();
    return texture;
  }
}
