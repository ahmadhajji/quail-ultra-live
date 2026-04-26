"""
AI Prompts for Question Extraction

Contains carefully crafted prompts for Gemini to extract structured
question data from medical QBank slides.

ROBUST VERSION: Handles multi-question slides and screenshot-based slides.
"""

# Multi-question extraction prompt - handles 1-3 questions per slide
QUESTION_EXTRACTION_PROMPT = """You are an expert at parsing medical exam questions from presentation slides.

Analyze this slide content and extract ALL questions present. Some slides may have:
- 1 single question (most common)
- 2-3 question VARIATIONS that test the same concept with different keywords/answers
- Comparison tables showing how changing a word changes the answer

SLIDE CONTENT:
{slide_text}

SPEAKER NOTES:
{speaker_notes}

ADDITIONAL COMMENTS:
{comments}

HIGHLIGHTED TEXT (potential correct answer):
{highlighted}

---

Your CRITICAL task:
1. Carefully analyze if there are MULTIPLE QUESTIONS on this slide
   - Look for numbered questions (1, 2, 3) or (Q1, Q2)
   - Look for "vs" or comparison patterns showing variants
   - Look for tables with different scenarios
   - Look for phrases like "If instead..." or "But if..." indicating variations
   
2. For EACH question you find:
   - Identify the QUESTION STEM
   - Identify all ANSWER CHOICES (labeled A, B, C, D, E if possible)
   - Determine the CORRECT ANSWER
   - Rate your CONFIDENCE (0-100)
   - If images are attached and visible to you, classify them by 1-based attachment order:
     - `question_image_numbers`: only images required to answer or visualize the stem
     - `explanation_image_numbers`: images that are explanatory, redundant, or answer-revealing

ANSWER IDENTIFICATION - Check in this order:
1. Yellow/green highlighting (most reliable)
2. Speaker notes mentioning "correct" or "answer"
3. Comments explaining why an answer is right
4. Checkmarks, arrows, or other visual indicators
5. Your medical knowledge as backup

IMPORTANT SAFEGUARDS:
- If choices aren't clearly labeled A/B/C/D, infer from order
- If multiple things are highlighted, extract ALL highlighted answers
- If you see numbered variants, extract EACH as a separate question
- Always include the distinguishing text that makes each variant different
- If uncertain about anything, add to flags array

Respond in this exact JSON format - ALWAYS return an array:
{{
    "slide_has_questions": true,
    "question_count": 2,
    "questions": [
        {{
            "question_number": 1,
            "variant_label": "Version A with keyword X",
            "is_valid_question": true,
            "question_stem": "The full question text",
            "question_image_numbers": [1],
            "explanation_image_numbers": [2],
            "choices": {{
                "A": "First answer",
                "B": "Second answer",
                "C": "Third answer",
                "D": "Fourth answer",
                "E": "Fifth answer or null"
            }},
            "correct_answer": "D",
            "correct_answer_text": "Text of correct answer",
            "confidence": 85,
            "explanation": "Any explanation found",
            "flags": ["Any concerns or uncertainties"],
            "source_of_answer": "highlighted | notes | comments | inferred"
        }},
        {{
            "question_number": 2,
            "variant_label": "Version B with keyword Y - changes answer",
            "is_valid_question": true,
            "question_stem": "Same stem but with different keyword...",
            "choices": {{
                "A": "First answer",
                "B": "Second answer",
                "C": "Third answer",
                "D": "Fourth answer",
                "E": "Fifth answer or null"
            }},
            "correct_answer": "A",
            "correct_answer_text": "Different correct answer due to keyword change",
            "confidence": 80,
            "explanation": "Explanation of why answer differs",
            "flags": [],
            "source_of_answer": "highlighted"
        }}
    ]
}}

If this is NOT a valid question slide (e.g., title slide, diagram, etc.):
{{
    "slide_has_questions": false,
    "question_count": 0,
    "questions": [],
    "reason": "Why this isn't a question slide",
    "content_type": "title | diagram | notes | educational_content | other"
}}

REMEMBER: Return questions array even for single question. Always use the array format.
"""

