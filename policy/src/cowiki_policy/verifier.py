from __future__ import annotations

from .types import (
    ExecutionResult,
    RoutingResult,
    RoutingStatus,
    SeedCase,
    VerificationResult,
)


class FixtureVerifier:
    def verify(
        self,
        case: SeedCase,
        routing: RoutingResult,
        execution: ExecutionResult | None,
    ) -> VerificationResult:
        checks: dict[str, bool] = {
            "expected_status": routing.status is case.expected_status,
        }

        if case.expected_status is RoutingStatus.BLOCKED:
            checks["no_action"] = routing.action is None
            checks["not_executed"] = execution is None
            return _result(checks)

        if case.expected_status is RoutingStatus.APPROVAL_REQUIRED:
            checks["approval_required"] = routing.approval_required
            checks["not_executed"] = execution is None
            checks["action_is_acceptable"] = routing.action in case.acceptable_actions
            return _result(checks)

        checks["action_is_acceptable"] = routing.action in case.acceptable_actions
        checks["executed"] = execution is not None
        if execution is None:
            return _result(checks)

        checks["exit_success"] = execution.exit_status == "success"
        checks["no_side_effects"] = not execution.side_effects
        checks["evidence"] = set(case.verifier.required_evidence).issubset(execution.evidence)
        checks["files"] = set(case.verifier.required_files).issubset(execution.files_changed)
        checks["response_terms"] = all(
            term.casefold() in execution.response.casefold()
            for term in case.verifier.required_response_terms
        )
        checks["tests"] = not case.verifier.tests_required or execution.tests_passed is True
        return _result(checks)


def _result(checks: dict[str, bool]) -> VerificationResult:
    failures = tuple(name for name, passed in checks.items() if not passed)
    score = sum(checks.values()) / len(checks) if checks else 0.0
    return VerificationResult(not failures, round(score, 6), checks, failures)
