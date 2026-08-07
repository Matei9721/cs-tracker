from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
ASSETS.mkdir(exist_ok=True)

canvas = Image.new("RGBA", (256, 256), "#090b0c")
tile = Image.new("RGBA", (196, 196), (0, 0, 0, 0))
draw = ImageDraw.Draw(tile)
draw.rounded_rectangle((6, 6, 190, 190), radius=18, fill="#d7ff39")

font_path = Path("C:/Windows/Fonts/arialbd.ttf")
font = ImageFont.truetype(str(font_path), 126)
text_box = draw.textbbox((0, 0), "3", font=font)
text_width = text_box[2] - text_box[0]
text_height = text_box[3] - text_box[1]
draw.text(
    ((196 - text_width) / 2, (196 - text_height) / 2 - text_box[1] - 2),
    "3",
    fill="#090b0c",
    font=font,
)

tile = tile.rotate(4, resample=Image.Resampling.BICUBIC, expand=True)
canvas.alpha_composite(tile, ((256 - tile.width) // 2, (256 - tile.height) // 2))

canvas.save(ASSETS / "favicon-256.png", optimize=True)
canvas.resize((64, 64), Image.Resampling.LANCZOS).save(
    ASSETS / "favicon.png", optimize=True
)
canvas.resize((180, 180), Image.Resampling.LANCZOS).save(
    ASSETS / "apple-touch-icon.png", optimize=True
)
