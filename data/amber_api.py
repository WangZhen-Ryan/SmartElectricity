from __future__ import annotations

from typing import List

from data.models import PriceInterval
from data.parser import parse_amber_payload

try:
    import requests
except ImportError:
    requests = None


def fetch_amber_prices(
    site_id: str,
    token: str,
    *,
    previous: int = 48,
    next_: int = 48,
    resolution: int = 5,
    base_url: str = "https://api.amber.com.au/v1",
) -> List[PriceInterval]:
    """
    Fetch Amber prices. Requires `requests` to be installed.
    Returns raw intervals; you typically pair "general" and "feedIn" per time bucket.
    """
    if requests is None:
        raise RuntimeError("requests not installed; install or use load_prices_from_json.")
    url = f"{base_url}/sites/{site_id}/prices/current"
    headers = {"Authorization": f"Bearer {token}"}
    params = {"previous": previous, "next": next_, "resolution": resolution}
    resp = requests.get(url, headers=headers, params=params, timeout=30)
    resp.raise_for_status()
    payload = resp.json()
    return parse_amber_payload(payload)
