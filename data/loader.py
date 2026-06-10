from __future__ import annotations

import json
from typing import List

from data.models import PriceInterval
from data.parser import parse_amber_payload


def load_prices_from_json(path: str) -> List[PriceInterval]:
    with open(path, "r", encoding="utf-8") as f:
        payload = json.load(f)
    return parse_amber_payload(payload)
