from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from .executor import FixtureExecutor
from .router import RuleRouter
from .types import RoutingStatus, SeedCase
from .verifier import FixtureVerifier


class PolicyPipeline:
    def __init__(
        self,
        router: RuleRouter | None = None,
        executor: FixtureExecutor | None = None,
        verifier: FixtureVerifier | None = None,
    ) -> None:
        self.router = router or RuleRouter()
        self.executor = executor or FixtureExecutor()
        self.verifier = verifier or FixtureVerifier()

    def run(self, case: SeedCase) -> dict[str, object]:
        routing = self.router.route(case.policy_input)
        execution = None
        if routing.status is RoutingStatus.ROUTED and routing.action is not None:
            execution = self.executor.execute(case, routing.action)
        verification = self.verifier.verify(case, routing, execution)
        usage = execution.usage if execution else _zero_usage()
        return {
            "trajectory_id": str(uuid4()),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "policy_version": self.router.version,
            "input": case.policy_input.to_dict(),
            "legal_action_space": routing.legal_action_space.to_dict(),
            "routing": routing.to_dict(),
            "execution": execution.to_dict() if execution else None,
            "verification": verification.to_dict(),
            "usage": usage,
        }


def _zero_usage() -> dict[str, int | float]:
    return {
        "input_tokens": 0,
        "output_tokens": 0,
        "wall_time_ms": 0,
        "normalized_cost": 0.0,
    }
