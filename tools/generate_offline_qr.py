"""Generate the offline text QR from the printable card's marked text."""
from html import unescape
from pathlib import Path
import re

import qrcode
from qrcode.constants import ERROR_CORRECT_M
from qrcode.image.svg import SvgPathImage


ROOT = Path(__file__).resolve().parents[1]
CARD = ROOT / "qr" / "index.html"
OUTPUT = ROOT / "assets" / "img" / "offline-text-qr.svg"
LINE = re.compile(
    r"<(h1|h2|h3|p|li)\b(?=[^>]*\bdata-qr-line\b)[^>]*>(.*?)</\1>",
    re.IGNORECASE | re.DOTALL,
)


def qr_lines(markup: str) -> list[str]:
    lines = []
    for _tag, inner in LINE.findall(markup):
        plain = re.sub(r"<[^>]+>", " ", inner)
        line = " ".join(unescape(plain).split())
        if line:
            lines.append(line)
    return lines


def main() -> None:
    lines = qr_lines(CARD.read_text(encoding="utf-8"))
    if not lines:
        raise SystemExit("No data-qr-line text found in qr/index.html")

    payload = "\n".join(lines)
    code = qrcode.QRCode(
        version=None,
        error_correction=ERROR_CORRECT_M,
        box_size=10,
        border=4,
    )
    code.add_data(payload.encode("utf-8"), optimize=0)
    code.make(fit=True)
    svg = code.make_image(image_factory=SvgPathImage).to_string(encoding="unicode")
    svg = re.sub(
        r"(<svg\b[^>]*>)",
        r"\1\n  <title>CMUBioTriage offline snakebite text QR code</title>",
        svg,
        count=1,
    )
    svg = re.sub(r"<svg\b", '<svg shape-rendering="crispEdges"', svg, count=1)
    OUTPUT.write_text(svg, encoding="utf-8")
    print(f"Generated QR version {code.version}; {len(payload)} UTF-8 bytes from {len(lines)} card lines.")


if __name__ == "__main__":
    main()
