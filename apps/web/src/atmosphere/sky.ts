import * as THREE from 'three';

/**
 * The sky: a big dome around the camera painted by a small shader — colour fades from
 * the horizon to the top, a sun disc with a glow, a moon disc, and stars at night.
 * No textures, one draw call.
 */
const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // always at the far end of the depth range
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uMoonDir;
  uniform float uNight;
  uniform float uTime;
  uniform float uRain;
  uniform float uFlash;
  uniform float uRainbow;
  varying vec3 vDir;
  /** A rainbow's colour at t = 0 (violet, inside) … 1 (red, outside). */
  vec3 nkSpectrum(float t) {
    float hue = (1.0 - clamp(t, 0.0, 1.0)) * 0.78;
    vec3 k = clamp(abs(fract(hue + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
    return k * k * (3.0 - 2.0 * k);
  }

  float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise2(p); p = p * 2.03 + 17.0; a *= 0.5; }
    return v;
  }

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  void main() {
    vec3 dir = normalize(vDir);
    float up = max(dir.y, 0.0);
    // Deep blue overhead fading into a pale, slightly warm haze band at the horizon.
    vec3 color = mix(uHorizon, uTop, pow(up, 0.45));
    color = mix(color, uHorizon * vec3(1.04, 1.0, 0.94), (1.0 - smoothstep(0.0, 0.12, up)) * 0.5);
    if (dir.y < 0.0) color = mix(uHorizon, uHorizon * 0.7, min(1.0, -dir.y * 4.0));

    float sun = dot(dir, uSunDir);
    float sunUp = max(sun, 0.0);
    // Sun disc, a tight glow and a wide warm haze around it (light scattered by the city's air).
    color += uSunColor * (smoothstep(0.9993, 0.9997, sun) * 5.0 + pow(sunUp, 64.0) * 0.45 + pow(sunUp, 6.0) * 0.18 + pow(sunUp, 2.0) * 0.06) * (1.0 - uRain * 0.92);

    // The city goes on past the map: a skyline far off on the horizon — low rooftops all round,
    // clusters of towers here and there — faint in the haze by day, dark with lit windows and
    // blinking red warning lights on the tallest towers at night.
    {
      float az = atan(dir.z, dir.x);
      float district = noise2(vec2(az * 2.2, 3.7)) * 0.7 + noise2(vec2(az * 7.0, 1.3)) * 0.3;
      float col = floor(az * 70.0);
      float cluster = smoothstep(0.48, 0.68, district);
      float towers = cluster * pow(hash(vec3(col, 3.0, 1.0)), 1.6);
      // Low rooftops of uneven height (a stepped, broken line), towers rising out of clusters.
      float roofs = 0.003 + 0.0035 * hash(vec3(floor(az * 140.0), 5.0, 2.0)) + 0.002 * hash(vec3(floor(az * 37.0), 6.0, 2.0));
      float top = max(roofs, 0.005 + 0.036 * towers);
      if (dir.y < top && dir.y > -0.03) {
        vec3 haze = mix(uHorizon, uHorizon * vec3(0.8, 0.84, 0.92), 0.55);
        float shade = 0.9 + 0.2 * hash(vec3(col, 8.0, 4.0)); // buildings a touch lighter or darker
        vec3 farCity = mix(haze, vec3(0.016, 0.016, 0.024) * shade, uNight * 0.92);
        // Windows in rows: few lit in the low sprawl, more in the towers; warm, some cooler.
        vec2 wg = vec2(az * 1100.0, dir.y * 900.0);
        vec2 wcell = floor(wg);
        vec2 wf = fract(wg);
        float litShare = mix(0.1, 0.3, step(roofs + 0.0005, dir.y) * cluster);
        float window = step(1.0 - litShare, hash(vec3(wcell, 7.0))) * step(0.35, wf.x) * step(0.45, wf.y);
        vec3 lamp = mix(vec3(1.0, 0.72, 0.4), vec3(0.85, 0.9, 1.0), step(0.8, hash(vec3(wcell, 9.0))));
        farCity += lamp * window * 0.5 * uNight * smoothstep(0.0, 0.004, top - dir.y);
        // Aircraft warning light on the tallest towers.
        float tall = step(0.026, top);
        float beacon = tall * smoothstep(0.0025, 0.0, abs(dir.y - top + 0.0008)) * smoothstep(0.35, 0.0, abs(fract(az * 70.0) - 0.5)) * step(0.0, sin(uTime * 2.4 + col));
        farCity += vec3(1.0, 0.1, 0.05) * beacon * 2.0 * (0.3 + 0.7 * uNight);
        color = mix(color, farCity, (1.0 - uRain * 0.6));
      }
    }

    if (dir.y > 0.015) {
      vec2 base = dir.xz / (dir.y + 0.12);
      float fadeOut = smoothstep(0.015, 0.2, dir.y); // thin out into the horizon haze
      vec3 lit = mix(vec3(1.0, 0.985, 0.95), uSunColor, 0.3) * (1.0 - uNight * 0.86) * (1.0 - uRain * 0.45);
      vec3 shade = mix(uHorizon * 0.82, vec3(0.5, 0.55, 0.65), 0.55) * (1.0 - uNight * 0.8) * (1.0 - uRain * 0.5);

      // High cirrus: thin streaks stretched along the wind.
      vec2 cq = base * vec2(0.6, 2.4) + vec2(uTime * 0.004, 0.0);
      float cirrus = smoothstep(0.55, 0.85, fbm(cq * 1.3)) * 0.35;
      color = mix(color, lit, cirrus * fadeOut);

      // Cumulus: puffy clouds. Density towards the sun gives them shaded bellies and bright tops.
      vec2 cp = base * 1.4 + vec2(uTime * 0.006, uTime * 0.002);
      float cover = fbm(cp);
      float body = smoothstep(0.5 - uRain * 0.36, 0.74 - uRain * 0.3, cover); // rain: the sky closes over
      vec2 toSun = normalize(uSunDir.xz + 1e-4) * 0.07;
      float shadowing = smoothstep(0.5, 0.85, fbm(cp + toSun)) * 0.55 + smoothstep(0.5, 0.85, fbm(cp + toSun * 2.2)) * 0.45;
      vec3 cloud = mix(lit, shade, shadowing * 0.75);
      // Silver lining: thin cloud edges glow when you look towards the sun.
      float edge = body * (1.0 - smoothstep(0.55, 0.9, cover));
      cloud += uSunColor * edge * pow(sunUp, 4.0) * 0.9;
      color = mix(color, cloud, body * fadeOut * 0.95);
      // Lightning lights the cloud bellies from inside.
      color += vec3(0.75, 0.8, 1.0) * uFlash * (0.4 + body) * fadeOut;
    }

    // A rainbow after rain, opposite the sun: the main bow 40–42.5° from the point straight
    // opposite it (violet inside, red outside), a fainter second bow at 50–53.5° with its colours
    // the other way round, and the sky a little brighter inside the main bow.
    if (uRainbow > 0.001) {
      float bowA = degrees(acos(clamp(dot(dir, -uSunDir), -1.0, 1.0)));
      float t1 = (bowA - 40.0) / 2.5;
      float band1 = smoothstep(-0.1, 0.15, t1) * (1.0 - smoothstep(0.85, 1.1, t1));
      float t2 = 1.0 - (bowA - 50.2) / 3.4;
      float band2 = smoothstep(-0.1, 0.15, t2) * (1.0 - smoothstep(0.85, 1.1, t2));
      float inside = 1.0 - smoothstep(34.0, 40.0, bowA);
      float aboveGround = smoothstep(-0.01, 0.06, dir.y);
      vec3 bow = nkSpectrum(t1) * band1 * 0.32 + nkSpectrum(t2) * band2 * 0.075 + vec3(0.05) * inside;
      color += bow * uRainbow * aboveGround;
    }

    // Now and then an aeroplane crosses high overhead: a dark speck with a white contrail
    // spreading behind it by day; red, green and white blinking lights at night.
    {
      float pslot = floor(uTime / 140.0);
      float pt = (uTime - pslot * 140.0) / 90.0; // 90 s to cross
      if (pt < 1.0 && hash(vec3(pslot, 11.0, 3.0)) > 0.35 && uRain < 0.6) {
        float paz = hash(vec3(pslot, 12.0, 1.0)) * 6.2832;
        float pel = radians(35.0 + 30.0 * hash(vec3(pslot, 13.0, 2.0)));
        vec3 mid = vec3(cos(pel) * cos(paz), sin(pel), cos(pel) * sin(paz));
        vec3 across = normalize(cross(mid, vec3(0.0, 1.0, 0.0)));
        vec3 head = normalize(mid + across * (pt - 0.5) * 2.2);
        float toHead = length(dir - head);
        float day = 1.0 - uNight;
        color = mix(color, vec3(0.15, 0.16, 0.18), smoothstep(0.0024, 0.0008, toHead) * day);
        // Contrail: behind the plane, widening and fading as it spreads.
        vec3 tailEnd = normalize(mid + across * ((pt - 0.5) * 2.2 - 0.5));
        vec3 seg = head - tailEnd;
        float along = clamp(dot(dir - tailEnd, seg) / max(dot(seg, seg), 1e-6), 0.0, 1.0);
        float off = length(dir - (tailEnd + seg * along));
        float width = 0.0032 + (1.0 - along) * 0.008;
        float trail = smoothstep(width, width * 0.3, off) * smoothstep(0.0, 0.25, along) * (0.25 + 0.75 * along) * step(0.003, toHead);
        color = mix(color, vec3(1.0) * (0.75 + 0.35 * day), trail * day * 0.9 * (1.0 - uRain));
        // Lights at night: a white strobe twice a second, red and green on the wingtips.
        float strobe = step(0.92, fract(uTime * 1.1)) + step(0.92, fract(uTime * 1.1 + 0.15));
        vec3 lightsCol = vec3(1.0) * strobe * smoothstep(0.0016, 0.0, toHead) * 2.5;
        lightsCol += vec3(1.0, 0.1, 0.05) * smoothstep(0.0012, 0.0, length(dir - head + across * 0.0015)) * 1.2;
        lightsCol += vec3(0.1, 1.0, 0.2) * smoothstep(0.0012, 0.0, length(dir - head - across * 0.0015)) * 1.2;
        color += lightsCol * uNight;
      }
    }

    float moon = dot(dir, uMoonDir);
    color = mix(color, vec3(0.92, 0.94, 1.0), smoothstep(0.9994, 0.9997, moon) * uNight);

    vec3 cell = floor(dir * 220.0);
    float starSeed = hash(cell);
    // A small soft dot somewhere in its cell (not the whole square cell).
    vec3 inCell = fract(dir * 220.0) - 0.5 - (vec3(hash(cell + 1.7), hash(cell + 3.3), hash(cell + 5.9)) - 0.5) * 0.4;
    float star = step(0.9975, starSeed) * smoothstep(0.02, 0.25, dir.y) * smoothstep(0.42, 0.08, length(inCell)) * (0.6 + 0.8 * fract(starSeed * 371.0));
    // Twinkling: each star flickers at its own pace, more near the horizon (thicker air).
    float twinkle = 0.65 + 0.35 * sin(uTime * (2.0 + 5.0 * fract(starSeed * 91.3)) + starSeed * 60.0) * (0.4 + 0.6 * (1.0 - smoothstep(0.1, 0.6, dir.y)));
    float clearDark = smoothstep(0.7, 1.0, uNight) * (1.0 - smoothstep(0.0, 0.25, uRain));
    color += vec3(star * twinkle) * 0.9 * clearDark; // stars only when it is properly dark and clear

    // Now and then a shooting star: a short bright streak sliding down across the sky (one
    // chance every 17 s, and about half the chances come to something).
    float slot = floor(uTime / 17.0);
    float since = uTime - slot * 17.0;
    if (clearDark > 0.01 && since < 0.8 && hash(vec3(slot, 4.0, 9.0)) > 0.5) {
      float az = hash(vec3(slot, 1.0, 2.0)) * 6.2832;
      float el = radians(30.0 + 35.0 * hash(vec3(slot, 2.0, 3.0)));
      vec3 start = vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));
      vec3 travel = normalize(normalize(cross(start, vec3(0.0, 1.0, 0.0))) * (hash(vec3(slot, 3.0, 5.0)) > 0.5 ? 1.0 : -1.0) + vec3(0.0, -0.5, 0.0));
      float t = since / 0.8;
      vec3 head = normalize(start + travel * 0.3 * t);
      vec3 tail = normalize(start + travel * 0.3 * max(0.0, t - 0.3));
      vec3 seg = head - tail;
      float along = clamp(dot(dir - tail, seg) / max(dot(seg, seg), 1e-6), 0.0, 1.0);
      float off = length(dir - (tail + seg * along));
      color += vec3(1.0, 0.97, 0.9) * smoothstep(0.0022, 0.0, off) * along * (1.0 - t) * 1.6 * clearDark;
    }

    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

export class Sky {
  readonly mesh: THREE.Mesh;
  readonly uniforms = {
    uTop: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color() },
    uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uNight: { value: 0 },
    uTime: { value: 0 },
    /** 0 = clear … 1 = storm: clouds close in and darken, the sun disappears. */
    uRain: { value: 0 },
    /** Lightning: a brief white flash in the clouds. */
    uFlash: { value: 0 },
    /** A rainbow opposite the sun (0–1), for a few minutes after rain. */
    uRainbow: { value: 0 },
  };

  constructor() {
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: false, // the sky colours are already picked for the screen
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(10, 24, 12), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  /** The dome travels with the camera, so it is never reached. */
  follow(camera: THREE.Camera): void {
    this.mesh.position.copy(camera.position);
    this.uniforms.uTime.value = (performance.now() / 1000) % 100000;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
