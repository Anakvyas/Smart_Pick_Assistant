"""1D/2D barcode and QR decoding, via zxingcpp."""

import re

import zxingcpp

TWO_D = {"QRCode", "QRCodeModel1", "QRCodeModel2", "MicroQRCode", "RMQRCode",
         "DataMatrix", "PDF417", "MicroPDF417", "CompactPDF417",
         "Aztec", "AztecCode", "AztecRune", "MaxiCode"}

# The display page shows QR codes linking to /scan and /upload (so a phone
# can jump straight there) — if the camera being used to scan also catches
# that QR code on a monitor in the background, it decodes just fine and
# would otherwise show up as a "found item". No real product barcode is
# ever a link to this app's own pages, so drop these.
_SELF_LINK_RE = re.compile(r"^https?://[^/\s]+/(scan|upload)/?$", re.I)


def read_codes(img):
    """Decode 1D + 2D + QR. Returns [{kind, value, is_2d, box}].

    `box` is the barcode's own pixel bounding box [x1,y1,x2,y2] in `img`.
    """
    if img is None or img.size == 0:
        return []
    try:
        results = zxingcpp.read_barcodes(img)
    except Exception:
        return []
    out = []
    for r in results:
        if not r.text or _SELF_LINK_RE.match(r.text):
            continue
        fmt = getattr(r.format, "name", None) or str(r.format)
        p = r.position
        xs = (p.top_left.x, p.top_right.x, p.bottom_left.x, p.bottom_right.x)
        ys = (p.top_left.y, p.top_right.y, p.bottom_left.y, p.bottom_right.y)
        out.append({"kind": fmt, "value": r.text, "is_2d": fmt in TWO_D,
                    "box": [min(xs), min(ys), max(xs), max(ys)]})
    return out
