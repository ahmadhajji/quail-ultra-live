from pathlib import Path

from parsers.google_api import (
    disconnect_google_oauth,
    resolve_google_credentials_path,
    resolve_google_token_path,
)


def test_resolve_google_credentials_path_prefers_explicit_env(monkeypatch, tmp_path):
    override = (tmp_path / "override.json").resolve()
    base_dir = (tmp_path / "runtime").resolve()

    monkeypatch.setenv("GOOGLE_CREDENTIALS_PATH", str(override))
    monkeypatch.setenv("QBANK_BASE_DIR", str(base_dir))

    assert resolve_google_credentials_path() == override


def test_resolve_google_credentials_path_falls_back_to_base_dir(monkeypatch, tmp_path):
    base_dir = (tmp_path / "runtime").resolve()

    monkeypatch.delenv("GOOGLE_CREDENTIALS_PATH", raising=False)
    monkeypatch.setenv("QBANK_BASE_DIR", str(base_dir))

    assert resolve_google_credentials_path() == (base_dir / "credentials.json").resolve()


def test_disconnect_google_oauth_removes_token(monkeypatch, tmp_path):
    token_path = (tmp_path / "token.json").resolve()
    token_path.write_text('{"token": "abc"}', encoding="utf-8")

    monkeypatch.setenv("GOOGLE_TOKEN_PATH", str(token_path))

    assert resolve_google_token_path() == token_path
    assert disconnect_google_oauth() is True
    assert not token_path.exists()
