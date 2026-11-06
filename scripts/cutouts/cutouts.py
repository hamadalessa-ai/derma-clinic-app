"""
Doctor portraits for the clinic website: takes each doctor's published photo card, removes
the background (and the card's logo/text), and saves a clean, transparent 4:5 portrait so every
doctor sits on the same calm background on the website.
Runs on GitHub (workflow "Doctor portraits", .github/workflows/doctor-portraits.yml); output: public/site/derma/doctors/<slug>.webp
"""
import io
import json
import sys
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image
from rembg import new_session, remove
from scipy import ndimage

OUT = Path("public/site/derma/doctors")
OUT.mkdir(parents=True, exist_ok=True)
W, H = 900, 1125  # 4:5
session = new_session("isnet-general-use")

for d in json.loads(Path("scripts/cutouts/doctors.json").read_text()):
    req = urllib.request.Request(d["url"], headers={"User-Agent": "Mozilla/5.0"})
    card = Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=60).read())).convert("RGB")
    w, h = card.size
    # The person stands on the right of the card; the logo and name text are on the left.
    x0 = int(w * (0.5 if d["founder"] else 0.36))
    part = card.crop((x0, 0, w, h))
    cut = remove(part, session=session)
    a = np.array(cut)
    alpha = a[:, :, 3] > 40
    # Keep only the person (largest region): drops leftover letters or logo pieces.
    labels, n = ndimage.label(alpha)
    if n == 0:
        print("no person found:", d["slug"], file=sys.stderr)
        continue
    sizes = ndimage.sum(alpha, labels, range(1, n + 1))
    keep = labels == (int(np.argmax(sizes)) + 1)
    keep = ndimage.binary_fill_holes(keep)
    a[:, :, 3] = np.where(keep, a[:, :, 3], 0)
    person = Image.fromarray(a)
    ys, xs = np.where(a[:, :, 3] > 0)
    person = person.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    pw, ph = person.size
    # Head near the top, shoulders to the bottom edge, centred.
    scale = min(W * 0.96 / pw, H * 0.94 / ph)
    person = person.resize((max(1, int(pw * scale)), max(1, int(ph * scale))), Image.LANCZOS)
    canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    canvas.paste(person, ((W - person.width) // 2, H - person.height), person)
    canvas.save(OUT / f"{d['slug']}.webp", "WEBP", quality=88, method=6)
    print("ok", d["slug"])
