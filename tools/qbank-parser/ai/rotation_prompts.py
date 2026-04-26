"""
Rotation-specific USMLE formatter prompt helpers.

Loads the full rotation master prompts from repository templates and wraps them
with a strict JSON output contract for downstream compatibility.
"""

from __future__ import annotations

from pathlib import Path


CANONICAL_ROTATIONS = (
    "Internal Medicine",
    "General Surgery",
    "OB-GYN",
    "Pediatrics",
)

ROTATION_ALIASES = {
    "internal medicine": "Internal Medicine",
    "medicine": "Internal Medicine",
    "general surgery": "General Surgery",
    "surgery": "General Surgery",
    "ob-gyn": "OB-GYN",
    "obgyn": "OB-GYN",
    "ob gyn": "OB-GYN",
    "obstetrics and gynecology": "OB-GYN",
    "obstetrics & gynecology": "OB-GYN",
    "pediatrics": "Pediatrics",
    "paediatrics": "Pediatrics",
}

ROTATION_TEMPLATE_FILES = {
    "Internal Medicine": "internal_medicine.txt",
    "General Surgery": "general_surgery.txt",
    "OB-GYN": "ob_gyn.txt",
    "Pediatrics": "pediatrics.txt",
}

TEMPLATE_DIR = Path(__file__).resolve().parent / "rotation_prompt_templates"


def normalize_rotation_name(rotation: str) -> str:
    """Return canonical rotation label used by formatter and tags."""
    cleaned = (rotation or "").strip()
    if cleaned in CANONICAL_ROTATIONS:
        return cleaned

    lowered = cleaned.lower()
    if lowered in ROTATION_ALIASES:
        return ROTATION_ALIASES[lowered]

    raise ValueError(f"Unsupported rotation: {rotation!r}")


def get_master_prompt(rotation: str) -> str:
    """Load full master prompt text for the selected rotation."""
    canonical = normalize_rotation_name(rotation)
    template_name = ROTATION_TEMPLATE_FILES[canonical]
    template_path = TEMPLATE_DIR / template_name
    if not template_path.exists():
        raise FileNotFoundError(f"Rotation prompt template not found: {template_path}")
    return template_path.read_text(encoding="utf-8").strip()


def build_rotation_formatter_prompt(
    rotation: str,
    question_stem: str,
    choices: str,
    correct_answer: str,
    explanation: str,
    slide_number: int,
    has_images: str,
) -> str:
    """
    Build the final formatter prompt with strict JSON response contract.

    The base master prompt remains rotation-specific, while the wrapper enforces
    machine-readable output for the rest of the pipeline.
    """
    canonical = normalize_rotation_name(rotation)
    master_prompt = get_master_prompt(canonical)
    return f"""{master_prompt}

---
STRUCTURED INPUTS (from parser):
Question: {question_stem}
Answer Choices: {choices}
Correct Answer: {correct_answer}
Context/Explanation: {explanation}
Original Slide Number: {slide_number}
Images Available: {has_images}
Rotation (fixed): {canonical}

---
STRICT OUTPUT REQUIREMENTS:
- Return JSON only. Do not return markdown, bullet lists, or prose outside JSON.
- Keep medical content faithful to the rotation master prompt constraints.
- `tags.rotation` MUST be exactly "{canonical}".
- `tags.topic` MUST be exactly one allowed topic from this rotation's list.
- Provide 4-5 answer choices in `choices`.
- `correct_answer` must be one letter key from `choices`.
- Include incorrect explanations for every non-correct choice you returned.

Respond using this exact JSON schema:
{{
  "question_stem": "Full clinical vignette",
  "question": "Single-sentence lead-in question",
  "choices": {{
    "A": "...",
    "B": "...",
    "C": "...",
    "D": "...",
    "E": "..."
  }},
  "correct_answer": "D",
  "correct_answer_explanation": "Detailed explanation...",
  "incorrect_explanations": {{
    "A": "Why A is wrong...",
    "B": "Why B is wrong...",
    "C": "Why C is wrong...",
    "E": "Why E is wrong..."
  }},
  "educational_objective": "3-6 line high-yield takeaway...",
  "tags": {{
    "rotation": "{canonical}",
    "topic": "One allowed topic for this rotation"
  }},
  "quality_flags": []
}}
"""

