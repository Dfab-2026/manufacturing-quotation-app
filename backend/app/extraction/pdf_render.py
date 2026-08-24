from pathlib import Path
import fitz


def pdf_to_images(pdf_path: str, output_folder: str):
    pdf_path = Path(pdf_path)
    output_folder = Path(output_folder)

    output_folder.mkdir(parents=True, exist_ok=True)

    document = fitz.open(pdf_path)

    image_paths = []

    for page_number, page in enumerate(document):
        # Around 300 DPI
        zoom = 300 / 72
        matrix = fitz.Matrix(zoom, zoom)

        pixmap = page.get_pixmap(
            matrix=matrix,
            alpha=False
        )

        output_path = output_folder / f"page_{page_number + 1}.png"

        pixmap.save(output_path)

        image_paths.append(str(output_path))

    document.close()

    return image_paths


if __name__ == "__main__":
    pdf_file = "test_drawing.pdf"
    output_dir = "rendered_pages"

    results = pdf_to_images(pdf_file, output_dir)

    print("Converted successfully:")

    for image in results:
        print(image)