from __future__ import annotations

import importlib
import sys


def _reload_config():
    sys.modules.pop("config", None)
    import config  # noqa: F401

    return importlib.reload(sys.modules["config"])


def test_dotenv_overrides_inherited_openai_key(monkeypatch, tmp_path):
    monkeypatch.setenv("QBANK_BASE_DIR", str(tmp_path))
    monkeypatch.setenv("OPENAI_API_KEY", "sk-or-v1-inherited-wrong-provider-key")
    (tmp_path / ".env").write_text("OPENAI_API_KEY=sk-proj-local-correct-key\n", encoding="utf-8")

    config = _reload_config()

    assert config.OPENAI_API_KEY == "sk-proj-local-correct-key"
    assert config._classify_openai_key(config.OPENAI_API_KEY) == "openai"


def test_config_does_not_expose_gemini_inference_key(monkeypatch, tmp_path):
    monkeypatch.setenv("QBANK_BASE_DIR", str(tmp_path))
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setenv("GOOGLE_API_KEY", "AIza-not-a-gemini-fallback")
    (tmp_path / ".env").write_text("OPENAI_API_KEY=sk-proj-local-correct-key\n", encoding="utf-8")

    config = _reload_config()

    assert not hasattr(config, "GEMINI_API_KEY")


def test_validate_config_flags_wrong_provider_openai_key(monkeypatch, tmp_path):
    monkeypatch.setenv("QBANK_BASE_DIR", str(tmp_path))
    monkeypatch.setenv("OPENAI_API_KEY", "sk-or-v1-looks-like-openrouter")
    (tmp_path / ".env").write_text("", encoding="utf-8")

    config = _reload_config()

    assert config._classify_openai_key("sk-or-v1-looks-like-openrouter") == "wrong_provider"


def test_env_candidate_paths_include_source_then_base(tmp_path):
    source_dir = tmp_path / "source"
    base_dir = tmp_path / "runtime"
    source_dir.mkdir()
    base_dir.mkdir()
    (source_dir / ".env").write_text("OPENAI_API_KEY=source\n", encoding="utf-8")
    (base_dir / ".env").write_text("OPENAI_API_KEY=base\n", encoding="utf-8")

    config = _reload_config()

    assert config._env_candidate_paths(base_dir, source_dir) == [
        source_dir / ".env",
        base_dir / ".env",
    ]
