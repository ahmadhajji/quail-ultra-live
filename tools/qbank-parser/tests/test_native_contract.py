import json
from copy import deepcopy
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


def test_vendored_contract_rejects_unsafe_manifest_and_media_paths():
    pack = _read_json(FIXTURE_ROOT / "native-pack-minimal" / "quail-ultra-pack.json")
    question = _read_json(
        FIXTURE_ROOT / "native-pack-minimal" / "questions" / "peds.sample.s001.q01.json"
    )

    bad_pack = deepcopy(pack)
    bad_pack["questionIndex"][0]["path"] = "questions/%2e%2e/secret.json"
    assert validate_pack_document(bad_pack)

    bad_media_index = deepcopy(pack)
    bad_media_index["mediaIndex"][0]["path"] = "C:media/q01.svg"
    assert validate_pack_document(bad_media_index)

    bad_question = deepcopy(question)
    bad_question["media"][0]["path"] = "media/"
    assert validate_question_document(bad_question)
