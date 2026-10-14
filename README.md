# Rift Race

A League of Legends–themed spin-off of the duck race, used to decide fantasy basketball draft order.
Up to 12 players pick a champion, then race from the **blue fountain** down mid lane to the **red fountain**
while dodging skill shots fired from the red nexus. Finish order = draft order.

## Run locally
```bash
npm install
npm start          # http://localhost:3000
```

## Hosting (Render, free)
1. Merge this branch into `main`.
2. On [render.com](https://render.com): **New → Blueprint**, pick this repo. `render.yaml` sets up a free Node web service.
3. Share the `https://rift-race-xxxx.onrender.com` URL.

The free plan sleeps after 15 minutes idle; the first visit takes ~30–60s to wake it. Open it a minute before the draft.

## How to play
- One person taps **Create room** and shares the link (`/?room=CODE`); everyone else joins.
- Pick a champion (unique per room). The host taps **Start race**.
- Hold your phone sideways. Drag anywhere on the **left half** of the screen to use the joystick (WASD/arrows on desktop).
- The camera is locked to your champion.

| Skill shot | Effect |
|---|---|
| Ashe R (Enchanted Crystal Arrow) | Stun for 2s |
| Tristana R (Buster Shot) | Knockback toward your base |
| Karma Q (Inner Flame) | 55% slow for 2s |

The server is authoritative: it moves players, handles champion collisions (champions block each other), spawns skill shots, detects hits and detects who crosses the finish line.
The lane runs diagonally from the blue base (bottom-left) to the red base (top-right); a clean run takes about 30 seconds.
The race ends when everyone finishes (or after 3 minutes; unfinished players are ranked by distance).
Results are revealed last → first, with 1st/2nd/3rd in gold/silver/bronze.

If a phone locks mid-race, rejoin with the same name and room code to take your slot back.

Tuning lives at the top of `public/engine.js` (`CFG`, `SKILLS`, spawn rate in `spawnShots`).
Champion art comes from Riot's Data Dragon CDN.
