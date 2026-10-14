# Rift Race

A League of Legends–themed spin-off of the duck race, used to decide fantasy basketball draft order.
Up to 12 players pick a champion, then race from the **blue fountain** down mid lane to the **red fountain**
while dodging skill shots fired from the red nexus. Finish order = draft order.

## Run
```bash
npm install
npm start          # http://localhost:3000  (PORT env var to change)
```
Deploy anywhere that runs Node and supports WebSockets (Render, Railway, Fly.io, etc.).

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

The server is authoritative: it moves players, spawns skill shots, detects hits and detects who crosses the finish line.
The race ends when everyone finishes (or after 3 minutes; unfinished players are ranked by distance).
Results are revealed last → first, with 1st/2nd/3rd in gold/silver/bronze.

If a phone locks mid-race, rejoin with the same name and room code to take your slot back.

Tuning lives at the top of `server.js` (`CFG`, `SKILLS`, spawn rate in `spawnShots`).
Champion art comes from Riot's Data Dragon CDN.
