# Rift Race

A League of Legends–themed spin-off of the duck race, used to decide fantasy basketball draft order.
Up to 12 players pick a champion, then race from the **blue fountain** down mid lane to the **red fountain**
while dodging skill shots fired from the red nexus. Finish order = draft order.

## Hosting (GitHub Pages)
This is a static site, so no server is needed. The **room creator's browser runs the game** and the other
phones connect to it peer-to-peer (WebRTC via [PeerJS](https://peerjs.com)'s free public broker).

1. Merge to `main`.
2. Repo **Settings → Pages → Source: GitHub Actions**. The workflow in `.github/workflows/pages.yml` publishes `public/`.
3. Open `https://<user>.github.io/<repo>/`.

The host must keep the game open for the whole race. If the host's phone locks, the room ends.

Local testing: `cd public && python3 -m http.server 8000`.

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

The host's browser is authoritative: it moves players, handles champion collisions (champions block each other), spawns skill shots, detects hits and detects who crosses the finish line.
The lane runs diagonally from the blue base (bottom-left) to the red base (top-right); a clean run takes about 30 seconds.
The race ends when everyone finishes (or after 3 minutes; unfinished players are ranked by distance).
Results are revealed last → first, with 1st/2nd/3rd in gold/silver/bronze.

If a phone locks mid-race, rejoin with the same name and room code to take your slot back.

Tuning lives at the top of `public/engine.js` (`CFG`, `SKILLS`, spawn rate in `spawnShots`).
Champion art comes from Riot's Data Dragon CDN.
