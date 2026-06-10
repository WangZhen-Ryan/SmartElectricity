from __future__ import annotations

import json
from typing import Any, Dict


def save_payload(payload: Dict[str, Any], path: str) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=True)
