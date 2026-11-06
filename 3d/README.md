# LavaDodge: Overheat 3D

The 3D version of the LavaDodge iPhone remake. It has the same rules, balance and controls as the 2D remake in `../ios/`, rendered in 3D with three.js.

**Play:** https://thewilliamyao.github.io/lavadodge-overheat/3d/
In Safari, tap Share, then Add to Home Screen. It works offline after the first load. Requires iOS 16.4 or later.

## What's 3D
- **Olaf:** a real 3D model, generated with Meshy in two steps: a 3D-render image made from the original sprite, then that image converted to a 3D model. He hops along an arc with squash and stretch, leans into each hop, turns toward left and right hops, and breathes while idle. He glows red when overheating and turns charred when burnt.
- **Board:** 6×6 stone blocks on a floating grass-and-dirt island. Cracking tiles shake, sink slightly and glow from below, with crack lines growing across them and the original fiery crack border. When a tile erupts it drops away, glowing lava wells up and lights the area around it, and embers fly.
- **Other:** spinning ice cubes, dust puffs when Olaf lands, steam when he's hot, and smoke when he's burnt. The title screen camera slowly orbits Olaf.

## Files
- `game3d.js`: game logic, 3D scene and HUD (balance numbers are in `BAL` at the top).
- `lib/`: three.js r170 and the GLTF loader, stored locally so the game works offline.
- `assets/olaf.glb`: the 3D Olaf model.
