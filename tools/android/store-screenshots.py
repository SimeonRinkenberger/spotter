"""Compose store artwork from real captures; never redraw the captured UI.

User approved this deterministic method on 2026-09-14 after reviewing AI drafts.
Run using the bundled Python runtime (Pillow required).
"""
from pathlib import Path
import hashlib
import json
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
STORE = ROOT / "releases/android/store"
OUT = STORE / "screenshots-v2/final"
OUT.mkdir(parents=True, exist_ok=True)
FONT = Path("/System/Library/Fonts/Supplemental")
BG = "#F8F4EF"
INK = "#111519"
ORANGE = "#FF793F"
SPECS = [
    ("01-share-from-tiktok", "screenshots-v2/raw/01-tiktok-share.png",
     ["Found it.", "Save it. Train it."], "Share from TikTok to Spotter."),
    ("02-workout-library", "screenshots-v2/raw/02-workout-library.png",
     ["Your workouts.", "All together."], "Save the videos. Find your favorites."),
    ("03-workout-details", "screenshots/02-details.png",
     ["A workout", "you can follow."], "Review exercises, sets, and reps."),
    ("04-log-every-set", "screenshots/01-workout.png",
     ["Log every set."], "Reps, weight, and rest. In one place."),
    ("05-plan-your-week", "screenshots-v2/raw/05-weekly-plan.png",
     ["Make time", "for training."], "Give your saved workouts a day."),
]

def font(size, heavy=False):
    return ImageFont.truetype(str(FONT / ("Arial Black.ttf" if heavy else "Arial.ttf")), size)

manifest = []
for slug, source, lines, caption in SPECS:
    src = STORE / source
    original = Image.open(src).convert("RGB")
    canvas = Image.new("RGB", (1080, 1920), BG)
    draw = ImageDraw.Draw(canvas)
    title_font = font(88, True)
    while max(draw.textlength(line, font=title_font) for line in lines) > 970:
        title_font = font(title_font.size - 1, True)
    title_y = 26 if len(lines) == 2 else 73
    for i, line in enumerate(lines):
        draw.text((540, title_y + i * 99), line, fill=INK, font=title_font, anchor="mt")
    caption_font = font(37)
    while draw.textlength(caption, font=caption_font) > 970:
        caption_font = font(caption_font.size - 1)
    draw.text((540, 239), caption, fill="#42464A", font=caption_font, anchor="mt")

    # Preserve the complete screenshot, with only proportional resampling.
    # Never crop/replace text, numbers, buttons, photographs or creator credits.
    height = 1560
    width = round(original.width * height / original.height)
    x, y = (1080 - width) // 2, 320
    image = original.resize((width, height), Image.Resampling.LANCZOS)
    shadow = Image.new("RGBA", canvas.size)
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle((x-10, y+8, x+width+10, y+height+18), radius=54,
                         fill=(92, 55, 30, 45))
    shadow = shadow.filter(ImageFilter.GaussianBlur(17))
    canvas = Image.alpha_composite(canvas.convert("RGBA"), shadow).convert("RGB")
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((x-8,y-8,x+width+8,y+height+8), radius=47, fill=ORANGE)
    # Round only the outer screen corners; all UI/content stays in place.
    mask = Image.new("L", image.size)
    ImageDraw.Draw(mask).rounded_rectangle((0,0,width-1,height-1), radius=38, fill=255)
    canvas.paste(image, (x,y), mask)
    if slug.startswith("01"):
        # Editorial outline around the existing Spotter destination, not a new control.
        d = ImageDraw.Draw(canvas)
        scale = height / original.height
        bbox = tuple(round(v*scale) + (x if i%2==0 else y)
                     for i,v in enumerate((238, 2013, 416, 2333)))
        d.rounded_rectangle(bbox, radius=32, outline=ORANGE, width=5)
    dest = OUT / (slug + ".png")
    canvas.save(dest, optimize=True)
    manifest.append({"file":dest.name, "size":[1080,1920], "mode":"RGB",
                     "source":source, "source_sha256":hashlib.sha256(src.read_bytes()).hexdigest(),
                     "headline":lines, "caption":caption})

(OUT / "manifest.json").write_text(json.dumps(manifest, indent=2)+"\n")
# Contact sheet is for review only, not a Play Console upload.
review = Image.new("RGB", (360*len(manifest), 690), BG)
for i, entry in enumerate(manifest):
    img = Image.open(OUT / entry["file"])
    img.thumbnail((342,608), Image.Resampling.LANCZOS)
    review.paste(img,(12+i*360,42))
    ImageDraw.Draw(review).text((12+i*360,12),str(i+1).zfill(2),fill=INK,font=font(22,True))
review.save(OUT / "review-contact-sheet.jpg", quality=95)
print("Created",len(manifest),"screenshots:",OUT)