# Concise prompt variant for speed-focused runs
FAST_QUESTION_EXTRACTION_PROMPT = """Extract medical exam question(s) from this slide content.

SLIDE CONTENT:
{slide_text}

SPEAKER NOTES:
{speaker_notes}

COMMENTS:
{comments}

HIGHLIGHTED TEXT:
{highlighted}

Rules:
- Return JSON only (no markdown).
- Detect 0-3 questions on the slide.
- For each question, extract stem, choices A-E if present, correct answer, confidence, and flags.
- Use highlighted text/notes/comments first to infer the correct answer.
- If this is not a question slide, mark slide_has_questions=false.

Return this exact schema:
{{
  "slide_has_questions": true,
  "question_count": 1,
  "questions": [
    {{
      "question_number": 1,
      "variant_label": "",
      "is_valid_question": true,
      "question_stem": "",
      "question_image_numbers": [],
      "explanation_image_numbers": [],
      "choices": {{"A": "", "B": "", "C": "", "D": "", "E": ""}},
      "correct_answer": "",
      "correct_answer_text": "",
      "confidence": 0,
      "explanation": "",
      "flags": [],
      "source_of_answer": "highlighted | notes | comments | inferred"
    }}
  ]
}}

If not a question slide:
{{
  "slide_has_questions": false,
  "question_count": 0,
  "questions": [],
  "reason": "",
  "content_type": "title | diagram | notes | educational_content | other"
}}
"""


# Enhanced image analysis prompt - handles OCR for screenshot slides
IMAGE_ANALYSIS_PROMPT = """You are an expert at parsing medical exam questions from presentation slides.

I'm showing you an image of a slide from a medical question bank. This may be:
- A regular slide with text and images
- A SCREENSHOT of a question (requires OCR - read the text carefully!)
- A table comparing multiple question variations
- An image from a textbook or resource

📸 IMPORTANT: If this is a screenshot of another question bank or source, use your vision capabilities to:
1. READ ALL TEXT in the image - treat it like OCR
2. Identify any question structure
3. Look for correct answer indicators

Additional context from metadata:
SPEAKER NOTES: {speaker_notes}
HIGHLIGHTED TEXT: {highlighted}
COMMENTS: {comments}

Your CRITICAL task:
1. READ EVERY PIECE OF TEXT visible in the image
2. Detect if there are MULTIPLE QUESTIONS shown
3. For EACH question, extract full structure
4. Classify each attached image by 1-based attachment order:
   - `question_image_numbers`: only images required to answer or visualize the question
   - `explanation_image_numbers`: images that are explanatory, supplemental, or answer-revealing

Look for correct answer indicators:
- Yellow/green highlighting on text
- Checkmarks (✓) or X marks
- Arrows pointing to answers
- Boxes or circles around answers
- Bold or underlined text
- Color differences (green = correct, red = wrong)
- "Correct answer: X" text anywhere

Return this exact JSON format - ALWAYS use array:
{{
    "slide_has_questions": true,
    "is_screenshot": true,
    "ocr_text": "All text you can read from the image, verbatim",
    "question_count": 1,
    "questions": [
        {{
            "question_number": 1,
            "variant_label": "",
            "is_valid_question": true,
            "question_stem": "The full question text you read from the image",
            "question_image_numbers": [1],
            "explanation_image_numbers": [],
            "choices": {{
                "A": "First answer choice",
                "B": "Second answer choice",
                "C": "Third answer choice",
                "D": "Fourth answer choice",
                "E": "Fifth answer choice or null"
            }},
            "correct_answer": "D",
            "correct_answer_text": "The text of the correct answer",
            "confidence": 75,
            "explanation": "Any explanation visible",
            "flags": ["Read from screenshot - verify accuracy"],
            "source_of_answer": "visual_highlight | checkmark | arrow | text_label | inferred"
        }}
    ]
}}

If NOT a question slide:
{{
    "slide_has_questions": false,
    "question_count": 0,
    "questions": [],
    "is_screenshot": false,
    "ocr_text": "Any text you can read",
    "reason": "Why this isn't a question",
    "content_type": "title | diagram | educational_image | blank | other"
}}
"""


