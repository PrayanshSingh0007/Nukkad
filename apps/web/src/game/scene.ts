import * as THREE from 'three';

const SKY = 0xbcd9f5;

export interface GameScene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Call when the window changes size (also on phone rotation). */
  resize(): void;
}

/** Renderer, sky colour, fog and the two lights. (The real sky and day-night arrive in Phase 5.) */
export function createGameScene(canvas: HTMLCanvasElement, options: { antialias: boolean }): GameScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: options.antialias, powerPreference: 'high-performance' });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 180, 900);
  scene.add(new THREE.HemisphereLight(0xe4f0ff, 0x8f8672, 2.2));
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
  sun.position.set(-0.55, 1, 0.35);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 1800);
  const resize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  resize();
  return { renderer, scene, camera, resize };
}
