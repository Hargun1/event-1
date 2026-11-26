# WILDSCAPE — A Living Ecosystem

### Team Name
- Oregano

### Track Number & Name
- TODO: add the track number and name (e.g. "Track X – Name")

### Problem Statement Name
- Ecosystem Simulation Game

### Idea
- WILDSCAPE is a 3D browser game set in three living worlds: **Dino Valley**, **Ocean Reef** and the **Savanna** (today's animals).
- Every zone runs its own ecosystem on its own. Plants grow back after being eaten. Herbivores graze, form herds and flee. Predators stalk and hunt, every animal needs food to survive, and populations rise, crash or go extinct.
- You can **play** as the top predator (T. rex, shark or lion): move, sprint, hunt and fight. Armoured prey hit back, and rival predators challenge you. If you don't eat, you starve.
- Or you can **watch** the ecosystem, change its settings (starting populations, plant growth, breeding speed) and see why it thrives or collapses. Live charts and an event feed explain what is happening.

### How to Run

**Prerequisites**
- [Node.js](https://nodejs.org/) 20 or newer (includes npm)
- A modern desktop or mobile browser with WebGL (Chrome, Edge, Firefox, Safari)

**Installation**
```bash
git clone https://github.com/Hargun1/event-1.git
cd event-1
npm install
```

**Run locally**
```bash
npm run dev
```
Then open the `http://localhost:5173/` address printed in the terminal. If that port is busy, Vite picks the next free one and prints it.

**Other commands**
```bash
npm run build      # type-check and create a production build in dist/
npm run preview    # serve the production build locally
npm run sim:test   # headless simulation tests for all three zones
```

**Controls:** WASD / arrow keys to move · Shift to sprint · Space or left-click to attack · Q/E or right-drag to turn the camera · mouse wheel to zoom · P to pause · Tab for the ecosystem panel. Touch devices get an on-screen joystick and buttons.

### Credits
3D models by [vinish.dev](https://vinish.dev/free-3d-models/), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/): Tyrannosaurus Rex, Velociraptor, Triceratops, Parasaurolophus, Stegosaurus, Brachiosaurus, Cycad, Shark, Dolphin, Reef Fish, Sea Turtle, Manta Ray, Coral Reef, Jellyfish, Lion, Cheetah, Zebra and Thomson's Gazelle.
