from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

from .io import load_seed_cases, write_jsonl
from .pipeline import PolicyPipeline


POLICY_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SEEDS = POLICY_ROOT / "datasets" / "seeds.v0.1.jsonl"
DEFAULT_FIXTURES = POLICY_ROOT / "fixtures"
DEFAULT_OUTPUT = POLICY_ROOT / "runs" / "rule-v0.1.jsonl"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run CoWiki Policy v0.1 fixtures")
    parser.add_argument("--seeds", type=Path, default=DEFAULT_SEEDS)
    parser.add_argument("--fixtures", type=Path, default=DEFAULT_FIXTURES)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--task-id", action="append", default=[])
    parser.add_argument("--print-trajectories", action="store_true")
    args = parser.parse_args(argv)

    try:
        cases = load_seed_cases(args.seeds, args.fixtures)
    except (OSError, ValueError) as error:
        parser.error(str(error))
    if args.task_id:
        wanted = set(args.task_id)
        cases = [case for case in cases if case.policy_input.task_id in wanted]
        missing = wanted - {case.policy_input.task_id for case in cases}
        if missing:
            parser.error(f"unknown task ids: {sorted(missing)}")

    pipeline = PolicyPipeline()
    trajectories = [pipeline.run(case) for case in cases]
    write_jsonl(args.output, trajectories)
    statuses = Counter(value["routing"]["status"] for value in trajectories)  # type: ignore[index]
    passed = sum(bool(value["verification"]["passed"]) for value in trajectories)  # type: ignore[index]
    summary = {
        "tasks": len(trajectories),
        "passed": passed,
        "failed": len(trajectories) - passed,
        "statuses": dict(sorted(statuses.items())),
        "output": str(args.output),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if args.print_trajectories:
        for value in trajectories:
            print(json.dumps(value, ensure_ascii=False, indent=2))
    return 0 if passed == len(trajectories) else 1


if __name__ == "__main__":
    sys.exit(main())