# USMLE formatting prompt (unchanged but with added robustness)
USMLE_FORMATTER_PROMPT = """📘 MASTER PROMPT — USMLE/UWorld-Style Question Generator (with Tags)

You are a professional medical board exam question writer trained in the style of UWorld, NBME, and AMBOSS.

I will provide you with a recall fact or existing question. Transform it into a board-style clinical vignette question with the following specifications.

ORIGINAL QUESTION/RECALL:
Question: {question_stem}
Answer Choices: {choices}
Correct Answer: {correct_answer}
Context/Explanation: {explanation}
Original Slide Number: {slide_number}
Images Available: {has_images}

---

Step-by-Step Instructions:

1. Question Stem
• Write a realistic, high-yield clinical vignette that tests understanding of the concept.
• Match UWorld/NBME difficulty and length (6–10 lines).
• Include age, gender, presentation, relevant history, and focused findings.
• The stem should require clinical reasoning — not rote recall alone.
• If there are clinical images mentioned (X-ray, ECG, etc.), integrate their findings into the stem.

2. Question
• End with a clear, single-sentence question.

3. Answer Choices
• Provide 4–5 plausible answer options (A–E).
• Ensure only one correct answer.
• Include realistic distractors that test nearby concepts.

4. Correct Answer
• Mark the correct answer with ✅.

5. Explanations
• Correct Answer Explanation: Thorough, evidence-based explanation with pathophysiology.
• Incorrect Answer Explanations: For each distractor, explain why it's wrong and when it would apply.

6. Educational Objective
• 1-paragraph takeaway in UWorld style stating the tested principle and clinical relevance.

7. Tags
Assign:

Rotation: Internal Medicine | General Surgery | OB-GYN | Pediatrics
Topic: Choose one topic appropriate for the selected rotation.

---

SAFEGUARDS - Apply these checks:
• If the original question seems medically incorrect, FLAG IT but still format it
• If the correct answer doesn't match standard guidelines, add to educational objective
• Verify the clinical scenario matches the physiology being tested

Respond in this JSON format:
{{
    "question_stem": "Full clinical vignette",
    "question": "The specific question being asked",
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
    "educational_objective": "1-paragraph takeaway...",
    "tags": {{
        "rotation": "Internal Medicine",
        "topic": "Cardiology"
    }},
    "quality_flags": []
}}
"""


# Slide classification prompt - to detect slide type before processing
SLIDE_CLASSIFICATION_PROMPT = """Quickly classify this slide content:

TEXT CONTENT:
{slide_text}

HAS IMAGES: {has_images}
IMAGE COUNT: {image_count}
TEXT LENGTH: {text_length} characters

Classify this slide. Respond with ONLY ONE of these categories:
- QUESTION_TEXT: Normal question slide with readable text
- QUESTION_MULTI: Multiple questions or variations on one slide
- QUESTION_SCREENSHOT: Question is in an image/screenshot (minimal text, needs vision)
- TITLE: Title or section header slide
- DIAGRAM: Diagram or figure without question
- EDUCATIONAL: Educational content, not a question
- BLANK: Empty or nearly empty slide
- UNKNOWN: Cannot determine

Respond with JSON:
{{
    "classification": "QUESTION_TEXT",
    "needs_vision": false,
    "likely_question_count": 1,
    "confidence": 90,
    "reason": "Brief reason for classification"
}}
"""
