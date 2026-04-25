"""
QBank Parser Configuration

Loads environment variables and provides configuration constants.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

def _resolve_base_dir() -> Path:
    """Resolve writable base directory for project data/config."""
    override = os.getenv("QBANK_BASE_DIR", "").strip()
    if override:
        return Path(override).expanduser().resolve()

    return Path(__file__).parent.resolve()


# Base paths
BASE_DIR = _resolve_base_dir()
DATA_DIR = BASE_DIR / "data"
OUTPUT_DIR = BASE_DIR / "output"
ARCHIVES_DIR = BASE_DIR / "archives"

# Ensure directories exist
DATA_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
ARCHIVES_DIR.mkdir(parents=True, exist_ok=True)

def _env_candidate_paths(base_dir: Path, source_dir: Path) -> list[Path]:
    """Return .env paths in load order: repo root first, runtime base second."""
    source_env_path = source_dir / ".env"
    base_env_path = base_dir / ".env"
    paths: list[Path] = []
    if source_env_path.exists():
        paths.append(source_env_path)
    if base_env_path != source_env_path and base_env_path.exists():
        paths.append(base_env_path)
    return paths


# Load environment variables.
# In source mode, a runtime QBANK_BASE_DIR may point at an isolated output
# directory with no .env; fall back to the repo-root .env in that case.
SOURCE_ENV_PATH = Path(__file__).parent.resolve() / ".env"
BASE_ENV_PATH = BASE_DIR / ".env"
for env_path in _env_candidate_paths(BASE_DIR, Path(__file__).parent.resolve()):
    load_dotenv(env_path, override=True)

# API Keys
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()


def _classify_openai_key(api_key: str) -> str:
    """Classify OpenAI API key shape for clearer status/errors."""
    cleaned = (api_key or "").strip()
    if not cleaned or cleaned == "your_openai_api_key_here":
        return "missing"
    if cleaned.startswith("sk-or-v1-"):
        return "wrong_provider"
    if cleaned.startswith("sk-proj-") or cleaned.startswith("sk-"):
        return "openai"
    return "unknown"

GOOGLE_SLIDES_ID = os.getenv("GOOGLE_SLIDES_ID", "")
GOOGLE_CREDENTIALS_PATH = os.getenv("GOOGLE_CREDENTIALS_PATH", str(BASE_DIR / "credentials.json"))

# OpenAI extraction model (OpenAI-only extraction path)
OPENAI_EXTRACTION_MODEL = os.getenv("OPENAI_EXTRACTION_MODEL", "gpt-4.1-mini").strip() or "gpt-4.1-mini"


def _as_bool(value: str, default: bool = False) -> bool:
    cleaned = (value or "").strip().lower()
    if not cleaned:
        return default
    return cleaned in {"1", "true", "yes", "y", "on"}


def _as_int(value: str, default: int) -> int:
    try:
        parsed = int((value or "").strip())
        return parsed if parsed > 0 else default
    except (TypeError, ValueError):
        return default


# Formatter provider defaults
FORMATTER_PROVIDER = os.getenv("FORMATTER_PROVIDER", "openai").strip().lower() or "openai"
OPENAI_FORMATTER_MODEL = os.getenv("OPENAI_FORMATTER_MODEL", "gpt-5.4").strip() or "gpt-5.4"
OPENAI_REASONING_EFFORT = os.getenv("OPENAI_REASONING_EFFORT", "high").strip().lower() or "high"
OPENAI_WEB_SEARCH = _as_bool(os.getenv("OPENAI_WEB_SEARCH", "true"), default=True)
OPENAI_TARGET_RPM = _as_int(os.getenv("OPENAI_TARGET_RPM", "450"), default=450)
OPENAI_MAX_INFLIGHT = _as_int(os.getenv("OPENAI_MAX_INFLIGHT", "120"), default=120)

# Processing settings
MAX_RETRIES = 3
RETRY_DELAY = 2  # seconds
CONFIDENCE_THRESHOLD = 70  # Below this, flag for review

# Export settings
CSV_FILENAME = "extracted_questions.csv"
JSON_FILENAME = "extracted_questions.json"
USMLE_OUTPUT_FILENAME = "usmle_formatted_questions.json"


def validate_config():
    """Validate that required configuration is present."""
    errors = []

    key_kind = _classify_openai_key(OPENAI_API_KEY)
    if key_kind == "missing":
        errors.append("OPENAI_API_KEY is not set. Please add it to your .env file.")
    elif key_kind == "wrong_provider":
        errors.append(
            "OPENAI_API_KEY has prefix 'sk-or-v1-', which is not an OpenAI key. "
            "Your shell environment is likely overriding the repo .env."
        )
    
    return errors


def print_config_status():
    """Print the current configuration status."""
    from rich.console import Console
    from rich.table import Table
    
    console = Console()
    table = Table(title="Configuration Status")
    table.add_column("Setting", style="cyan")
    table.add_column("Status", style="green")
    
    key_kind = _classify_openai_key(OPENAI_API_KEY)
    if key_kind == "openai":
        table.add_row("OpenAI API Key", "✅ Set")
    elif key_kind == "wrong_provider":
        table.add_row("OpenAI API Key", "⚠️ Wrong provider key in env")
    elif key_kind == "unknown":
        table.add_row("OpenAI API Key", "⚠️ Unexpected key format")
    else:
        table.add_row("OpenAI API Key", "⚪ Not set")

    table.add_row("Formatter Provider", FORMATTER_PROVIDER)
    table.add_row("Extraction Model", OPENAI_EXTRACTION_MODEL)
    table.add_row("Formatter Model", OPENAI_FORMATTER_MODEL)
    table.add_row("Web Search", "✅ Enabled" if OPENAI_WEB_SEARCH else "⚪ Disabled")
    
    # Google Slides ID
    if GOOGLE_SLIDES_ID:
        table.add_row("Google Slides ID", "✅ Set")
    else:
        table.add_row("Google Slides ID", "⚪ Not set (optional)")
    
    # Google Credentials
    creds_path = Path(GOOGLE_CREDENTIALS_PATH)
    if creds_path.exists():
        table.add_row("Google OAuth Credentials", "✅ Found")
    else:
        table.add_row("Google OAuth Credentials", "⚪ Not found (optional)")
    
    console.print(table)
