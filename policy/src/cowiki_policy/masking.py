from __future__ import annotations

from .types import (
    Budget,
    Executor,
    Intent,
    LegalActionSpace,
    Mode,
    PolicyAction,
    PolicyInput,
    Privacy,
    Readiness,
    RepoState,
    RiskLevel,
    Tool,
)


EXECUTOR_CAPABILITIES: dict[Intent, tuple[Executor, ...]] = {
    Intent.LOCAL_TRANSFORM: (Executor.LOCAL, Executor.CODEX, Executor.CLAUDE),
    Intent.KNOWLEDGE_QUERY: (Executor.LOCAL, Executor.CODEX, Executor.CLAUDE),
    Intent.CODE_UNDERSTANDING: (Executor.CODEX, Executor.CLAUDE),
    Intent.CODE_EDIT: (Executor.CODEX, Executor.CLAUDE),
    Intent.LONG_DOCUMENT_ANALYSIS: (Executor.CLAUDE, Executor.CODEX),
    Intent.LONG_DOCUMENT_EDIT: (Executor.CLAUDE, Executor.CODEX),
    Intent.MIXED_RETRIEVAL_EDIT: (Executor.CODEX, Executor.CLAUDE),
    Intent.RISK_OPERATION: (Executor.CODEX, Executor.CLAUDE),
}


EDIT_INTENTS = {
    Intent.CODE_EDIT,
    Intent.LONG_DOCUMENT_EDIT,
    Intent.MIXED_RETRIEVAL_EDIT,
}


def build_legal_action_space(policy_input: PolicyInput, intent: Intent) -> LegalActionSpace:
    constraints: list[str] = []
    executors: list[Executor] = []
    for executor in EXECUTOR_CAPABILITIES[intent]:
        if policy_input.agents[executor] is not Readiness.AVAILABLE:
            constraints.append(f"{executor.value} is {policy_input.agents[executor].value}")
            continue
        if executor is not Executor.LOCAL and policy_input.budget is Budget.EXHAUSTED:
            constraints.append(f"{executor.value} removed because budget is exhausted")
            continue
        if executor is not Executor.LOCAL and policy_input.privacy is not Privacy.PUBLIC:
            constraints.append(
                f"{executor.value} removed because {policy_input.privacy.value} tasks stay local"
            )
            continue
        executors.append(executor)

    modes = list(policy_input.allowed_modes)
    if policy_input.repo_state is RepoState.ABSENT and Mode.BACKGROUND in modes:
        modes.remove(Mode.BACKGROUND)
        constraints.append("background removed because no repository is present")

    tools = [Tool.NONE, *policy_input.registered_tools]
    return LegalActionSpace(
        executors=tuple(executors),
        modes=tuple(modes),
        tools=tuple(tools),
        constraints=tuple(constraints),
    )


def validate_action(action: PolicyAction, space: LegalActionSpace) -> tuple[str, ...]:
    failures: list[str] = []
    if action.executor not in space.executors:
        failures.append(f"executor {action.executor.value} is outside the legal action space")
    if action.mode not in space.modes:
        failures.append(f"mode {action.mode.value} is outside the legal action space")
    if action.initial_tool not in space.tools:
        failures.append(f"tool {action.initial_tool.value} is outside the legal action space")
    if action.executor is Executor.LOCAL and action.mode is Mode.BACKGROUND:
        failures.append("local executor cannot create a background worktree")
    if action.intent in EDIT_INTENTS and action.mode is Mode.LIVE and action.risk_level is not RiskLevel.HIGH:
        failures.append("live writes must be classified as high risk")
    if action.mode is Mode.BACKGROUND and action.risk_level is RiskLevel.LOW:
        failures.append("background writes must be at least medium risk")
    return tuple(failures)
