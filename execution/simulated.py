from __future__ import annotations

from core.events import FillEvent, OrderEvent


class SimulatedExecution:
    def execute_order(self, order: OrderEvent) -> FillEvent:
        return FillEvent(
            timestamp=order.timestamp,
            side=order.side,
            quantity_kwh=order.quantity_kwh,
            price_cents=order.price_cents,
        )
