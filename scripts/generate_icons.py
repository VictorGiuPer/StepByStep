from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"


def heart_points(cx: float, cy: float, scale: float):
    return [
        (cx, cy + scale * 0.95),
        (cx - scale * 0.95, cy),
        (cx - scale * 0.75, cy - scale * 0.6),
        (cx - scale * 0.25, cy - scale * 0.65),
        (cx, cy - scale * 0.25),
        (cx + scale * 0.25, cy - scale * 0.65),
        (cx + scale * 0.75, cy - scale * 0.6),
        (cx + scale * 0.95, cy),
    ]


def make_icon(size: int, filename: str, maskable: bool = False):
    canvas = Image.new("RGB", (1024, 1024), "#F1F2F6")
    draw = ImageDraw.Draw(canvas)
    margin = 150 if maskable else 96
    draw.rounded_rectangle((margin, margin, 1024 - margin, 1024 - margin), radius=210, fill="#27187E")
    stones = [(290, 690, 500, 765), (430, 545, 680, 620), (580, 400, 795, 475)]
    for left, top, right, bottom in stones:
        draw.rounded_rectangle((left, top, right, bottom), radius=38, fill="#AEB8FE")
    draw.polygon(heart_points(494, 360, 135), fill="#FF8600")
    canvas.resize((size, size), Image.Resampling.LANCZOS).save(PUBLIC / filename, optimize=True)


PUBLIC.mkdir(parents=True, exist_ok=True)
make_icon(64, "favicon-64.png")
make_icon(192, "pwa-192.png")
make_icon(512, "pwa-512.png")
make_icon(512, "pwa-maskable-512.png", maskable=True)
