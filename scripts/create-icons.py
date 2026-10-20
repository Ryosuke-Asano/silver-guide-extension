"""Rasterize the existing BookIcon geometry for browser toolbar/manifest icons."""
from pathlib import Path
from PIL import Image, ImageDraw

destination = Path(__file__).resolve().parent.parent / "public" / "icons"
destination.mkdir(parents=True, exist_ok=True)

def curve(start, control_one, control_two, end):
    result = []
    for step in range(65):
        t = step / 64
        result.append(tuple((1-t)**3*start[axis] + 3*(1-t)**2*t*control_one[axis] + 3*(1-t)*t*t*control_two[axis] + t**3*end[axis] for axis in (0, 1)))
    return result

left = curve((3.5, 5.5), (5.7, 4.6), (8.3, 5), (10, 6.5)) + [(10, 17.5)]
left += curve((10, 17.5), (8.3, 16), (5.7, 15.6), (3.5, 16.5)) + [(3.5, 5.5)]
right = [(24-x, y) for x, y in left]
for size in (16, 32, 48, 64, 128):
    factor = size * 4 / 24
    image = Image.new("RGBA", (size*4, size*4), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    width = round(1.8 * factor)
    for points in (left, right, [(12, 6.5), (12, 17.5)]):
        scaled = [(round(x*factor), round(y*factor)) for x, y in points]
        draw.line(scaled, fill="#076c78", width=width, joint="curve")
        radius = width / 2
        for x, y in (scaled[0], scaled[-1]):
            draw.ellipse((x-radius, y-radius, x+radius, y+radius), fill="#076c78")
    image.resize((size, size), Image.Resampling.LANCZOS).save(destination / f"book-{size}.png")
