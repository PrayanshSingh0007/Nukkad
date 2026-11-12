import * as THREE from 'three';

/**
 * Photo-scanned surface textures (CC0, Poly Haven — see CREDITS.md): asphalt, painted
 * plaster, concrete roofs and dry soil. They are laid on in world space by the shaders, so
 * our meshes need no texture coordinates. The colours of buildings and roads still come
 * from the map; the photos only add real-world detail (cracks, stains, grain).
 * Loaded only on Medium and High. Until they arrive the shaders use their plain look.
 */
export interface SurfaceUniforms {
  uTexOn: { value: number };
  uAsphalt: { value: THREE.Texture };
  uAsphaltNormal: { value: THREE.Texture };
  uPlaster: { value: THREE.Texture };
  uRoof: { value: THREE.Texture };
  uSoil: { value: THREE.Texture };
  /** Average colour of each photo, so detail is added without changing the overall colour. */
  uAsphaltAvg: { value: THREE.Vector3 };
  uPlasterAvg: { value: THREE.Vector3 };
  uRoofAvg: { value: THREE.Vector3 };
  uSoilAvg: { value: THREE.Vector3 };
}

const WHITE = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
WHITE.needsUpdate = true;
const FLAT_NORMAL = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
FLAT_NORMAL.needsUpdate = true;

export function createSurfaceUniforms(): SurfaceUniforms {
  return {
    uTexOn: { value: 0 },
    uAsphalt: { value: WHITE },
    uAsphaltNormal: { value: FLAT_NORMAL },
    uPlaster: { value: WHITE },
    uRoof: { value: WHITE },
    uSoil: { value: WHITE },
    uAsphaltAvg: { value: new THREE.Vector3(1, 1, 1) },
    uPlasterAvg: { value: new THREE.Vector3(1, 1, 1) },
    uRoofAvg: { value: new THREE.Vector3(1, 1, 1) },
    uSoilAvg: { value: new THREE.Vector3(1, 1, 1) },
  };
}

/** The average colour of an image in linear light (what the shader sees). */
function averageLinear(image: CanvasImageSource): THREE.Vector3 {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const c = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  c.drawImage(image, 0, 0, 16, 16);
  const data = c.getImageData(0, 0, 16, 16).data;
  const sum = new THREE.Vector3();
  const color = new THREE.Color();
  for (let i = 0; i < data.length; i += 4) {
    color.setRGB(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255, THREE.SRGBColorSpace);
    sum.x += color.r;
    sum.y += color.g;
    sum.z += color.b;
  }
  return sum.multiplyScalar(1 / 256).max(new THREE.Vector3(0.02, 0.02, 0.02));
}

/** Loads the photos and switches them on. Resolves even if a file fails (the plain look stays). */
export async function loadSurfaces(uniforms: SurfaceUniforms, anisotropy: number): Promise<void> {
  const loader = new THREE.TextureLoader();
  const load = async (name: string, colour: boolean): Promise<THREE.Texture> => {
    const texture = await loader.loadAsync(`/textures/${name}.jpg`);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = anisotropy;
    if (colour) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  };
  try {
    const [asphalt, asphaltNormal, plaster, roof, soil] = await Promise.all([
      load('asphalt_diff', true),
      load('asphalt_nor', false),
      load('plaster_diff', true),
      load('roof_diff', true),
      load('soil_diff', true),
    ]);
    uniforms.uAsphalt.value = asphalt;
    uniforms.uAsphaltNormal.value = asphaltNormal;
    uniforms.uPlaster.value = plaster;
    uniforms.uRoof.value = roof;
    uniforms.uSoil.value = soil;
    uniforms.uAsphaltAvg.value = averageLinear(asphalt.image as CanvasImageSource);
    uniforms.uPlasterAvg.value = averageLinear(plaster.image as CanvasImageSource);
    uniforms.uRoofAvg.value = averageLinear(roof.image as CanvasImageSource);
    uniforms.uSoilAvg.value = averageLinear(soil.image as CanvasImageSource);
    uniforms.uTexOn.value = 1;
  } catch {
    console.warn('Nukkad: surface textures could not be loaded — using the plain look');
  }
}

/** Uniform declarations for shaders that use the photos. */
export const SURFACE_GLSL = /* glsl */ `
  uniform float uTexOn;
  uniform sampler2D uAsphalt;
  uniform sampler2D uAsphaltNormal;
  uniform sampler2D uPlaster;
  uniform sampler2D uRoof;
  uniform sampler2D uSoil;
  uniform vec3 uAsphaltAvg;
  uniform vec3 uPlasterAvg;
  uniform vec3 uRoofAvg;
  uniform vec3 uSoilAvg;
`;
