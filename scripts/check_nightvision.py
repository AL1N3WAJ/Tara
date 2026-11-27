"""Fails if the page shows non-red pixels in Night Vision mode.
Usage: python scripts/check_nightvision.py [base_url]  (needs: pip install playwright pillow)"""
import asyncio, io, sys
from playwright.async_api import async_playwright
from PIL import Image

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8123/index.html"
MAX_BAD = 0.0002   # allowed fraction of off-red pixels (anti-aliasing)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--no-sandbox"])
        pg = await b.new_page(viewport={"width": 1280, "height": 800})
        await pg.goto(BASE, wait_until="networkidle"); await pg.wait_for_timeout(2000)
        await pg.click("#btn-night"); await pg.wait_for_timeout(1500)
        png = await pg.screenshot(path="/tmp/night.png")
        await b.close()
    im = Image.open(io.BytesIO(png)).convert("RGB")
    px = im.load(); w, h = im.size
    bad = [(x, y) for y in range(h) for x in range(w) if max(px[x, y][1], px[x, y][2]) > max(30, 0.25 * px[x, y][0] + 6)]
    frac = len(bad) / (w * h)
    print(f"off-red pixels: {len(bad)} ({frac:.5%})", bad[:5])
    sys.exit(1 if frac > MAX_BAD else 0)
asyncio.run(main())
