READ_ONLY_TOOLS = {
    "search_pages",
    "get_page",
    "get_space_context",
    "list_backlinks",
    "list_broken_links",
}


def dispatch(tool_name: str) -> str:
    if tool_name not in READ_ONLY_TOOLS:
        raise ValueError(f"unknown or unavailable read-only tool: {tool_name}")
    return tool_name
