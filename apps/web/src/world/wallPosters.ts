import * as THREE from 'three';

/**
 * Posters pasted on the street side of compound walls, as on every Bengaluru street: tuition
 * classes, rooms to let, yoga and dance classes, a made-up film, a sale, a stencilled "Stick no
 * bills" — all invented (no brands, no real names or numbers), painted once into one picture.
 * Weathered: some faded by the sun, edges torn, older ones peeling. One draw call.
 */
const CELL_W = 160;
const CELL_H = 200;
const COLUMNS = 4;
const ROWS = 4;
const DESIGNS = COLUMNS * ROWS;
const KANNADA = '"Noto Sans Kannada", "Kannada Sangam MN", "Tunga", system-ui, sans-serif';
const LATIN = 'system-ui, -apple-system, Roboto, sans-serif';

type Painter = (c: CanvasRenderingContext2D, w: number, h: number) => void;

const text = (c: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, colour: string, font = LATIN, weight = 800): void => {
  c.font = `${weight} ${size}px ${font}`;
  c.fillStyle = colour;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  let px = size;
  while (c.measureText(s).width > CELL_W - 16 && px > 8) {
    px -= 1;
    c.font = `${weight} ${px}px ${font}`;
  }
  c.fillText(s, x, y);
};
const lines = (c: CanvasRenderingContext2D, y0: number, count: number, colour: string, w: number): void => {
  c.fillStyle = colour;
  for (let i = 0; i < count; i++) c.fillRect(18 + (i % 2) * 6, y0 + i * 11, w - 36 - (i % 3) * 14, 4);
};

