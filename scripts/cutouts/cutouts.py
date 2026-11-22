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

import cv2
import numpy as np
from PIL import Image
from rembg import new_session, remove
from scipy import ndimage

def clean_text(img: Image.Image) -> Image.Image:
    """
    The cards print the doctor's name and title partly over the coat (lower left). Thin, high-
    contrast strokes there (letters) are painted over from their surroundings; buttons, pens and
    stethoscopes are wider and stay.
    """
    rgb = np.array(img)
    g = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    h, w = g.shape
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (max(5, w // 90), max(5, w // 90)))
    strokes = cv2.morphologyEx(g, cv2.MORPH_TOPHAT, k) + cv2.morphologyEx(g, cv2.MORPH_BLACKHAT, k)
    mask = (strokes > 60).astype(np.uint8)
    zone = np.zeros_like(mask)
    zone[int(h * 0.55) :, : int(w * 0.45)] = 1
    mask = cv2.dilate(mask * zone, np.ones((3, 3), np.uint8), iterations=2)
    return Image.fromarray(cv2.inpaint(rgb, mask * 255, 5, cv2.INPAINT_TELEA))


OUT = Path("public/site/derma/doctors")
OUT.mkdir(parents=True, exist_ok=True)
for old in OUT.glob("*.webp"):
    old.unlink()
W, H = 900, 1125  # 4:5
# BiRefNet's portrait model keeps hair, coats and shoulders whole (the general model left holes).
session = new_session("birefnet-portrait")

for d in json.loads(Path("scripts/cutouts/doctors.json").read_text()):
    req = urllib.request.Request(d["url"], headers={"User-Agent": "Mozilla/5.0"})
    card = Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=60).read())).convert("RGB")
    w, h = card.size
    # The person stands on the right of the card; the logo and name text are on the left.
    x0 = int(w * (0.5 if d["founder"] else 0.38))
    part = card.crop((x0, 0, w, h))
    part = clean_text(part)
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
    # Inside the person, a half-sure pixel (a patterned shemagh, a pale coat) counts as solid;
    # only the faintest edge (fine hair) stays soft.
    solid = np.where(a[:, :, 3] > 60, 255, a[:, :, 3])
    a[:, :, 3] = np.where(keep, solid, 0)
    person = Image.fromarray(a)
    ys, xs = np.where(a[:, :, 3] > 0)
    person = person.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    # One studio-style crop for everyone, as on hospital websites: the face is found and every
    # portrait gets the same head size and eye line (head and shoulders, centred).
    rgb = np.array(person.convert("RGB"))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    det = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    faces = det.detectMultiScale(gray, 1.1, 5, minSize=(gray.shape[1] // 8, gray.shape[1] // 8))
    pw, ph = person.size
    if len(faces):
        fx, fy, fw, fh = max(faces, key=lambda f: f[2] * f[3])
    else:
        print("no face found, estimating:", d["slug"], file=sys.stderr)
        fw = fh = int(pw * 0.32)
        fx, fy = (pw - fw) // 2, int(ph * 0.08)
    FACE_W, FACE_CX, FACE_TOP = W * 0.34, W * 0.5, H * 0.17
    scale = FACE_W / fw
    person = person.resize((max(1, int(pw * scale)), max(1, int(ph * scale))), Image.LANCZOS)
    ox = int(FACE_CX - (fx + fw / 2) * scale)
    oy = int(FACE_TOP - fy * scale)
    canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    canvas.paste(person, (ox, oy), person)
    # Where the published card cut the person off (left side), fade softly instead of a hard
    # edge; the bottom of the frame stays full.
    c = np.array(canvas).astype(np.float32)
    al = c[:, :, 3]
    cut_x = ox + int(2 * scale)
    if cut_x > 0:
        xs_ = np.arange(W, dtype=np.float32)
        fade = np.clip((xs_ - cut_x) / (W * 0.12), 0, 1)
        al *= fade[None, :]
    c[:, :, 3] = al
    canvas = Image.fromarray(c.clip(0, 255).astype(np.uint8))
    canvas.save(OUT / f"{d['slug']}.webp", "WEBP", quality=88, method=6)
    print("ok", d["slug"])

# A contact sheet to review all portraits at a glance (not used by the website).
sheet_files = sorted(OUT.glob("*.webp"))
if sheet_files:
    tw, th, cols = 225, 281, 7
    rows = (len(sheet_files) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * tw, rows * th), (236, 240, 238))
    for i, f in enumerate(sheet_files):
        im = Image.open(f).convert("RGBA").resize((tw, th))
        bg = Image.new("RGBA", (tw, th), (236, 240, 238, 255))
        bg.alpha_composite(im)
        sheet.paste(bg.convert("RGB"), ((i % cols) * tw, (i // cols) * th))
    sheet.save("scripts/cutouts/preview.png")
