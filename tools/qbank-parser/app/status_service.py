"""Status/check service for CLI and API reachability."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable


def _log(console: Any, message: str) -> None:
    if console:
        console.print(message)
    else:
        print(message)


@dataclass
class StatusServiceDeps:
    """Dependencies for status output."""

    console: Any
    print_banner: Callable[[], None]
    print_config_status: Callable[[], None]
    test_openai_connection: Callable[..., bool]
    openai_api_key: str
    openai_extraction_model: str
    output_dir: Path
    table_cls: type | None = None


class StatusService:
    """Render status/progress and test API connectivity."""

    def __init__(self, deps: StatusServiceDeps):
        self.deps = deps

    def run(self) -> None:
        self.deps.print_banner()
        console = self.deps.console

        if console:
            self.deps.print_config_status()

        extracted_json = self.deps.output_dir / "extracted_questions.json"
        reviewed_json = self.deps.output_dir / "reviewed_questions.json"
        usmle_json = self.deps.output_dir / "usmle_formatted_questions.json"

        if console and self.deps.table_cls:
            table = self.deps.table_cls(title="Progress Status")
            table.add_column("Stage", style="cyan")
            table.add_column("Status", style="green")
            table.add_column("Details")

            if extracted_json.exists():
                with open(extracted_json) as f:
                    data = json.load(f)
                counts = data.get("question_counts", {}) if isinstance(data.get("question_counts", {}), dict) else {}
                table.add_row(
                    "Extraction",
                    "✅ Complete",
                    (
                        f"{counts.get('accepted', 0)} accepted / "
                        f"{counts.get('needs_review', 0)} review / "
                        f"{counts.get('rejected', 0)} rejected / "
                        f"{counts.get('error', 0)} error from "
                        f"{data.get('total_slides', 0)} slides"
                    ),
                )
            else:
                table.add_row("Extraction", "⏳ Pending", "Run: python main.py <file.pptx>")

            if reviewed_json.exists():
                with open(reviewed_json) as f:
                    data = json.load(f)
                approved = sum(
                    1 for q in data.get("questions", []) if q.get("review_status") in {"approved", "edited", "rekeyed"}
                )
                pending = sum(1 for q in data.get("questions", []) if q.get("review_status") == "pending")
                table.add_row("Review", "✅ Complete", f"{approved} approved, {pending} pending")
            else:
                table.add_row("Review", "⏳ Pending", "Run: python main.py --review")

            if usmle_json.exists():
                with open(usmle_json) as f:
                    data = json.load(f)
                table.add_row(
                    "USMLE Formatting",
                    "✅ Complete",
                    f"{data.get('total_questions', 0)} questions formatted",
                )
            else:
                table.add_row("USMLE Formatting", "⏳ Pending", "Run: python main.py --format-usmle")

            console.print(table)

        if console:
            console.print("\n[bold]Testing API Connections...[/bold]")

        if self.deps.openai_api_key and self.deps.openai_api_key != "your_openai_api_key_here":
            if self.deps.test_openai_connection(
                self.deps.openai_api_key,
                model_name=self.deps.openai_extraction_model,
            ):
                _log(
                    console,
                    f"  ✅ OpenAI Extraction API: Connected ({self.deps.openai_extraction_model})",
                )
            else:
                _log(
                    console,
                    f"  ❌ OpenAI Extraction API: Connection failed ({self.deps.openai_extraction_model})",
                )
        else:
            _log(console, "  ⚪ OpenAI Extraction API: Not configured")
