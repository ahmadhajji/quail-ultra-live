"""Validation helpers for the Quail Ultra native qbank contract."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012


CONTRACT_DIR = Path(__file__).resolve().parent.parent / "contracts" / "quail-ultra-qbank" / "v1"
PACK_SCHEMA_PATH = CONTRACT_DIR / "pack.schema.json"
QUESTION_SCHEMA_PATH = CONTRACT_DIR / "question.schema.json"
NATIVE_QBANK_MANIFEST = "quail-ultra-pack.json"


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def load_contract_schemas() -> tuple[dict[str, Any], dict[str, Any]]:
    """Load the vendored pack and question schemas."""
    return _read_json(PACK_SCHEMA_PATH), _read_json(QUESTION_SCHEMA_PATH)


def schema_checksum() -> str:
    """Return a checksum over the vendored schema files for drift detection."""
    digest = hashlib.sha256()
    for path in (PACK_SCHEMA_PATH, QUESTION_SCHEMA_PATH):
        digest.update(path.name.encode("utf-8"))
        digest.update(path.read_bytes())
    return digest.hexdigest()


def _registry(pack_schema: dict[str, Any], question_schema: dict[str, Any]) -> Registry:
    return Registry().with_resources(
        [
            (
                str(question_schema["$id"]),
                Resource.from_contents(question_schema, default_specification=DRAFT202012),
            ),
            (
                str(pack_schema["$id"]),
                Resource.from_contents(pack_schema, default_specification=DRAFT202012),
            ),
        ]
    )


def _format_errors(prefix: str, errors) -> list[str]:
    return [
        f"{prefix}{error.json_path.removeprefix('$')}: {error.message}"
        for error in sorted(errors, key=lambda item: item.path)
    ]


def validate_pack_document(document: dict[str, Any]) -> list[str]:
    pack_schema, question_schema = load_contract_schemas()
    validator = Draft202012Validator(pack_schema, registry=_registry(pack_schema, question_schema))
    return _format_errors(NATIVE_QBANK_MANIFEST, validator.iter_errors(document))


def validate_question_document(document: dict[str, Any], *, label: str = "question") -> list[str]:
    pack_schema, question_schema = load_contract_schemas()
    validator = Draft202012Validator(question_schema, registry=_registry(pack_schema, question_schema))
    return _format_errors(label, validator.iter_errors(document))


def validate_native_pack_directory(pack_dir: str | Path) -> list[str]:
    """Validate a native pack folder against schema plus file/path invariants."""
    root = Path(pack_dir)
    errors: list[str] = []
    manifest_path = root / NATIVE_QBANK_MANIFEST
    if not manifest_path.exists():
        return [f"Missing {NATIVE_QBANK_MANIFEST}."]

    try:
        manifest = _read_json(manifest_path)
    except Exception as exc:
        return [f"Unable to parse {NATIVE_QBANK_MANIFEST}: {exc}"]

    errors.extend(validate_pack_document(manifest))
    if manifest.get("validation", {}).get("status") == "failed":
        errors.append(f"{NATIVE_QBANK_MANIFEST}: validation.status is failed.")

    media_by_id: dict[str, dict[str, Any]] = {}
    for media in manifest.get("mediaIndex", []):
        media_id = str(media.get("id", ""))
        media_by_id[media_id] = media
        media_path = root / str(media.get("path", ""))
        if not media_path.resolve().is_relative_to(root.resolve()):
            errors.append(f"mediaIndex {media_id!r} has unsafe path.")
        elif not media_path.exists():
            errors.append(f"mediaIndex {media_id!r} points to missing file {media.get('path')!r}.")

    seen_question_ids: set[str] = set()
    for entry in manifest.get("questionIndex", []):
        qid = str(entry.get("id", ""))
        if qid in seen_question_ids:
            errors.append(f"Duplicate question id {qid!r}.")
        seen_question_ids.add(qid)
        question_path = root / str(entry.get("path", ""))
        if not question_path.resolve().is_relative_to(root.resolve()):
            errors.append(f"Question {qid!r} has unsafe path.")
            continue
        if not question_path.exists():
            errors.append(f"Question {qid!r} points to missing file {entry.get('path')!r}.")
            continue
        try:
            question = _read_json(question_path)
        except Exception as exc:
            errors.append(f"Unable to parse question {qid!r}: {exc}")
            continue
        errors.extend(validate_question_document(question, label=str(entry.get("path", "question"))))
        if question.get("id") != qid:
            errors.append(f"Question file {entry.get('path')!r} has id {question.get('id')!r}, expected {qid!r}.")
        choice_ids = {str(choice.get("id", "")) for choice in question.get("choices", [])}
        correct = question.get("answerKey", {}).get("correctChoiceId")
        if correct not in choice_ids:
            errors.append(f"Question {qid!r} correctChoiceId {correct!r} is not present in choices.")
        for media in question.get("media", []):
            media_id = str(media.get("id", ""))
            if media_id not in media_by_id:
                errors.append(f"Question {qid!r} media {media_id!r} is missing from manifest mediaIndex.")

    return errors
