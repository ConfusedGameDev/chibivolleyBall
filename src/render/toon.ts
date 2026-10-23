import * as THREE from 'three';

const grad = new THREE.DataTexture(new Uint8Array([110, 190, 255]), 3, 1, THREE.RedFormat);
grad.minFilter = grad.magFilter = THREE.NearestFilter;
grad.needsUpdate = true;
export const gradientMap = grad;

export const toon = (color: THREE.ColorRepresentation, map?: THREE.Texture | null) =>
  new THREE.MeshToonMaterial({ color, gradientMap: grad, map: map ?? null });

const outlineMat = new THREE.MeshBasicMaterial({ color: 0x2b2638, side: THREE.BackSide });

/** Inverted-hull outline: a slightly bigger back-face copy. Works for meshes centred on their origin. */
export function outline<T extends THREE.Mesh>(mesh: T, s = 1.07): T {
  const o = new THREE.Mesh(mesh.geometry, outlineMat);
  o.scale.setScalar(s);
  o.raycast = () => {};
  mesh.add(o);
  return mesh;
}

export const TEAM = { 1: 0x5cc492, [-1]: 0xf07fb0 } as Record<number, number>;
export const TEAM_CSS = { 1: '#4fb985', [-1]: '#e8679f' } as Record<number, string>;
