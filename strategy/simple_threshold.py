from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Tuple

from data.models import BatteryState, PriceInterval


@dataclass
class ThresholdStrategy:
    buy_threshold_cents: float = 15.0
    sell_threshold_cents: float = 60.0

    def decide(
        self,
        *,
        general: Optional[PriceInterval],
        feedin: Optional[PriceInterval],
        state: BatteryState,
        capacity_kwh: float,
        energy_limit_kwh: float,
    ) -> Tuple[float, float]:
        """
        Returns (charge_kwh, discharge_kwh) for this interval.
        """
        charge_kwh = 0.0
        discharge_kwh = 0.0

        if general is not None and general.per_kwh_cents <= self.buy_threshold_cents:
            charge_kwh = min(energy_limit_kwh, capacity_kwh - state.soc_kwh)

        if feedin is not None and feedin.per_kwh_cents >= self.sell_threshold_cents:
            discharge_kwh = min(energy_limit_kwh, state.soc_kwh)

        return charge_kwh, discharge_kwh
