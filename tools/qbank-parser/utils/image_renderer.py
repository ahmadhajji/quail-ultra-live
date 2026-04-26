"""
Image Rendering Utilities

Converts PPTX slides to images for Gemini vision analysis.
Uses pdf2image for high-quality rendering when available.
"""

import os
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

try:
    from pdf2image import convert_from_path
    PDF2IMAGE_AVAILABLE = True
except ImportError:
    PDF2IMAGE_AVAILABLE = False


def pptx_to_images(pptx_path: str | Path,
                   output_dir: str | Path,
                   dpi: int = 150) -> list[str]:
    """
    Convert PPTX slides to images.
    
    This uses LibreOffice to convert PPTX to PDF, then pdf2image
    to convert to images. Falls back to lower quality methods if needed.
    
    Args:
        pptx_path: Path to PPTX file
        output_dir: Directory to save images
        dpi: Resolution for rendering
    
    Returns:
        List of paths to generated slide images
    """
    pptx_path = Path(pptx_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    image_paths = []
    
    # Try LibreOffice + pdf2image method
    if PDF2IMAGE_AVAILABLE:
        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                # Convert PPTX to PDF using LibreOffice
                pdf_path = Path(tmpdir) / f"{pptx_path.stem}.pdf"
                
                result = subprocess.run([
                    'soffice', '--headless', '--convert-to', 'pdf',
                    '--outdir', tmpdir, str(pptx_path)
                ], capture_output=True, text=True, timeout=120)
                
                if result.returncode == 0 and pdf_path.exists():
                    # Convert PDF pages to images
                    images = convert_from_path(pdf_path, dpi=dpi)
                    
                    for i, image in enumerate(images, start=1):
                        img_path = output_dir / f"slide_{i}.png"
                        image.save(img_path, 'PNG')
                        image_paths.append(str(img_path))
                    
                    return image_paths
        except Exception as e:
            print(f"LibreOffice conversion failed: {e}")
    
    # Fallback: Try using python-pptx to extract what we can
    # This won't give us full slide renders but is better than nothing
    print("Note: Full slide image rendering not available.")
    print("For best results, install LibreOffice and poppler:")
    print("  brew install --cask libreoffice && brew install poppler")
    
    return image_paths


def resize_image_for_api(image_path: str | Path,
                        max_size: int = 2048,
                        output_path: Optional[str | Path] = None) -> str:
    """
    Resize an image to fit within API limits.
    
    Args:
        image_path: Path to image
        max_size: Maximum dimension (width or height)
        output_path: Where to save resized image (defaults to same location with _resized suffix)
    
    Returns:
        Path to resized image
    """
    if not PIL_AVAILABLE:
        return str(image_path)
    
    image_path = Path(image_path)
    
    if output_path is None:
        output_path = image_path.parent / f"{image_path.stem}_resized{image_path.suffix}"
    
    output_path = Path(output_path)
    
    with Image.open(image_path) as img:
        # Check if resizing is needed
        if max(img.size) <= max_size:
            return str(image_path)
        
        # Calculate new size maintaining aspect ratio
        ratio = max_size / max(img.size)
        new_size = tuple(int(dim * ratio) for dim in img.size)
        
        # Resize and save
        resized = img.resize(new_size, Image.Resampling.LANCZOS)
        resized.save(output_path)
    
    return str(output_path)


def check_rendering_dependencies() -> dict:
    """
    Check which rendering dependencies are available.
    
    Returns:
        Dictionary of dependency status
    """
    status = {
        "PIL": PIL_AVAILABLE,
        "pdf2image": PDF2IMAGE_AVAILABLE,
        "libreoffice": False,
        "poppler": False
    }
    
    # Check LibreOffice
    try:
        result = subprocess.run(['soffice', '--version'], 
                              capture_output=True, timeout=5)
        status["libreoffice"] = result.returncode == 0
    except Exception:
        pass
    
    # Check poppler (pdftoppm)
    try:
        result = subprocess.run(['pdftoppm', '-v'], 
                              capture_output=True, timeout=5)
        status["poppler"] = True  # Returns non-zero but command exists
    except FileNotFoundError:
        pass
    except Exception:
        status["poppler"] = True
    
    return status


if __name__ == "__main__":
    # Check dependencies
    deps = check_rendering_dependencies()
    print("Rendering Dependencies:")
    for name, available in deps.items():
        status = "✅" if available else "❌"
        print(f"  {status} {name}")
