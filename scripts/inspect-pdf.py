"""Independent local PDF content/render inspection; called on synthetic fixtures only."""
import json
import sys
from pathlib import Path
import pymupdf

document = pymupdf.open(sys.argv[1])
pages = []
for index, page in enumerate(document):
    pages.append({"text": page.get_text(), "links": len(page.get_links()),
                  "images": len(page.get_images()),
                  "words": [{"rect": list(word[:4]), "text": word[4]} for word in page.get_text("words")]})
    if len(sys.argv) > 2:
        output = Path(sys.argv[2])
        output.mkdir(parents=True, exist_ok=True)
        page.get_pixmap(matrix=pymupdf.Matrix(1, 1)).save(output / f"page-{index + 1}.png")
print(json.dumps({"pages": pages, "attachments": document.embfile_count()}, ensure_ascii=True))