const DESIGN_LIST: Painter[] = [
  // Tuition classes.
  (c, w, h) => {
    c.fillStyle = '#f4e04d';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#c0262d';
    c.fillRect(0, 0, w, 46);
    text(c, 'TUITION', w / 2, 24, 28, '#fff');
    text(c, 'ಟ್ಯೂಷನ್ ತರಗತಿ', w / 2, 66, 18, '#1d2a6b', KANNADA, 700);
    text(c, 'MATHS · SCIENCE', w / 2, 92, 15, '#1d2a6b');
    lines(c, 112, 5, '#3b3b3b', w);
    text(c, 'CALL 9xxxx xxxxx', w / 2, 180, 13, '#c0262d');
  },
  // House for rent.
  (c, w, h) => {
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, w, h);
    text(c, 'ಬಾಡಿಗೆಗೆ ಮನೆ', w / 2, 36, 24, '#b0151b', KANNADA, 800);
    text(c, 'HOUSE FOR RENT', w / 2, 72, 17, '#111');
    text(c, '2 BHK', w / 2, 104, 30, '#111');
    lines(c, 130, 4, '#555', w);
  },
  // A made-up film.
  (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#2b1055');
    g.addColorStop(1, '#d7263d');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(255,220,120,0.9)';
    c.beginPath();
    c.arc(w * 0.5, h * 0.36, 38, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#1a0b2e';
    c.fillRect(w * 0.5 - 22, h * 0.3, 44, 70);
    text(c, 'ನಮ್ಮ ಊರು', w / 2, 150, 22, '#ffe066', KANNADA, 800);
    text(c, 'IN CINEMAS', w / 2, 178, 13, '#fff');
  },
  // Yoga classes.
  (c, w, h) => {
    c.fillStyle = '#ff9f1c';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#fff';
    c.lineWidth = 5;
    c.beginPath();
    c.arc(w / 2, 62, 16, 0, Math.PI * 2);
    c.moveTo(w / 2, 78);
    c.lineTo(w / 2, 118);
    c.moveTo(w / 2 - 34, 96);
    c.lineTo(w / 2 + 34, 96);
    c.stroke();
    text(c, 'YOGA', w / 2, 146, 32, '#fff');
    text(c, 'ಯೋಗ ತರಗತಿ', w / 2, 178, 16, '#5a2400', KANNADA, 700);
  },
  // Stencilled "stick no bills" (painted straight on the wall).
  (c, w, h) => {
    c.clearRect(0, 0, w, h);
    text(c, 'STICK', w / 2, 70, 30, '#202020', LATIN, 900);
    text(c, 'NO BILLS', w / 2, 108, 30, '#202020', LATIN, 900);
  },
  // Dance classes.
  (c, w, h) => {
    c.fillStyle = '#e3175b';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#ffd400';
    c.fillRect(0, h - 56, w, 56);
    text(c, 'DANCE', w / 2, 52, 34, '#fff');
    text(c, 'CLASSES', w / 2, 88, 20, '#fff');
    text(c, 'ಭರತನಾಟ್ಯ', w / 2, 120, 18, '#fff', KANNADA, 700);
    text(c, 'ADMISSIONS OPEN', w / 2, h - 28, 13, '#5a0021');
  },
  // Sale.
  (c, w, h) => {
    c.fillStyle = '#1b998b';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#fff';
    c.beginPath();
    c.arc(w / 2, 86, 52, 0, Math.PI * 2);
    c.fill();
    text(c, '50%', w / 2, 80, 36, '#d7263d');
    text(c, 'OFF', w / 2, 112, 16, '#d7263d');
    text(c, 'MEGA SALE', w / 2, 172, 20, '#fff');
  },
  // Music show.
  (c, w, h) => {
    c.fillStyle = '#111827';
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 7; i++) {
      c.fillStyle = `hsl(${(i * 47) % 360} 90% 60%)`;
      c.fillRect(14 + i * 19, 120 - (i % 3) * 18 - 30, 12, 60 + (i % 3) * 18);
    }
    text(c, 'LIVE MUSIC', w / 2, 36, 22, '#f9c80e');
    text(c, 'SAT 7 PM', w / 2, 168, 18, '#fff');
  },
  // Computer classes.
  (c, w, h) => {
    c.fillStyle = '#dbeafe';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#1e3a8a';
    c.fillRect(30, 40, 100, 64);
    c.fillStyle = '#93c5fd';
    c.fillRect(36, 46, 88, 52);
    text(c, 'COMPUTER', w / 2, 128, 22, '#1e3a8a');
    text(c, 'CLASSES', w / 2, 152, 18, '#1e3a8a');
    lines(c, 170, 2, '#1e3a8a', w);
  },
  // Lost cat (a drawing, no photo).
  (c, w, h) => {
    c.fillStyle = '#fefae0';
    c.fillRect(0, 0, w, h);
    text(c, 'MISSING', w / 2, 28, 26, '#bc4749');
    c.fillStyle = '#6c584c';
    c.beginPath();
    c.arc(w / 2, 92, 34, 0, Math.PI * 2);
    c.moveTo(w / 2 - 30, 68);
    c.lineTo(w / 2 - 20, 44);
    c.lineTo(w / 2 - 8, 62);
    c.moveTo(w / 2 + 30, 68);
    c.lineTo(w / 2 + 20, 44);
    c.lineTo(w / 2 + 8, 62);
    c.fill();
    text(c, 'ಬೆಕ್ಕು ಕಾಣೆಯಾಗಿದೆ', w / 2, 146, 15, '#333', KANNADA, 700);
    lines(c, 164, 3, '#555', w);
  },
  // Blood donation camp.
  (c, w, h) => {
    c.fillStyle = '#fff';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#d00000';
    c.beginPath();
    c.moveTo(w / 2, 30);
    c.quadraticCurveTo(w / 2 + 40, 90, w / 2, 110);
    c.quadraticCurveTo(w / 2 - 40, 90, w / 2, 30);
    c.fill();
    text(c, 'BLOOD DONATION', w / 2, 136, 15, '#d00000');
    text(c, 'CAMP · SUNDAY', w / 2, 160, 14, '#333');
  },
  // Cricket match.
  (c, w, h) => {
    c.fillStyle = '#2d6a4f';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#f1faee';
    c.beginPath();
    c.arc(w / 2, 80, 30, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#d00000';
    c.lineWidth = 3;
    c.beginPath();
    c.arc(w / 2 - 12, 80, 26, -0.9, 0.9);
    c.stroke();
    text(c, 'CRICKET', w / 2, 140, 26, '#fff');
    text(c, 'TOURNAMENT', w / 2, 168, 15, '#ffd60a');
  },
  // Old, sun-faded poster (mostly blank now).
  (c, w, h) => {
    c.fillStyle = '#d8cfc0';
    c.fillRect(0, 0, w, h);
    lines(c, 40, 10, 'rgba(90,80,70,0.35)', w);
  },
  // Painted wall ad for a tailor (hand lettering straight on the plaster).
  (c, w, h) => {
    c.clearRect(0, 0, w, h);
    text(c, 'ಟೈಲರ್', w / 2, 70, 30, '#1d4ed8', KANNADA, 800);
    text(c, 'TAILOR', w / 2, 110, 26, '#b91c1c', LATIN, 900);
    text(c, '→ 2nd CROSS', w / 2, 142, 14, '#1d4ed8');
  },
  // Spoken English classes.
  (c, w, h) => {
    c.fillStyle = '#7c3aed';
    c.fillRect(0, 0, w, h);
    text(c, 'SPOKEN', w / 2, 50, 30, '#fff');
    text(c, 'ENGLISH', w / 2, 86, 30, '#fde047');
    text(c, '30 DAYS', w / 2, 130, 20, '#fff');
    lines(c, 152, 3, 'rgba(255,255,255,0.7)', w);
  },
  // Water tanker service.
  (c, w, h) => {
    c.fillStyle = '#0ea5e9';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#e0f2fe';
    c.fillRect(20, 50, 120, 46);
    c.fillStyle = '#0c4a6e';
    c.fillRect(24, 96, 26, 14);
    c.fillRect(110, 96, 26, 14);
    text(c, 'WATER TANKER', w / 2, 30, 17, '#fff');
    text(c, 'ನೀರು ಸರಬರಾಜು', w / 2, 140, 16, '#fff', KANNADA, 700);
    text(c, '24 HRS', w / 2, 172, 20, '#fff');
  },
];

