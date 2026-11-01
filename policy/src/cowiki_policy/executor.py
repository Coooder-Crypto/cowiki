from __future__ import annotations

from .types import ExecutionResult, PolicyAction, SeedCase


class FixtureExecutor:
    """Deterministic, side-effect-free executor for the v0.1 routing loop.

    It does not impersonate Codex or Claude. It turns an acceptable fixture
    route into the artifacts described by the seed's verifier so the routing,
    verification, and trajectory contracts can be exercised before real agent
    adapters are connected.
    """

    def execute(self, case: SeedCase, action: PolicyAction) -> ExecutionResult:
        accepted = action in case.acceptable_actions
        if accepted:
            response_terms = " ".join(case.verifier.required_response_terms)
            response = f"Fixture execution completed. {response_terms}".strip()
            evidence = case.verifier.required_evidence
            files_changed = case.verifier.required_files
            tests_passed = True if case.verifier.tests_required else None
            exit_status = "success"
        else:
            response = "Fixture route did not satisfy the task contract."
            evidence = ()
            files_changed = ()
            tests_passed = False if case.verifier.tests_required else None
            exit_status = "failure"

        input_tokens = max(12, len(case.policy_input.task) // 2)
        output_tokens = max(8, len(response) // 3)
        executor_multiplier = {
            "local": 0.05,
            "codex": 1.0,
            "claude": 1.2,
        }[action.executor.value]
        mode_multiplier = 1.15 if action.mode.value == "background" else 1.0
        normalized_cost = round((input_tokens + output_tokens) * executor_multiplier / 1000, 6)
        wall_time_ms = int((100 + input_tokens * 3) * executor_multiplier * mode_multiplier)
        return ExecutionResult(
            exit_status=exit_status,
            response=response,
            evidence=evidence,
            files_changed=files_changed,
            tests_passed=tests_passed,
            side_effects=(),
            usage={
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "wall_time_ms": wall_time_ms,
                "normalized_cost": normalized_cost,
            },
        )
