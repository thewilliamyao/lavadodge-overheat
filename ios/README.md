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
- Your **heat meter** always rises, and rises faster next to lava. Grab **ice cubes** to cool down. Grabbing several in a row gives up to 3x points.
- A lava tile erupting right next to you gives a +5 **close call** bonus.
- **Heat level** goes up every 12 s. Waves come faster and get new patterns: lines, plus shapes, blocks, rings around you, sweeps and checkerboards.
- **Daily Run** gives everyone the same seeded waves each day, with its own best score.
- Every wave is checked before it spawns to make sure a human-speed escape path exists, so no death is unavoidable.

The balance numbers are in the `BAL` object at the top of `game.js`.

## Assets
- **Olaf, tiles, lava, background:** redrawn at Retina resolution with Meshy, using the original sprites as references.
- **New art (burnt Olaf, overheating Olaf, ice cube, app icon):** made with Meshy from the original Olaf.
- **Arrow buttons and all sounds:** original files.
