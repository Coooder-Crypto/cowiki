"""Dependency-free data preparation and evaluation command line."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from .evaluate import evaluate
from .experiment import Prediction, canonical, describe, file_hash, load_cases
from .io import write_jsonl
from .prompts import PROMPT_VERSION, SYSTEM_PROMPT, completion, messages
from .router import RuleRouter


def prepare(path: Path, output: Path, smoke: bool = False) -> dict:
    cases = load_cases(path)
    if smoke:
        # This deliberately fits known development data; it is not a holdout experiment.
        selected = [c for c in cases if c.split == "dev"]
        if not selected:
            raise ValueError("smoke preparation requires dev samples")
        categories = sorted({c.category for c in selected})
        buckets = [[c for c in selected if c.category == category] for category in categories]
        selected = [bucket[index] for index in range(max(map(len, buckets)))
                    for bucket in buckets if index < len(bucket)]
        groups = {"train": selected}
    else:
        groups = {split: [c for c in cases if c.split == split] for split in ("train", "validation")}
        if not all(groups.values()):
            raise ValueError("formal preparation requires nonempty train and validation splits")
        if any(c.review_status != "approved" for group in groups.values() for c in group):
            raise ValueError("formal train/validation samples require human-approved labels")
    output.mkdir(parents=True, exist_ok=False)
    manifest = {"source_sha256": file_hash(path), "prompt_version": PROMPT_VERSION,
                "prompt": SYSTEM_PROMPT, "purpose": "smoke_only" if smoke else "formal",
                "files": {}, "members": {}}
    for split, group in groups.items():
        target = output / f"{split}.jsonl"
        write_jsonl(target, ({"prompt": messages(c.policy_input), "completion": completion(c.target)} for c in group))
        manifest["files"][split] = {"name": target.name, "sha256": file_hash(target), "samples": len(group)}
        manifest["members"][split] = [{"sample_id": c.sample_id, "family_id": c.family_id} for c in group]
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="CoWiki Policy offline SFT lab")
    commands = parser.add_subparsers(dest="command", required=True)
    validate = commands.add_parser("validate")
    validate.add_argument("dataset", type=Path)
    export = commands.add_parser("prepare")
    export.add_argument("dataset", type=Path)
    export.add_argument("--output", type=Path, required=True)
    export.add_argument("--smoke", action="store_true", help="export dev data for pipeline testing only")
    ev = commands.add_parser("evaluate")
    ev.add_argument("dataset", type=Path)
    ev.add_argument("--split", choices=["dev", "validation", "test"], default="dev")
    ev.add_argument("--backend", choices=["rule", "model"], default="rule")
    ev.add_argument("--model")
    ev.add_argument("--revision")
    ev.add_argument("--adapter", type=Path)
    ev.add_argument("--max-input-tokens", type=int, default=2048)
    ev.add_argument("--max-new-tokens", type=int, default=256)
    ev.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "validate":
            result = describe(load_cases(args.dataset))
            result["sha256"] = file_hash(args.dataset)
        elif args.command == "prepare":
            manifest = prepare(args.dataset, args.output, args.smoke)
            result = {"purpose": manifest["purpose"], "files": manifest["files"],
                      "manifest": str(args.output / "manifest.json")}
        else:
            cases = [c for c in load_cases(args.dataset) if c.split == args.split]
            if not cases:
                raise ValueError(f"no samples in split {args.split}")
            if args.split != "dev" and any(c.review_status != "approved" for c in cases):
                raise ValueError("held-out evaluation requires reviewed labels")
            if args.output.exists():
                raise ValueError("output directory already exists; choose a new run name")
            metadata = {"backend": args.backend}
            if args.backend == "rule":
                if args.adapter or args.model or args.revision:
                    raise ValueError("model options require --backend model")
                router = RuleRouter()
                def predict(value):
                    routed = router.route(value)
                    return canonical(Prediction(routed.status, routed.action).to_dict())
                metadata["version"] = router.version
            else:
                if not args.model or not args.revision:
                    raise ValueError("model evaluation requires --model and --revision")
                from .model_router import ModelRouter
                router = ModelRouter(args.model, args.revision, args.adapter,
                                     args.max_input_tokens, args.max_new_tokens)
                # Warmup uses a public synthetic input, not a held-out evaluation sample.
                from .types import PolicyInput
                router.predict(PolicyInput.from_dict({"task_id": "warmup", "task": "将给定标题转成小写。",
                    "agents": {"local": "available", "codex": "available", "claude": "available"},
                    "registered_tools": [], "allowed_modes": ["live"], "privacy": "public",
                    "budget": "normal", "repo_state": "absent"}))
                predict = router.predict
                metadata.update(router.metadata)
            summary, rows = evaluate(cases, predict)
            result = {**summary, "metadata": metadata, "split": args.split,
                      "source_sha256": file_hash(args.dataset), "prompt_version": PROMPT_VERSION,
                      "label_review": describe(cases)["review_status"]}
            args.output.mkdir(parents=True)
            write_jsonl(args.output / "predictions.jsonl", rows)
            (args.output / "summary.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (ValueError, OSError, ImportError) as exc:
        parser.error(str(exc))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
