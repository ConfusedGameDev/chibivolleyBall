import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';

export interface Assets { characters: GLTF[]; pets: GLTF[] }

/**
 * Loads the GLBs listed in public/models/manifest.json ({ "characters": [...], "pets": [...] }, paths relative to models/).
 * Anything missing or broken is skipped; the game falls back to primitive chibis and a primitive cube pet.
 */
export async function loadAssets(): Promise<Assets> {
  const out: Assets = { characters: [], pets: [] };
  let m: { characters?: string[]; pets?: string[] };
  try { m = await (await fetch('models/manifest.json')).json(); } catch { return out; }
  const loader = new GLTFLoader();
  const load = (u: string) => loader.loadAsync('models/' + u).catch(e => { console.warn('model failed', u, e); return null; });
  const ok = (g: GLTF | null): g is GLTF => !!g;
  out.characters = (await Promise.all((m.characters ?? []).map(load))).filter(ok);
  out.pets = (await Promise.all((m.pets ?? []).map(load))).filter(ok);
  return out;
}
