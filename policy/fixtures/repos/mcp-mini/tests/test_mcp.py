from src.mcp import dispatch


def test_search_is_registered():
    assert dispatch("search_pages") == "search_pages"
