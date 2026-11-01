"""Offline routing contracts; no fixture execution and no model dependencies."""
from __future__ import annotations

import hashlib
import json
import unicodedata
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .masking import build_legal_action_space, validate_action
from .types import Intent, PolicyAction, PolicyInput, RiskLevel, RoutingStatus


def strict_json(text: str) -> Any:
    def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
        value: dict[str, Any] = {}
        for key, item in items:
            if key in value:
                raise ValueError(f"duplicate JSON key: {key}")
            value[key] = item
        return value

    def invalid(value: str) -> None:
        raise ValueError(f"invalid JSON constant: {value}")

    return json.loads(text, object_pairs_hook=pairs, parse_constant=invalid)


def canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@dataclass(frozen=True)
class Prediction:
    status: RoutingStatus
    action: PolicyAction | None

    @classmethod
    def from_dict(cls, value: Any) -> "Prediction":
        if not isinstance(value, dict) or set(value) != {"status", "action"}:
            raise ValueError("prediction requires exactly status and action")
        status = RoutingStatus(value["status"])
        if status is RoutingStatus.BLOCKED:
            if value["action"] is not None:
                raise ValueError("blocked prediction must have null action")
            return cls(status, None)
        if not isinstance(value["action"], dict):
            raise ValueError("routed/approval_required prediction requires an action")
        action = PolicyAction.from_dict(value["action"])
        if (status is RoutingStatus.APPROVAL_REQUIRED) != (action.risk_level is RiskLevel.HIGH):
            raise ValueError("high risk requires approval_required, and vice versa")
        return cls(status, action)

    def to_dict(self) -> dict[str, Any]:
        return {"status": self.status.value, "action": self.action.to_dict() if self.action else None}


def constraint_errors(value: Prediction, policy_input: PolicyInput) -> tuple[str, ...]:
    """Structural/environment checks, NOT a semantic safety or execution gate.

    A blocked answer may be unjustified; the gold comparison catches that.
    Intent/risk under-classification also needs independent semantic evaluation.
    """
    if value.action is None:
        return ()
    action = value.action
    errors = list(validate_action(action, build_legal_action_space(policy_input, action.intent)))
    if action.intent is Intent.RISK_OPERATION and action.risk_level is not RiskLevel.HIGH:
        errors.append("risk_operation must have high risk")
    return tuple(errors)


@dataclass(frozen=True)
class RoutingCase:
    sample_id: str
    family_id: str
    split: str
    category: str
    source: str
    review_status: str
    annotation_reason: str
    policy_input: PolicyInput
    target: Prediction
    acceptable: tuple[Prediction, ...]


def load_cases(path: Path) -> list[RoutingCase]:
    cases: list[RoutingCase] = []
    ids: set[str] = set()
    families: dict[str, str] = {}
    prompts: dict[str, str] = {}
    tasks: dict[str, str] = {}
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = strict_json(line)
            expected = {"sample_id", "family_id", "split", "category", "source", "review_status",
                        "annotation_reason", "input", "target", "acceptable_predictions"}
            if not isinstance(row, dict) or set(row) != expected:
                raise ValueError("unexpected/missing dataset fields")
            for key in expected - {"input", "target", "acceptable_predictions"}:
                if not isinstance(row[key], str) or not row[key].strip():
                    raise ValueError(f"{key} must be a nonempty string")
            if row["split"] not in {"dev", "train", "validation", "test"}:
                raise ValueError("invalid split")
            if row["review_status"] not in {"pending", "approved"}:
                raise ValueError("invalid review_status")
            Intent(row["category"])
            inputs = row["input"]
            if not isinstance(inputs, dict) or inputs.get("task_id") != row["sample_id"]:
                raise ValueError("input.task_id must match sample_id")
            if not isinstance(inputs.get("agents"), dict):
                raise ValueError("agents must be an object")
            for key in ("registered_tools", "allowed_modes"):
                if not isinstance(inputs.get(key), list):
                    raise ValueError(f"{key} must be a list")
            policy_input = PolicyInput.from_dict(inputs)
            target = Prediction.from_dict(row["target"])
            if not isinstance(row["acceptable_predictions"], list) or not row["acceptable_predictions"]:
                raise ValueError("acceptable_predictions must be a nonempty list")
            acceptable = tuple(Prediction.from_dict(v) for v in row["acceptable_predictions"])
            if target not in acceptable:
                raise ValueError("target is not an acceptable prediction")
            for prediction in acceptable:
                errors = constraint_errors(prediction, policy_input)
                if errors:
                    raise ValueError(f"invalid reference constraints: {errors}")
                if prediction.action and prediction.action.intent.value != row["category"]:
                    raise ValueError("reference intent disagrees with category")
            if row["sample_id"] in ids:
                raise ValueError("duplicate sample_id")
            ids.add(row["sample_id"])
            family = row["family_id"]
            if family in families and families[family] != row["split"]:
                raise ValueError("family crosses dataset splits")
            families[family] = row["split"]
            model_input = policy_input.to_dict()
            del model_input["task_id"]
            key = canonical(model_input)
            if key in prompts:
                raise ValueError(f"duplicate model input (first sample {prompts[key]})")
            prompts[key] = row["sample_id"]
            normalized = "".join(unicodedata.normalize("NFKC", policy_input.task).casefold().split())
            if normalized in tasks and tasks[normalized] != row["split"]:
                raise ValueError("identical normalized task crosses dataset splits")
            tasks[normalized] = row["split"]
            cases.append(RoutingCase(row["sample_id"], family, row["split"], row["category"],
                                     row["source"], row["review_status"], row["annotation_reason"],
                                     policy_input, target, acceptable))
        except (KeyError, TypeError, ValueError, AttributeError) as error:
            raise ValueError(f"{path}:{number}: {error}") from error
    if not cases:
        raise ValueError("dataset is empty")
    return cases


def describe(cases: list[RoutingCase]) -> dict[str, Any]:
    return {
        "samples": len(cases), "families": len({c.family_id for c in cases}),
        "splits": dict(Counter(c.split for c in cases)),
        "categories": dict(Counter(c.category for c in cases)),
        "statuses": dict(Counter(c.target.status.value for c in cases)),
        "review_status": dict(Counter(c.review_status for c in cases)),
        "note": "Automated validation does not establish semantic label quality or detect all paraphrase leakage.",
    }
