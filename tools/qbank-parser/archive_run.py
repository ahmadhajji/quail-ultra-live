#!/usr/bin/env python3
"""
Archive the current run and reset workspace for a new session.

Usage:
    python archive_run.py "Session Name"
    python archive_run.py  # Prompts for name interactively
"""

import os
import sys
import shutil
import re
from pathlib import Path
from datetime import datetime

# Paths
BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
OUTPUT_DIR = BASE_DIR / "output"
ARCHIVES_DIR = BASE_DIR / "archives"


def _has_non_placeholder_files(root: Path, ignored_names: set[str]) -> bool:
    """Return True when directory contains at least one real file."""
    if not root.exists():
        return False
    for candidate in root.rglob("*"):
        if candidate.is_file() and candidate.name not in ignored_names:
            return True
    return False


def fix_image_paths(md_file: Path):
    """Convert absolute image paths to relative paths in markdown file."""
    if not md_file.exists():
        return
    
    content = md_file.read_text()
    # Replace absolute paths with relative
    pattern = str(OUTPUT_DIR / "extracted_images") + "/"
    content = content.replace(pattern, "extracted_images/")
    md_file.write_text(content)
    print(f"  ✓ Fixed image paths in {md_file.name}")


def get_archive_name() -> str:
    """Get archive name from argument or prompt user."""
    if len(sys.argv) > 1:
        return " ".join(sys.argv[1:])
    
    # Interactive prompt
    print("\n📦 Archive Current Run")
    print("-" * 40)
    name = input("Enter archive name: ").strip()
    
    if not name:
        # Default to timestamp
        name = f"run_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        print(f"  Using default name: {name}")
    
    return name


def sanitize_name(name: str) -> str:
    """Sanitize folder name."""
    # Replace problematic characters but keep spaces
    return re.sub(r'[<>:"/\\|?*]', '_', name)


def has_content() -> bool:
    """Check if there's anything to archive."""
    data_has_content = _has_non_placeholder_files(DATA_DIR, {".gitkeep", ".DS_Store"})
    output_has_content = _has_non_placeholder_files(OUTPUT_DIR, {".gitkeep", ".DS_Store"})
    return data_has_content or output_has_content


def archive_run(name: str):
    """Archive current run to named folder."""
    name = sanitize_name(name)
    archive_path = ARCHIVES_DIR / name
    
    # Check if archive already exists
    if archive_path.exists():
        response = input(f"  ⚠️  '{name}' already exists. Overwrite? [y/N]: ").strip().lower()
        if response != 'y':
            print("  Cancelled.")
            return False
        shutil.rmtree(archive_path)
    
    # Create archive directory
    archive_path.mkdir(parents=True, exist_ok=True)
    print(f"\n📁 Creating archive: {name}")
    
    # Fix markdown image paths before moving
    md_file = OUTPUT_DIR / "usmle_formatted_questions.md"
    fix_image_paths(md_file)
    
    # Move data files
    data_files = [f for f in DATA_DIR.glob("*") if f.name != ".gitkeep"]
    for f in data_files:
        shutil.move(str(f), str(archive_path / f.name))
        print(f"  ✓ Moved {f.name}")
    
    # Move output files
    output_files = [f for f in OUTPUT_DIR.glob("*") if f.name not in [".gitkeep", ".DS_Store"]]
    for f in output_files:
        shutil.move(str(f), str(archive_path / f.name))
        print(f"  ✓ Moved {f.name}")
    
    return True


def reset_workspace():
    """Reset data and output directories for new run."""
    print("\n🧹 Resetting workspace...")
    
    # Recreate empty directories with .gitkeep
    for dir_path in [DATA_DIR, OUTPUT_DIR, OUTPUT_DIR / "extracted_images"]:
        dir_path.mkdir(parents=True, exist_ok=True)
        gitkeep = dir_path / ".gitkeep"
        if not gitkeep.exists():
            gitkeep.touch()
    
    print("  ✓ data/ ready for new input")
    print("  ✓ output/ ready for new output")


def main():
    print("\n" + "=" * 50)
    print("   QBank Parser - Archive & Reset")
    print("=" * 50)
    
    if not has_content():
        print("\n⚠️  No content to archive. Workspace is already clean.")
        return
    
    # Show current content summary
    data_files = [f.name for f in DATA_DIR.glob("*") if f.name != ".gitkeep"]
    output_files = [f.name for f in OUTPUT_DIR.glob("*") if f.name not in [".gitkeep", ".DS_Store"]]
    
    print("\n📋 Current workspace content:")
    if data_files:
        print(f"  data/: {', '.join(data_files[:3])}{'...' if len(data_files) > 3 else ''}")
    if output_files:
        print(f"  output/: {len(output_files)} items")
    
    # Get archive name
    name = get_archive_name()
    
    # Archive and reset
    if archive_run(name):
        reset_workspace()
        print(f"\n✅ Done! Archived to: archives/{name}/")
        print("   Workspace is ready for a new run.\n")


if __name__ == "__main__":
    main()
