from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional

from core.events import MarketEvent, SignalEvent
from data.models import BatteryState


class Strategy(ABC):
    @abstractmethod
    def generate_signal(
        self,
        market: MarketEvent,
        state: BatteryState,
    ) -> Optional[SignalEvent]:
        raise NotImplementedError
