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
for old in OUT.glob("*.webp"):
    old.unlink()
W, H = 900, 1125  # 4:5
session = new_session("isnet-general-use")

for d in json.loads(Path("scripts/cutouts/doctors.json").read_text()):
    req = urllib.request.Request(d["url"], headers={"User-Agent": "Mozilla/5.0"})
    card = Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=60).read())).convert("RGB")
    w, h = card.size
    # The person stands on the right of the card; the logo and name text are on the left.
    x0 = int(w * (0.5 if d["founder"] else 0.38))
    part = card.crop((x0, 0, w, h))
    cut = remove(part, session=session)
    a = np.array(cut)
    alpha = a[:, :, 3] > 40
    # Thin strokes (the card's name text touching the coat) are cut away first, then only the
    # person (largest region) is kept and its edge restored.
    disk = lambda r: np.hypot(*np.mgrid[-r : r + 1, -r : r + 1]) <= r
    body = ndimage.binary_opening(alpha, structure=disk(9))
    labels, n = ndimage.label(body)
    if n == 0:
        print("no person found:", d["slug"], file=sys.stderr)
        continue
    sizes = ndimage.sum(body, labels, range(1, n + 1))
    largest = labels == (int(np.argmax(sizes)) + 1)
    ys0 = np.where(largest.any(axis=1))[0]
    if ys0.max() - ys0.min() < alpha.shape[0] * 0.5:
        # The card has no photo (text only): no portrait; the website shows initials instead.
        print("no photo on card:", d["slug"], file=sys.stderr)
        continue
    keep = alpha & ndimage.binary_dilation(largest, structure=disk(10))
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
    # Soften the frame edges: semi-transparent leftovers of the card on the left go, and the
    # left edge (where the card's text met the coat) and the bottom fade out gently.
    c = np.array(canvas).astype(np.float32)
    al = c[:, :, 3]
    left = np.zeros_like(al, dtype=bool)
    left[:, : int(W * 0.4)] = True
    al[left & (al < 200)] = 0
    xs_ = np.arange(W, dtype=np.float32)
    ys_ = np.arange(H, dtype=np.float32)
    fade_x = np.clip((xs_ - W * 0.02) / (W * 0.16), 0, 1)
    fade_y = np.clip((H - ys_) / (H * 0.08), 0, 1)
    al *= fade_x[None, :] * fade_y[:, None]
    c[:, :, 3] = al
    canvas = Image.fromarray(c.clip(0, 255).astype(np.uint8))
    canvas.save(OUT / f"{d['slug']}.webp", "WEBP", quality=88, method=6)
    print("ok", d["slug"])