function paintAtlas(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = CELL_W * COLUMNS;
  canvas.height = CELL_H * ROWS;
  const c = canvas.getContext('2d') as CanvasRenderingContext2D;
  DESIGN_LIST.forEach((paint, i) => {
    c.save();
    c.translate((i % COLUMNS) * CELL_W, Math.floor(i / COLUMNS) * CELL_H);
    c.beginPath();
    c.rect(0, 0, CELL_W, CELL_H);
    c.clip();
    paint(c, CELL_W, CELL_H);
    c.restore();
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export class WallPosters {
  readonly mesh: THREE.InstancedMesh;

  /** posters: [x, y, z, angle, seed] per poster. */
  constructor(posters: Float32Array) {
    const count = posters.length / 5;
    const geometry = new THREE.PlaneGeometry(0.56, 0.7);
    const design = new Float32Array(count * 2); // atlas cell, weathering
    const material = new THREE.MeshLambertMaterial({ map: paintAtlas(), transparent: false, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aDesign;\nvarying vec2 vDesign;\nvarying vec2 vPosterUv;')
        .replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>
          vDesign = aDesign;
          vPosterUv = uv;
          float cell = aDesign.x;
          vec2 at = vec2(mod(cell, ${COLUMNS}.0), floor(cell / ${COLUMNS}.0));
          vMapUv = vec2((at.x + uv.x) / ${COLUMNS}.0, 1.0 - (at.y + 1.0 - uv.y) / ${ROWS}.0);`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec2 vDesign;
          varying vec2 vPosterUv;
          float wpHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float wpNoise(vec2 p) {
            vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(wpHash(i), wpHash(i + vec2(1.0, 0.0)), f.x), mix(wpHash(i + vec2(0.0, 1.0)), wpHash(i + vec2(1.0, 1.0)), f.x), f.y);
          }`,
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          // Weathering: torn, ragged edges (more on older posters), sun-fading and grime.
          float age = vDesign.y;
          vec2 q = vPosterUv;
          float edge = min(min(q.x, 1.0 - q.x), min(q.y, 1.0 - q.y));
          float tear = wpNoise(q * vec2(9.0, 11.0) + age * 31.0) * (0.04 + 0.16 * age);
          if (edge < tear) discard;
          // Peeled-off patches on the oldest.
          if (age > 0.7 && wpNoise(q * 4.0 + age * 17.0) > 1.25 - age * 0.5) discard;
          vec3 faded = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.33))) * 1.08 + 0.06, age * 0.6);
          diffuseColor.rgb = faded * (0.86 + 0.14 * wpNoise(q * 24.0 + age));`,
        );
    };
    material.customProgramCacheKey = () => 'nukkad-wall-posters-1';
    this.mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, count));
    const matrix = new THREE.Matrix4();
    const at = new THREE.Vector3();
    const turn = new THREE.Quaternion();
    const size = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < count; i++) {
      const [x, y, z, angle, seed] = posters.subarray(i * 5, i * 5 + 5);
      const cell = Math.floor(seed * DESIGNS) % DESIGNS;
      const age = (seed * 7.31) % 1;
      // Painted ones (stencil, tailor) sit a bit bigger; a slight tilt on pasted ones.
      const painted = cell === 4 || cell === 13;
      turn.setFromAxisAngle(up, angle);
      if (!painted) turn.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (age - 0.5) * 0.08));
      size.setScalar(painted ? 1.25 : 0.9 + age * 0.25);
      this.mesh.setMatrixAt(i, matrix.compose(at.set(x, y + (painted ? 0.05 : (age - 0.5) * 0.12), z), turn, size));
      design.set([cell, painted ? age * 0.4 : age], i * 2);
    }
    geometry.setAttribute('aDesign', new THREE.InstancedBufferAttribute(design, 2));
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.computeBoundingSphere();
    this.mesh.receiveShadow = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    const material = this.mesh.material as THREE.MeshLambertMaterial;
    material.map?.dispose();
    material.dispose();
    this.mesh.removeFromParent();
  }
}
