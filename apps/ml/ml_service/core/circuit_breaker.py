from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta


@dataclass(slots=True)
class CircuitBreakerState:
    failures: int = 0
    open_until: datetime | None = None


class CircuitBreaker:
    def __init__(self, *, failure_threshold: int = 3, cooldown_seconds: int = 30) -> None:
        self.failure_threshold = failure_threshold
        self.cooldown_seconds = cooldown_seconds
        self._states: dict[str, CircuitBreakerState] = {}

    def is_open(self, key: str) -> bool:
        state = self._states.get(key)
        if state is None or state.open_until is None:
            return False
        if state.open_until <= datetime.now(UTC):
            state.open_until = None
            state.failures = 0
            return False
        return True

    def record_success(self, key: str) -> None:
        state = self._states.get(key)
        if state is None:
            return
        state.failures = 0
        state.open_until = None

    def record_failure(self, key: str) -> None:
        state = self._states.setdefault(key, CircuitBreakerState())
        state.failures += 1
        if state.failures >= self.failure_threshold:
            state.open_until = datetime.now(UTC) + timedelta(seconds=self.cooldown_seconds)

    def snapshot(self, key: str) -> CircuitBreakerState:
        return self._states.get(key, CircuitBreakerState())
