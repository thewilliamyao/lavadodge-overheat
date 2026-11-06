# LavaDodge: Overheat 3D

The 3D version of the LavaDodge iPhone remake. It has the same rules, balance and controls as the 2D remake in `../ios/`, rendered in 3D with three.js.

**Play:** https://thewilliamyao.github.io/lavadodge-overheat/3d/
In Safari, tap Share, then Add to Home Screen. It works offline after the first load. Requires iOS 16.4 or later.

## 2 players
Tap **2 PLAYERS** on the title screen:
- **Same phone:** lay the phone flat between you. Player 2's arrows and heat bar face them from the far side. Swipes work too: Olaf moves the way your finger moves. Last Olaf standing wins, and wins are tallied across rematches. On a keyboard, P1 uses the arrow keys and P2 uses WASD.
- **Online:** one player taps **HOST ONLINE** and reads out the 4-letter room code; the other taps **JOIN ONLINE** and types it in. The host's phone runs the game and the other phone sends its moves, with a little extra lava grace to make up for network delay. The connection uses WebRTC through the free PeerJS broker, so both phones need internet access, and some strict networks (certain cellular or work Wi-Fi) may fail to connect.

The game rules, menus and multiplayer code are shared by the 2D and 3D versions, in [`../shared/`](../shared/).

## What's 3D
- **Olaf:** a real 3D model, generated with Meshy in two steps: a 3D-render image made from the original sprite, then that image converted to a 3D model. He hops along an arc with squash and stretch, leans into each hop, turns toward left and right hops, and breathes while idle. He glows red when overheating and turns charred when burnt.
- **Board:** 6×6 stone blocks on a floating grass-and-dirt island. Cracking tiles shake, sink slightly and glow from below, with crack lines growing across them and the original fiery crack border. When a tile erupts it drops away, glowing lava wells up and lights the area around it, and embers fly.
- **Other:** spinning ice cubes, dust puffs when Olaf lands, steam when he's hot, and smoke when he's burnt. The title screen camera slowly orbits Olaf.

## Files
- `game3d.js`: game logic, 3D scene and HUD (balance numbers are in `BAL` at the top).
- `lib/`: three.js r170 and the GLTF loader, stored locally so the game works offline.
- `assets/olaf.glb`: the 3D Olaf model.
