# আকাশ · Akash — Bangladesh Star Chart & Constellation Chart

**Live Demo:** https://al1n3waj.github.io/Taradekho/

An accurate, 100% static, offline-capable web application that draws sky charts and constellation charts for any date, time, and location in **Bangladesh**, with **Bangla (বাংলা)** and **English** labels, a **Bortle-scale light-pollution filter**, and client-side **PNG / JPG / ZIP** export.

---

## Features

- **Bilingual (বাংলা + English)**: Toggle chart labels between Bangla only, English only, or Both (Bangla primary + English secondary), plus full UI translation (`en` / `bn`), optional Bangla numerals (`০১২৩...`), and Bangabda (বাংলা পঞ্জিকা) dates.
- **Bortle-Scale Visibility Filter (1–9 + Custom NELM)**:
  - Models atmospheric extinction with airmass ($X = 1 / \sin(\text{alt})$ for $\text{alt} > 3^\circ$), haze/humidity coefficient ($k$), and optional Moon glow penalty.
  - Classifies constellations as **Full**, **Partial** (`আংশিক`), or **Hidden** based on visible figure stars.
  - Fades Milky Way opacity linearly from Bortle 1 to 0 at Bortle 5+, and adds realistic horizon light-pollution glow.
  - Lazy-loads `data/stars_faint.json` ($6.5 < \text{mag} \le 8.0$) only when NELM > 6.5.
- **Bangladesh Location Presets + GPS**: 14 presets across Bangladesh (Dhaka, Chattogram, Sylhet, Rajshahi, Khulna, Barishal, Rangpur, Mymensingh, Cox's Bazar, Teknaf, St Martin's Island, Bandarban, Sreemangal, Sundarbans) with estimated Bortle classes, plus GPS and custom lat/lon.
- **Three Chart Modes**:
  - **All-sky circular** (Azimuthal Equidistant or Stereographic, East on the left)
  - **Directional rectangular** (N/E/S/W, Gnomonic, FOV 30°–120°)
  - **Constellation view**
- **Export (100% Client-Side)**:
  - Single PNG/JPG at 1080, 2048, or 4096 px
  - Month batch ZIP (every night, every 7 days, or 1st & 15th)
  - Year batch ZIP (12 months + optional 4×3 poster)
  - Web Share API / Clipboard copy
- **Community Bangla Names Editor**: Built-in modal to edit/verify Bangla names locally and export a PR-ready `names_bn.json`.
- **Offline PWA**: Service worker caches the app shell, fonts, and star catalogs for offline stargazing.

---

## Deploying to GitHub Pages (Step-by-Step)

1. **Create a new repository** on GitHub (e.g., `akash`).
2. **Push this project** to `main`:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<repo-name>.git
   git push -u origin main
   ```
3. **Enable GitHub Pages**:
   - Open your repository on GitHub → **Settings → Pages**.
   - Under **Build and deployment → Source**, select **GitHub Actions**.
4. **Wait for the workflow**:
   - The `.github/workflows/deploy.yml` workflow will run `npm test`, validate `data/names_bn.json`, inject the commit SHA into `sw.js`, and publish to GitHub Pages.
   - Once green, open `https://<your-username>.github.io/<repo-name>/`.

### Optional: Custom Domain & `manifest.webmanifest`
- **Custom Domain**: Add a `CNAME` file at the repository root containing your domain (e.g. `akash.example.com`) and configure DNS as per GitHub Pages documentation.
- **Repository Name**: All asset paths use relative URLs (`./`), and `manifest.webmanifest` uses `"start_url": "./"` and `"scope": "./"`, so it works automatically at any sub-path or custom domain root. If you want a custom app title or icon path, edit `manifest.webmanifest`.

---

## Local Development & Testing

> **Important**: Service workers, ES modules, `fetch()`, Geolocation API, and Web Share API **will NOT work** over `file://`. Always use a local HTTP server:

```bash
# Serve from the repo root:
python -m http.server 8000
# Open http://localhost:8000/

# Or test sub-path hosting (simulating https://user.github.io/akash/):
# Serve the parent folder and open http://localhost:8000/akash/
```

### Running Unit Tests & Validators
```bash
npm test
# On Windows PowerShell if npm.ps1 is restricted:
npm.cmd test
```

### Rebuilding Star Data
`scripts/build_data.js` documents how compact `stars_bright.json` and `stars_faint.json` are generated from the HYG / d3-celestial catalogs. Pre-built files are committed in `/data/` so the site deploys without running any build step.

### Bumping Cache Version
In production, `.github/workflows/deploy.yml` automatically replaces `__CACHE_VERSION__` in `sw.js` with the short commit SHA on every push to `main`.

---

## How the Bortle & Limiting-Magnitude Model Works

For each star at altitude $\text{alt} > 3^\circ$:
$$\text{effective\_limit} = \text{NELM} - k \cdot (\text{airmass} - 1) - \text{moonPenalty}$$
where:
- $\text{NELM}$ is mapped from Bortle class (1: 7.8, 2: 7.3, 3: 6.8, 4: 6.3, 5: 5.8, 6: 5.3, 7: 4.8, 8: 4.3, 9: 3.8) or set via the custom slider.
- $\text{airmass} = 1 / \sin(\text{alt})$ (plane-parallel approximation).
- $k$ is the atmospheric extinction coefficient (default `0.3`, adjustable `0.15`–`0.50` for Bangladesh humidity/haze).
- $\text{moonPenalty}$ (optional) reduces the limit by up to `1.0` mag when the Moon is above the horizon, weighted by illuminated fraction and angular separation ($< 30^\circ$).

### Known Limitations
- **No atmospheric refraction** below $3^\circ$ altitude (stars below $3^\circ$ are hidden).
- **Estimated Bortle classes**: City/region Bortle values in `data/locations.json` are estimates; verify your exact site at [lightpollutionmap.info](https://www.lightpollutionmap.info/).
- **Moon / Planet positions**: Planets use vendored `astronomy-engine` when loaded; Moon position in `render.js` uses a simplified opposition approximation when offline/unit-tested.
- **Bangabda calendar**: Uses the standard astronomical/solar approximation (Boishakh 1 ≈ April 14).

---

## Contributing Bangla Names

See [CONTRIBUTING.md](CONTRIBUTING.md) (in English and বাংলা) for how to suggest or edit Bangla star/constellation names via the built-in **Names Editor**, a **GitHub Issue**, or a **Pull Request**.

---

## Data Sources & Licenses

- **Code**: MIT License ([LICENSE](LICENSE))
- **Data & Libraries**: See [DATA_LICENSES.md](DATA_LICENSES.md) (HYG CC BY-SA 4.0, d3-celestial BSD-3, astronomy-engine MIT, JSZip MIT, FileSaver MIT, Noto Sans Bengali & Inter OFL 1.1).

---

## Roadmap

- [ ] Device compass / gyroscope live sky-pointing mode
- [ ] Annual meteor-shower calendar (Perseids, Geminids, Quadrantids) for Bangladesh
- [ ] Lunar & solar eclipse visibility alerts for Bangladesh
- [ ] ISS & bright satellite pass predictions
