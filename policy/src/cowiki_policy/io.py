from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable

from .types import PolicyAction, PolicyInput, RoutingStatus, SeedCase, VerifierSpec


def load_seed_cases(path: Path, fixture_root: Path | None = None) -> list[SeedCase]:
    cases: list[SeedCase] = []
    seen: set[str] = set()
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
            policy_input = PolicyInput.from_dict(value["input"])
            case = SeedCase(
                category=value["category"],
                policy_input=policy_input,
                acceptable_actions=tuple(
                    PolicyAction.from_dict(action) for action in value["acceptable_actions"]
                ),
                expected_status=RoutingStatus(value["expected_status"]),
                verifier=VerifierSpec.from_dict(value.get("verifier", {})),
                fixture=value["fixture"],
            )
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
            raise ValueError(f"invalid seed at {path}:{line_number}: {error}") from error
        if policy_input.task_id in seen:
            raise ValueError(f"duplicate task_id: {policy_input.task_id}")
        seen.add(policy_input.task_id)
        if fixture_root and not (fixture_root / case.fixture).exists():
            raise ValueError(f"missing fixture for {policy_input.task_id}: {case.fixture}")
        cases.append(case)
    return cases


def write_jsonl(path: Path, values: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for value in values:
            handle.write(json.dumps(value, ensure_ascii=False, sort_keys=True))
            handle.write("\n")
