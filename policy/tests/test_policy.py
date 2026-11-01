from __future__ import annotations

import json
import tempfile
import unittest
from collections import Counter
from pathlib import Path

from cowiki_policy.io import load_seed_cases, write_jsonl
from cowiki_policy.masking import build_legal_action_space, validate_action
from cowiki_policy.pipeline import PolicyPipeline
from cowiki_policy.router import RuleRouter
from cowiki_policy.types import (
    Executor,
    Intent,
    Mode,
    PolicyAction,
    RiskLevel,
    RoutingStatus,
    Tool,
)


POLICY_ROOT = Path(__file__).resolve().parents[1]
SEEDS = POLICY_ROOT / "datasets" / "seeds.v0.1.jsonl"
FIXTURES = POLICY_ROOT / "fixtures"
SCHEMAS = POLICY_ROOT / "schemas"


class PolicyV01Test(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.cases = load_seed_cases(SEEDS, FIXTURES)
        cls.by_id = {case.policy_input.task_id: case for case in cls.cases}

    def test_dataset_has_twenty_unique_seed_cases(self) -> None:
        self.assertEqual(len(self.cases), 20)
        self.assertEqual(len(self.by_id), 20)
        self.assertEqual(
            Counter(case.category for case in self.cases),
            {
                "local_simple": 2,
                "knowledge": 3,
                "code_understanding": 3,
                "code_edit": 3,
                "long_document": 2,
                "mixed": 3,
                "risk_ood": 4,
            },
        )

    def test_all_seed_cases_pass_the_rule_baseline_contract(self) -> None:
        pipeline = PolicyPipeline()
        failures = []
        for case in self.cases:
            trajectory = pipeline.run(case)
            if not trajectory["verification"]["passed"]:  # type: ignore[index]
                failures.append(
                    (case.policy_input.task_id, trajectory["verification"]["failures"])  # type: ignore[index]
                )
        self.assertEqual(failures, [])

    def test_representative_mixed_task_prefetches_then_uses_background_codex(self) -> None:
        result = RuleRouter().route(self.by_id["mixed_001"].policy_input)
        self.assertEqual(result.status, RoutingStatus.ROUTED)
        self.assertEqual(
            result.action,
            PolicyAction(
                intent=Intent.MIXED_RETRIEVAL_EDIT,
                executor=Executor.CODEX,
                mode=Mode.BACKGROUND,
                initial_tool=Tool.SEARCH_PAGES,
                risk_level=RiskLevel.MEDIUM,
            ),
        )

    def test_private_sensitive_task_cannot_route_to_cloud_executors(self) -> None:
        case = self.by_id["risk_002"]
        space = build_legal_action_space(case.policy_input, Intent.RISK_OPERATION)
        self.assertEqual(space.executors, ())
        result = RuleRouter().route(case.policy_input)
        self.assertEqual(result.status, RoutingStatus.BLOCKED)
        self.assertIsNone(result.action)

    def test_unregistered_tool_is_blocked_before_execution(self) -> None:
        result = RuleRouter().route(self.by_id["risk_004"].policy_input)
        self.assertEqual(result.status, RoutingStatus.BLOCKED)
        self.assertTrue(any("delete_space" in reason for reason in result.reasons))

    def test_live_write_requires_high_risk(self) -> None:
        case = self.by_id["code_edit_001"]
        space = build_legal_action_space(case.policy_input, Intent.CODE_EDIT)
        invalid = PolicyAction(
            intent=Intent.CODE_EDIT,
            executor=Executor.CODEX,
            mode=Mode.LIVE,
            initial_tool=Tool.NONE,
            risk_level=RiskLevel.MEDIUM,
        )
        self.assertIn("live writes must be classified as high risk", validate_action(invalid, space))

    def test_high_risk_action_stops_for_approval_without_execution(self) -> None:
        trajectory = PolicyPipeline().run(self.by_id["risk_001"])
        self.assertEqual(trajectory["routing"]["status"], "approval_required")  # type: ignore[index]
        self.assertTrue(trajectory["routing"]["approval_required"])  # type: ignore[index]
        self.assertIsNone(trajectory["execution"])

    def test_trajectory_jsonl_round_trip(self) -> None:
        values = [PolicyPipeline().run(self.by_id["mixed_001"])]
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "trajectory.jsonl"
            write_jsonl(output, values)
            parsed = [json.loads(line) for line in output.read_text(encoding="utf-8").splitlines()]
        self.assertEqual(parsed[0]["input"]["task_id"], "mixed_001")
        self.assertTrue(parsed[0]["verification"]["passed"])

    def test_schema_documents_are_valid_json_with_expected_required_fields(self) -> None:
        expected = {
            "policy-input.schema.json": {"task_id", "task", "agents", "registered_tools"},
            "policy-action.schema.json": {"intent", "executor", "mode", "initial_tool"},
            "trajectory.schema.json": {"trajectory_id", "input", "routing", "verification"},
        }
        for filename, required in expected.items():
            value = json.loads((SCHEMAS / filename).read_text(encoding="utf-8"))
            self.assertEqual(value["$schema"], "https://json-schema.org/draft/2020-12/schema")
            self.assertTrue(required.issubset(value["required"]))


if __name__ == "__main__":
    unittest.main()
