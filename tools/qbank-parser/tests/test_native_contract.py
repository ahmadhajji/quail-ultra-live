import json
from pathlib import Path

from export.native_contract import validate_native_pack_directory, validate_pack_document, validate_question_document


FIXTURE_ROOT = Path(__file__).resolve().parent.parent / "contracts" / "quail-ultra-qbank" / "v1" / "fixtures"


def _read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_vendored_native_fixture_validates():
    errors = validate_native_pack_directory(FIXTURE_ROOT / "native-pack-minimal")

    assert errors == []


def test_vendored_invalid_fixture_is_rejected():
    errors = validate_native_pack_directory(FIXTURE_ROOT / "native-pack-invalid")

    joined = "\n".join(errors)
    assert "answerKey" in joined
    assert "validation.status is failed" in joined


def test_pack_and_question_documents_validate_individually():
    pack = _read_json(FIXTURE_ROOT / "native-pack-minimal" / "quail-ultra-pack.json")
    question = _read_json(
        FIXTURE_ROOT / "native-pack-minimal" / "questions" / "peds.sample.s001.q01.json"
    )

    assert validate_pack_document(pack) == []
    assert validate_question_document(question) == []
