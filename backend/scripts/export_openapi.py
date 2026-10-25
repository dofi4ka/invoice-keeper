"""Writes the OpenAPI specification to openapi.yaml (and openapi.json) in the repository root.

Usage: cd backend && uv run python -m scripts.export_openapi
"""

import json
from pathlib import Path

import yaml

from app.main import app

ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    spec = app.openapi()
    (ROOT / "openapi.json").write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (ROOT / "openapi.yaml").write_text(yaml.safe_dump(spec, allow_unicode=True, sort_keys=False), encoding="utf-8")
    print(f"Wrote {ROOT / 'openapi.yaml'} and openapi.json ({len(spec['paths'])} paths)")


if __name__ == "__main__":
    main()
