#!/usr/bin/env python3
"""
Convert Markdown to PDF with embedded images using Playwright.

This script:
1. Converts markdown to styled HTML
2. Uses Playwright's Chromium headless browser to render and export as PDF
3. Ensures all local images are properly embedded
"""

import asyncio
import markdown2
import tempfile
from pathlib import Path
from playwright.async_api import async_playwright


async def convert_md_to_pdf(md_path: str, pdf_path: str):
    """Convert a markdown file to PDF with embedded images."""
    
    md_file = Path(md_path)
    
    # Read the markdown content
    with open(md_file, 'r', encoding='utf-8') as f:
        md_content = f.read()
    
    # Convert markdown to HTML with extras
    html_content = markdown2.markdown(
        md_content,
        extras=['fenced-code-blocks', 'tables', 'code-friendly', 'header-ids']
    )
    
    # Build complete HTML document with styling
    full_html = f'''<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        @page {{
            size: A4;
            margin: 1.5cm;
        }}
        
        * {{
            box-sizing: border-box;
        }}
        
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            font-size: 11pt;
            line-height: 1.6;
            color: #24292e;
            max-width: 100%;
            padding: 20px;
        }}
        
        h1 {{
            font-size: 22pt;
            color: #1a1a1a;
            border-bottom: 2px solid #3498db;
            padding-bottom: 10px;
            margin-top: 40px;
            margin-bottom: 20px;
            page-break-after: avoid;
        }}
        
        h2 {{
            font-size: 16pt;
            color: #2c3e50;
            margin-top: 25px;
            margin-bottom: 12px;
            page-break-after: avoid;
        }}
        
        h3 {{
            font-size: 13pt;
            color: #34495e;
            margin-top: 18px;
            margin-bottom: 10px;
            page-break-after: avoid;
        }}
        
        p {{
            text-align: justify;
            margin: 12px 0;
        }}
        
        img {{
            max-width: 100%;
            height: auto;
            display: block;
            margin: 20px auto;
            border: 1px solid #e1e4e8;
            border-radius: 6px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }}
        
        strong {{
            color: #2c3e50;
        }}
        
        code {{
            background-color: #f6f8fa;
            padding: 3px 6px;
            border-radius: 4px;
            font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
            font-size: 10pt;
        }}
        
        pre {{
            background-color: #f6f8fa;
            padding: 16px;
            border-radius: 6px;
            overflow-x: auto;
            font-size: 10pt;
            border: 1px solid #e1e4e8;
        }}
        
        pre code {{
            background: none;
            padding: 0;
        }}
        
        hr {{
            border: none;
            border-top: 1px solid #e1e4e8;
            margin: 30px 0;
        }}
        
        ul, ol {{
            margin: 12px 0;
            padding-left: 28px;
        }}
        
        li {{
            margin: 6px 0;
        }}
        
        /* Correct answer styling - look for checkmark emoji */
        li:has(strong:first-child) {{
            font-weight: normal;
        }}
        
        /* Educational objective section */
        h3 + p {{
            background-color: #f0f7ff;
            padding: 12px 16px;
            border-left: 4px solid #3498db;
            border-radius: 0 6px 6px 0;
        }}
        
        /* Tags section styling */
        ul:last-of-type {{
            background-color: #f8f9fa;
            padding: 12px 28px;
            border-radius: 6px;
            list-style: none;
        }}
        
        ul:last-of-type li {{
            display: inline-block;
            margin-right: 15px;
        }}
        
        /* Question ID styling */
        p strong:first-child {{
            color: #6c757d;
        }}
        
        /* Page break before each main question */
        h1:not(:first-of-type) {{
            page-break-before: always;
        }}
    </style>
</head>
<body>
    {html_content}
</body>
</html>'''
    
    # Save to a unique temp HTML file for Playwright to load.
    temp_fd, temp_path = tempfile.mkstemp(
        prefix="qbank_pdf_",
        suffix=".html",
        dir=str(md_file.parent),
        text=True,
    )
    temp_html = Path(temp_path)
    with open(temp_fd, "w", encoding="utf-8", closefd=True) as f:
        f.write(full_html)
    
    print(f"Converting {md_path} to PDF...")
    print(f"Processing {len(html_content)} characters of HTML content...")
    
    try:
        # Use Playwright to generate PDF
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            page = await browser.new_page()

            # Load the HTML file (this ensures local file:// paths work for images)
            await page.goto(f'file://{temp_html.absolute()}', wait_until='networkidle')

            # Generate PDF
            await page.pdf(
                path=pdf_path,
                format='A4',
                margin={
                    'top': '1.5cm',
                    'right': '1.5cm',
                    'bottom': '1.5cm',
                    'left': '1.5cm'
                },
                print_background=True
            )

            await browser.close()
    finally:
        temp_html.unlink(missing_ok=True)
    
    print(f"✅ PDF saved to: {pdf_path}")


def main():
    import sys
    
    if len(sys.argv) >= 2:
        md_file = sys.argv[1]
        pdf_file = sys.argv[2] if len(sys.argv) >= 3 else md_file.replace('.md', '.pdf')
    else:
        # Default paths
        md_file = "output/usmle_formatted_questions.md"
        pdf_file = "output/usmle_formatted_questions.pdf"
    
    asyncio.run(convert_md_to_pdf(md_file, pdf_file))


if __name__ == "__main__":
    main()
