# LavaDodge: Overheat (iPhone remake)

A remake of the 2017 LavaDodge-Overheat game. It's a home-screen web app for iPhone that works offline and runs full screen with no browser bar.

## Put it on your iPhone
1. Host this folder on any HTTPS static host (see below).
2. Open the URL in **Safari** on the iPhone.
3. Tap **Share**, then **Add to Home Screen**. It launches full screen with its own icon and works offline after the first load.

## Hosting options
- **GitHub Pages:** copy this folder into your repo (for example `ios/`), push to the Pages branch, and open `https://<user>.github.io/lavadodge-overheat/ios/`.
- **Netlify Drop:** drag this folder onto https://app.netlify.com/drop.
- **Locally:** run `python3 -m http.server` here. Use HTTPS when you deploy, because offline mode only works over HTTPS.

## How to play
- Swipe anywhere, or tap the arrow pad, to hop Olaf one tile.
- Cracked tiles turn to lava after a short warning. Don't be on them when they erupt.
- Your **heat meter** always rises, a little faster at each heat level. Grab **ice cubes** to cool down. Grabbing several in a row gives up to 3x points.
- A lava tile erupting right next to you gives a +5 **close call** bonus.
- **Heat level** goes up every 12 s. Waves come faster and get new patterns: lines, plus shapes, blocks, rings around you, sweeps and checkerboards.
- **Daily Run** gives everyone the same seeded waves each day, with its own best score.
- Every wave is checked before it spawns to make sure a human-speed escape path exists, so no death is unavoidable.

The balance numbers are in the `BAL` object at the top of `game.js`.

## 2 players
Tap **2 PLAYERS** on the title screen:
- **Same phone:** lay the phone flat between you. Player 2's arrows and heat bar face them from the far side. Swipes work too: Olaf moves the way your finger moves. Last Olaf standing wins, and wins are tallied across rematches. On a keyboard, P1 uses the arrow keys and P2 uses WASD.
- **Online:** one player taps **HOST ONLINE** and reads out the 4-letter room code; the other taps **JOIN ONLINE** and types it in. The host's phone runs the game and the other phone sends its moves, with a little extra lava grace to make up for network delay. The connection uses WebRTC through the free PeerJS broker, so both phones need internet access, and some strict networks (certain cellular or work Wi-Fi) may fail to connect.

The game rules, menus and multiplayer code are shared by the 2D and 3D versions, in [`../shared/`](../shared/).

## Assets
- **Olaf, tiles, lava, background:** redrawn at Retina resolution with Meshy, using the original sprites as references.
- **New art (burnt Olaf, overheating Olaf, ice cube, app icon):** made with Meshy from the original Olaf.
- **Arrow buttons and all sounds:** original files.
