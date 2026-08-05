"""Shared image handling — decode any upload (incl. iPhone HEIC), honor EXIF
orientation, and re-encode to a web-friendly JPEG. Used by day photos and food
photos."""

import io


def process_image_to_jpeg(content: bytes, quality: int = 85) -> bytes:
    """Decode `content` (HEIC/PNG/JPEG/...) and return orientation-corrected JPEG bytes.

    Raises ValueError on empty input or a decode/encode failure.
    """
    if not content:
        raise ValueError("Empty file")

    import pillow_heif
    import PIL.Image as Image
    from PIL import ImageOps

    pillow_heif.register_heif_opener()  # iPhone HEIC support

    try:
        img = Image.open(io.BytesIO(content))
        img = ImageOps.exif_transpose(img)
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality)
        return buf.getvalue()
    except Exception as e:
        raise ValueError(f"Image conversion failed: {e}") from e
