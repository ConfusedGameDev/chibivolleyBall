# Models

Drop GLB files here and list them in `manifest.json` (paths relative to this folder):

```json
{
  "characters": ["characters/character-a.glb", "characters/character-b.glb"],
  "pets": ["pets/animal-cat.glb"]
}
```

- **characters**: Kenney *Mini Characters*. Each avatar gets one; height is normalised to ~1.1 units. Animation clips are matched loosely by name (`idle`, `run`/`sprint`/`walk`, `jump`, `attack`/`punch`/`interact`...). Check `__cv.clips` in the browser console to see what each model exposed.
- **pets**: Kenney *Cube Pets*. One is picked per match as the ball; it is scaled to the ball size and spun by the physics. An `idle` clip plays if present.

If the pack only has FBX, convert to GLB first (e.g. Blender: File → Import FBX → Export glTF Binary, or `blender -b -P` with a small script). Keep the shared `colormap.png` texture embedded.

Empty lists (the default) = primitive stand-ins.
