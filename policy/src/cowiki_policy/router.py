from __future__ import annotations

import re

from .masking import EDIT_INTENTS, build_legal_action_space, validate_action
from .types import (
    Executor,
    Intent,
    Mode,
    PolicyAction,
    PolicyInput,
    RiskLevel,
    RoutingResult,
    RoutingStatus,
    Tool,
)


EDIT_WORDS = ("修改", "更新", "修复", "补充", "改写", "添加", "modify", "update", "fix", "add")
KNOWLEDGE_WORDS = (
    "cowiki",
    "知识库",
    "页面",
    "反向链接",
    "坏链",
    "搜索",
    "检索",
    "查一下",
    "backlink",
    "broken link",
    "wiki",
)
CODE_WORDS = ("代码", "实现", "函数", "模块", "测试", "mcp", "typescript", "rust", "code")
LONG_DOCUMENT_WORDS = (
    "长文档",
    "多份文档",
    "文档集",
    "架构评审",
    "决策记录",
    "long document",
    "architecture review",
)
RISK_WORDS = (
    "合并",
    "推送",
    "上传",
    "外发",
    "发送到",
    "删除",
    "凭据",
    "密钥",
    "merge",
    "push",
    "upload",
    "send externally",
    "delete",
    "credential",
    "secret",
)


class RuleRouter:
    version = "rule-v0.1"

    def route(self, policy_input: PolicyInput) -> RoutingResult:
        intent = infer_intent(policy_input.task)
        space = build_legal_action_space(policy_input, intent)
        requested_tool, unknown_tool = extract_explicit_tool(policy_input.task)
        if unknown_tool:
            reasons = (*space.constraints, f"requested tool {unknown_tool} is not registered")
            return RoutingResult(RoutingStatus.BLOCKED, None, space, reasons)
        if requested_tool and requested_tool not in policy_input.registered_tools:
            reasons = (*space.constraints, f"requested tool {requested_tool.value} is not registered")
            return RoutingResult(RoutingStatus.BLOCKED, None, space, reasons)
        if not space.executors:
            reasons = (*space.constraints, "no eligible executor remains")
            return RoutingResult(RoutingStatus.BLOCKED, None, space, reasons)
        if not space.modes:
            reasons = (*space.constraints, "no execution mode remains")
            return RoutingResult(RoutingStatus.BLOCKED, None, space, reasons)

        executor = space.executors[0]
        mode = choose_mode(intent, space.modes)
        tool = requested_tool or choose_tool(intent, policy_input.task, space.tools)
        risk = choose_risk(intent, mode)
        action = PolicyAction(intent, executor, mode, tool, risk)
        failures = validate_action(action, space)
        if failures:
            return RoutingResult(
                RoutingStatus.BLOCKED,
                None,
                space,
                (*space.constraints, *failures),
            )
        if risk is RiskLevel.HIGH:
            return RoutingResult(
                RoutingStatus.APPROVAL_REQUIRED,
                action,
                space,
                (*space.constraints, "high-risk action requires human approval"),
                approval_required=True,
            )
        return RoutingResult(RoutingStatus.ROUTED, action, space, space.constraints)


def infer_intent(task: str) -> Intent:
    normalized = task.casefold()
    edit_view = normalized
    for phrase in ("不修改", "不要修改", "无需修改", "不补充", "do not modify", "without editing"):
        edit_view = edit_view.replace(phrase, "")
    has_edit = _contains_any(edit_view, EDIT_WORDS)
    has_knowledge = _contains_any(normalized, KNOWLEDGE_WORDS)
    has_long_document = _contains_any(normalized, LONG_DOCUMENT_WORDS)
    is_analysis = _contains_any(normalized, ("分析", "比较", "解释", "观点", "analysis", "compare", "explain"))
    if _contains_any(normalized, RISK_WORDS) and not (has_long_document and is_analysis):
        return Intent.RISK_OPERATION
    if has_long_document and has_edit:
        return Intent.LONG_DOCUMENT_EDIT
    if has_knowledge and has_edit:
        return Intent.MIXED_RETRIEVAL_EDIT
    if has_edit:
        return Intent.CODE_EDIT
    if has_long_document:
        return Intent.LONG_DOCUMENT_ANALYSIS
    if has_knowledge:
        return Intent.KNOWLEDGE_QUERY
    if _contains_any(normalized, CODE_WORDS):
        return Intent.CODE_UNDERSTANDING
    return Intent.LOCAL_TRANSFORM


def choose_mode(intent: Intent, modes: tuple[Mode, ...]) -> Mode:
    if intent in EDIT_INTENTS and Mode.BACKGROUND in modes:
        return Mode.BACKGROUND
    return Mode.LIVE if Mode.LIVE in modes else modes[0]


def choose_tool(intent: Intent, task: str, tools: tuple[Tool, ...]) -> Tool:
    normalized = task.casefold()
    candidates: list[Tool] = []
    if "反向链接" in normalized or "backlink" in normalized:
        candidates.append(Tool.LIST_BACKLINKS)
    elif "坏链" in normalized or "broken link" in normalized:
        candidates.append(Tool.LIST_BROKEN_LINKS)
    elif "读取页面" in normalized or "read page" in normalized:
        candidates.append(Tool.GET_PAGE)
    elif intent in {Intent.KNOWLEDGE_QUERY, Intent.MIXED_RETRIEVAL_EDIT}:
        candidates.append(Tool.SEARCH_PAGES)
    candidates.append(Tool.NONE)
    return next(tool for tool in candidates if tool in tools)


def choose_risk(intent: Intent, mode: Mode) -> RiskLevel:
    if intent is Intent.RISK_OPERATION or (intent in EDIT_INTENTS and mode is Mode.LIVE):
        return RiskLevel.HIGH
    if intent in EDIT_INTENTS:
        return RiskLevel.MEDIUM
    return RiskLevel.LOW


def extract_explicit_tool(task: str) -> tuple[Tool | None, str | None]:
    match = re.search(r"tool\s*[:：]\s*([a-z][a-z0-9_]*)", task.casefold())
    if not match:
        return None, None
    try:
        return Tool(match.group(1)), None
    except ValueError:
        return None, match.group(1)


def _contains_any(value: str, candidates: tuple[str, ...]) -> bool:
    for candidate in candidates:
        if candidate.isascii() and re.fullmatch(r"[a-z ]+", candidate):
            if re.search(rf"\b{re.escape(candidate)}\b", value):
                return True
        elif candidate in value:
            return True
    return False
