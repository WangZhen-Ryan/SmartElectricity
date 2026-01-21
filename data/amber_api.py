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


def fetch_amber_prices_range(
    site_id: str,
    token: str,
    *,
    start_time: str,
    end_time: str,
    resolution: int = 30,
    base_url: str = "https://api.amber.com.au/v1",
) -> List[PriceInterval]:
    """
    Fetch Amber prices in a time window.
    start_time/end_time are ISO 8601 strings, e.g. "2024-01-01T00:00:00+10:00".
    """
    if requests is None:
        raise RuntimeError("requests not installed; install or use load_prices_from_json.")
    url = f"{base_url}/sites/{site_id}/prices"
    headers = {"Authorization": f"Bearer {token}"}
    params = {"startDate": start_time, "endDate": end_time, "resolution": resolution}
    payload = fetch_amber_payload_range(
        site_id,
        token,
        start_time=start_time,
        end_time=end_time,
        resolution=resolution,
        base_url=base_url,
    )
    return parse_amber_payload(payload)


def fetch_amber_payload_range(
    site_id: str,
    token: str,
    *,
    start_time: str,
    end_time: str,
    resolution: int = 30,
    base_url: str = "https://api.amber.com.au/v1",
) -> dict:
    """
    Fetch raw Amber prices payload for a time window.
    start_time/end_time are ISO 8601 strings.
    """
    if requests is None:
        raise RuntimeError("requests not installed; install or use load_prices_from_json.")
    url = f"{base_url}/sites/{site_id}/prices"
    headers = {"Authorization": f"Bearer {token}"}
    params = {"startDate": start_time, "endDate": end_time, "resolution": resolution}
    resp = requests.get(url, headers=headers, params=params, timeout=30)
    resp.raise_for_status()
    return resp.json()
