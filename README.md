# Emberline Depot — a three.js tactical FPS

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/Maswanda/threejs-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/Maswanda/threejs-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

A round-based tactical FPS in three.js 0.187.0: Vanguard attacks, Sentinel defends. Plant the charge at Site A (warehouse) or Site B (container yard) — or clear the site. 5v5 against bots, money and a buy menu between rounds, three weapons plus a frag grenade, and gunplay where stopping to aim pays.

## Run it

```sh
node serve.ts
# open http://localhost:8080
```

## How it plays

- **Rounds** — first to 5, max 9. A round ends when a team is eliminated, the charge detonates, it is defused, or time runs out.
- **The charge** — hold `E` at A or B to plant (3 s). Once planted it blows in 35 s unless a defender defuses it (5 s channel).
- **Money** — kills pay $300, a round win $3250, a loss $1900, a plant $300. Spend it in the buy menu (`B` during the buy phase): VK-47 Rifle $2700, Hornet SMG $1500, Frag Grenade $300. Weapons stay with you while you survive.
- **Gunplay** — hitscan with headshot damage, recoil and spread that grow with movement and sustained fire, crouching and jumping, AABB collision with the map.
- **Bots** — 4 teammates and 5 defenders with a waypoint graph, line of sight, reaction times, burst fire, strafing, site holds, and a defuse run when the charge is planted.

## Layout

- `game/` — the playable game, static ES modules, no build step, no network requests. `game/index.html` opens in desktop Chrome.
- `game/src/` — one module per job: `map.js` (Emberline Depot + waypoint graph), `player.js` (movement + health), `weapons.js` (arsenal), `bots.js` (AI), `bomb.js` (plant/defuse), `effects.js` (tracers + particles), `hud.js` (DOM HUD + buy menu), `audio.js` (synthesised SFX), `input.js`, `palette.js`, `rng.js`, `main.js` (fixed-step loop + rounds).
- `screenshots/` — 4 real renders of the game (cover first).
- `main.ts` — the entry program: copies `game/` + `screenshots/` to `/output` and writes `dossier.json`.
- `vendor/makefun-threejs.ts` — the kit's dossier library, unchanged.

---

<sub>Entered on [make.fun](https://make.fun/?ref=y6c0jsf3&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
