from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import StrEnum
from typing import Any


class Intent(StrEnum):
    LOCAL_TRANSFORM = "local_transform"
    KNOWLEDGE_QUERY = "knowledge_query"
    CODE_UNDERSTANDING = "code_understanding"
    CODE_EDIT = "code_edit"
    LONG_DOCUMENT_ANALYSIS = "long_document_analysis"
    LONG_DOCUMENT_EDIT = "long_document_edit"
    MIXED_RETRIEVAL_EDIT = "mixed_retrieval_edit"
    RISK_OPERATION = "risk_operation"


class Executor(StrEnum):
    LOCAL = "local"
    CODEX = "codex"
    CLAUDE = "claude"


class Mode(StrEnum):
    LIVE = "live"
    BACKGROUND = "background"


class Tool(StrEnum):
    NONE = "none"
    GET_SPACE_CONTEXT = "get_space_context"
    SEARCH_PAGES = "search_pages"
    GET_PAGE = "get_page"
    LIST_BACKLINKS = "list_backlinks"
    LIST_BROKEN_LINKS = "list_broken_links"


READ_ONLY_TOOLS = tuple(tool for tool in Tool if tool is not Tool.NONE)


class RiskLevel(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class Readiness(StrEnum):
    AVAILABLE = "available"
    NOT_INSTALLED = "notInstalled"
    BROKEN = "broken"
    SIGNED_OUT = "signedOut"


class Privacy(StrEnum):
    PUBLIC = "public"
    PRIVATE = "private"
    SENSITIVE = "sensitive"


class Budget(StrEnum):
    NORMAL = "normal"
    LOW = "low"
    EXHAUSTED = "exhausted"


class RepoState(StrEnum):
    ABSENT = "absent"
    CLEAN = "clean"
    DIRTY = "dirty"


class RoutingStatus(StrEnum):
    ROUTED = "routed"
    BLOCKED = "blocked"
    APPROVAL_REQUIRED = "approval_required"


@dataclass(frozen=True)
class PolicyInput:
    task_id: str
    task: str
    agents: dict[Executor, Readiness]
    registered_tools: tuple[Tool, ...]
    allowed_modes: tuple[Mode, ...]
    privacy: Privacy
    budget: Budget
    repo_state: RepoState

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "PolicyInput":
        expected = {
            "task_id",
            "task",
            "agents",
            "registered_tools",
            "allowed_modes",
            "privacy",
            "budget",
            "repo_state",
        }
        _require_exact_keys(value, expected, "PolicyInput")
        task_id = _non_empty_string(value["task_id"], "task_id")
        task = _non_empty_string(value["task"], "task")
        agents = {Executor(key): Readiness(status) for key, status in value["agents"].items()}
        if set(agents) != set(Executor):
            raise ValueError("agents must contain exactly local, codex, and claude")
        if agents[Executor.LOCAL] is not Readiness.AVAILABLE:
            raise ValueError("the local executor must always be available")
        tools = tuple(Tool(tool) for tool in value["registered_tools"])
        if Tool.NONE in tools or len(set(tools)) != len(tools):
            raise ValueError("registered_tools must contain unique registered MCP tools")
        modes = tuple(Mode(mode) for mode in value["allowed_modes"])
        if not modes or len(set(modes)) != len(modes):
            raise ValueError("allowed_modes must contain unique values")
        return cls(
            task_id=task_id,
            task=task,
            agents=agents,
            registered_tools=tools,
            allowed_modes=modes,
            privacy=Privacy(value["privacy"]),
            budget=Budget(value["budget"]),
            repo_state=RepoState(value["repo_state"]),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "task": self.task,
            "agents": {key.value: status.value for key, status in self.agents.items()},
            "registered_tools": [tool.value for tool in self.registered_tools],
            "allowed_modes": [mode.value for mode in self.allowed_modes],
            "privacy": self.privacy.value,
            "budget": self.budget.value,
            "repo_state": self.repo_state.value,
        }


@dataclass(frozen=True)
class PolicyAction:
    intent: Intent
    executor: Executor
    mode: Mode
    initial_tool: Tool
    risk_level: RiskLevel

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "PolicyAction":
        _require_exact_keys(
            value,
            {"intent", "executor", "mode", "initial_tool", "risk_level"},
            "PolicyAction",
        )
        return cls(
            intent=Intent(value["intent"]),
            executor=Executor(value["executor"]),
            mode=Mode(value["mode"]),
            initial_tool=Tool(value["initial_tool"]),
            risk_level=RiskLevel(value["risk_level"]),
        )

    def to_dict(self) -> dict[str, str]:
        return {key: value.value for key, value in asdict(self).items()}


@dataclass(frozen=True)
class LegalActionSpace:
    executors: tuple[Executor, ...]
    modes: tuple[Mode, ...]
    tools: tuple[Tool, ...]
    constraints: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "executors": [value.value for value in self.executors],
            "modes": [value.value for value in self.modes],
            "tools": [value.value for value in self.tools],
            "constraints": list(self.constraints),
        }


@dataclass(frozen=True)
class RoutingResult:
    status: RoutingStatus
    action: PolicyAction | None
    legal_action_space: LegalActionSpace
    reasons: tuple[str, ...] = ()
    approval_required: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status.value,
            "action": self.action.to_dict() if self.action else None,
            "reasons": list(self.reasons),
            "approval_required": self.approval_required,
        }


@dataclass(frozen=True)
class VerifierSpec:
    required_evidence: tuple[str, ...] = ()
    required_files: tuple[str, ...] = ()
    required_response_terms: tuple[str, ...] = ()
    tests_required: bool = False

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "VerifierSpec":
        allowed = {
            "required_evidence",
            "required_files",
            "required_response_terms",
            "tests_required",
        }
        unknown = set(value) - allowed
        if unknown:
            raise ValueError(f"VerifierSpec has unknown keys: {sorted(unknown)}")
        return cls(
            required_evidence=tuple(value.get("required_evidence", [])),
            required_files=tuple(value.get("required_files", [])),
            required_response_terms=tuple(value.get("required_response_terms", [])),
            tests_required=bool(value.get("tests_required", False)),
        )


@dataclass(frozen=True)
class SeedCase:
    category: str
    policy_input: PolicyInput
    acceptable_actions: tuple[PolicyAction, ...]
    expected_status: RoutingStatus
    verifier: VerifierSpec
    fixture: str


@dataclass(frozen=True)
class ExecutionResult:
    exit_status: str
    response: str
    evidence: tuple[str, ...]
    files_changed: tuple[str, ...]
    tests_passed: bool | None
    side_effects: tuple[str, ...]
    usage: dict[str, int | float]

    def to_dict(self) -> dict[str, Any]:
        return {
            "exit_status": self.exit_status,
            "response": self.response,
            "evidence": list(self.evidence),
            "files_changed": list(self.files_changed),
            "tests_passed": self.tests_passed,
            "side_effects": list(self.side_effects),
        }


@dataclass(frozen=True)
class VerificationResult:
    passed: bool
    score: float
    checks: dict[str, bool]
    failures: tuple[str, ...] = field(default_factory=tuple)

    def to_dict(self) -> dict[str, Any]:
        return {
            "passed": self.passed,
            "score": self.score,
            "checks": self.checks,
            "failures": list(self.failures),
        }


def _require_exact_keys(value: dict[str, Any], expected: set[str], label: str) -> None:
    actual = set(value)
    if actual != expected:
        missing = sorted(expected - actual)
        unknown = sorted(actual - expected)
        raise ValueError(f"{label} keys mismatch; missing={missing}, unknown={unknown}")


def _non_empty_string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a non-empty string")
    return value.strip()
