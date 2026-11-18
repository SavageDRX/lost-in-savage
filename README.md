# Lost in Savage

A location-guessing game for the maps of **Savage: The Battle for Newerth**. You're dropped somewhere on a real Savage map, rebuilt in your browser from the map's own files. Look around, work out which map you're on, then pin the spot where you're standing on its minimap.

By **Necro**. Version 1.2. Map list and play counts come from [savagedrx.com](https://savagedrx.com/maps).

## Features

- 458 maps, each rebuilt from its heightmap, its three terrain texture layers, its real props, NPCs and grass
- **Very easy** (the original S2 Games maps plus the best-known maps), **Easy**, **Medium**, **Hard** and **Every map**, based on how often each map is played on the Savage DRX servers
- Full marks for a pin within 3.2 tiles of the real spot, with points tapering off gently beyond that
- 3, 5 or 10 rounds, with a game code you can share so friends get the same maps and spots
- **Daily ranked**: 3 Easy + 2 Medium maps, the same for everyone, new each day at 04:00 GMT; progress survives a refresh
- Eight app themes, an optional Savage cursor, and toggles for the compass and grass

## Running it

It's a static site with no build step and no dependencies. Serve the folder with any web server, for example:

```sh
python3 -m http.server 8000
```

then open <http://localhost:8000>. Opening `index.html` straight from disk won't work, because browsers block `fetch` on `file://` pages.

To publish with **GitHub Pages**, push the repository and enable Pages on the default branch (root folder). The `.nojekyll` file stops GitHub from processing the site.

You need a browser with WebGL 2 (any current Chrome, Edge, Firefox or Safari).

## Daily ranked and the leaderboard

Ranked works anywhere. The **global leaderboard** needs somewhere to store scores. It's built to use a free [Supabase](https://supabase.com) project:

1. Create a Supabase account and a new project (the free plan is plenty).
2. In the project, open **SQL Editor**, paste in the contents of `tools/leaderboard.sql` and click **Run**.
3. Open **Project Settings → API** and copy the **Project URL** and the **publishable** key (an older **anon public** key also works).
4. Paste them into `js/config.js`, then commit and push.

The anon key is designed to be public. The rules in `leaderboard.sql` only let visitors read scores and add one score per player for the current day. Nobody can edit or delete scores through the site, but you can remove bad entries yourself in Supabase's table editor.

Without a config the leaderboard button and name entry hide themselves and ranked is played without it. (When the game runs as a Claude artifact it uses the artifact's own shared database instead.)

Scores are worked out in the player's browser, so treat the leaderboard as friendly rather than cheat-proof. Names are filtered for slurs and abuse before they're posted and again before they're shown, and the database only accepts 2–16 letters, numbers, spaces, `_`, `-` and `.`.

## Project layout

```
index.html        page markup
css/style.css     styles and themes
js/config.js      settings for a public copy (leaderboard keys)
js/app.js         game logic, menus, settings, ranked mode, leaderboard
js/renderer.js    WebGL renderer: terrain, props, grass, sky, spawn-point picking
assets/           icons, start-screen image, minimap thumbnail sheet
data/             one JSON file per map (Hard maps are bundled ten to a file in data/h/), plus index.json
mpack/            prop models (g*.json) and their textures (t*.json), loaded per map on demand
tex/              terrain textures
foliage/          grass textures
tools/            Python scripts used to build data/ and mpack/ from the game files
```

## Rebuilding the data (optional)

The built data is already in the repository. The scripts in `tools/` are what produced it, if you want to add maps or models. They need Python 3 with `numpy` and `Pillow`, plus files extracted from your own Savage install:

```sh
export SAVAGE_EXTRACT=/path/to/extracted/game/files   # models/, terrain/, foliage/, mines/ ...
export SAVAGE_MAPS=/path/to/maps                       # <map>.s2z and <map>_overhead.jpg
python3 tools/make_objdefs.py   # index object definitions and the objects the maps use
python3 tools/models.py         # convert .model/.s2g to web geometry and textures (build/)
python3 tools/reapply.py        # place real props on every map (2nd base becomes the beast lair)
python3 tools/layer3.py --apply # add the third terrain layer used by newer maps
python3 tools/fw_apply.py --apply  # keep spawn points inside each map's playable area
python3 tools/mkpack.py         # pack models and textures into mpack/
```

`tools/extract.py` turns map archives into the per-map JSON in the first place (`python3 -I tools/extract.py <maps_dir> <maplist.txt> <out_dir>`).

## Security notes

- No server code, no cookies, no tracking. Settings, best scores and ranked progress live in the browser's `localStorage`.
- A Content Security Policy in `index.html` only allows the site's own scripts and data, Google Fonts, and Supabase for the leaderboard.
- Anything taken from data or player input is escaped before it reaches the page.
- Test hooks (`?debug`) only switch on when the site is served from `localhost`.

## Credits and licence

Savage: The Battle for Newerth was made by S2 Games. The models, textures, maps and minimaps used here come from the game and the Savage community map makers, and remain the work of their authors. They're included so the game can show the maps as they look in Savage. The game's own code (everything in `index.html`, `css/`, `js/` and `tools/`) is released under the MIT licence; see `LICENSE`.
