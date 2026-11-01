# MCP architecture

CoWiki exposes a read-only MCP surface with `search_pages`, `get_page`,
`get_space_context`, `list_backlinks`, and `list_broken_links`. Markdown files
are the source of truth; search indexes are derived.
