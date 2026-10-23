import json
import pytest
from src.services.llm import parse_inline_tool_calls, format_tool_output_fallback, map_fn_to_tool_id


def test_parse_user_reported_minimax_tool_call():
    raw_text = """Let me get the current time in India for you.Let me fetch the exact information for you.]
<]minimax[>[<tool_call>
]<]minimax[>[<invoke name="browser_open_url">]<]minimax[>
[<url>https://www.google.com/search?q=current+time+in+India+now]<]minimax[>[</url>]
<]minimax[>[</invoke>
]<]minimax[>[</tool_call>"""

    tool_calls, visible_text = parse_inline_tool_calls(raw_text)

    assert len(tool_calls) == 1
    tc = tool_calls[0]
    assert tc["name"] == "browser_open_url"
    args = json.loads(tc["arguments"])
    assert args["url"] == "https://www.google.com/search?q=current+time+in+India+now"

    # Ensure no minimax tags or tool markup leaked into clean text
    assert "<]minimax[>" not in visible_text
    assert "<tool_call>" not in visible_text
    assert "<invoke" not in visible_text
    assert "Let me get the current time in India for you." in visible_text


def test_parse_web_search_inline_call():
    raw_text = """<invoke name="web_search">
<query>weather in Tokyo</query>
<maxResults>5</maxResults>
</invoke>"""

    tool_calls, visible_text = parse_inline_tool_calls(raw_text)
    assert len(tool_calls) == 1
    tc = tool_calls[0]
    assert tc["name"] == "web_search"
    args = json.loads(tc["arguments"])
    assert args["query"] == "weather in Tokyo"
    assert args["maxResults"] == "5"


def test_parse_youtube_play_inline_call():
    raw_text = """<]minimax[>[<tool_call>
<invoke name="browser_play_youtube">
[<query>Imagine Dragons - Believer</query>]
</invoke>
</tool_call>"""

    tool_calls, visible_text = parse_inline_tool_calls(raw_text)
    assert len(tool_calls) == 1
    tc = tool_calls[0]
    assert tc["name"] == "browser_play_youtube"
    args = json.loads(tc["arguments"])
    assert args["query"] == "Imagine Dragons - Believer"


def test_map_fn_to_tool_id():
    assert map_fn_to_tool_id("web_search") == "web.search"
    assert map_fn_to_tool_id("browser_open_url") == "browser.open_url"
    assert map_fn_to_tool_id("browser_play_youtube") == "browser.play_youtube"
    assert map_fn_to_tool_id("app_open") == "app.open"
    assert map_fn_to_tool_id("media_control") == "media.control"
    assert map_fn_to_tool_id("files_search") == "files.search"


def test_format_tool_output_fallback_web_search():
    data = {
        "results": [
            {"title": "Current IST Time", "url": "https://time.is/India", "snippet": "Time in India is 11:58 PM"}
        ]
    }
    fallback = format_tool_output_fallback("web.search", data)
    assert "Current IST Time" in fallback
    assert "https://time.is/India" in fallback


def test_format_tool_output_fallback_browser_open():
    data = {"url": "https://github.com"}
    fallback = format_tool_output_fallback("browser.open_url", data)
    assert "https://github.com" in fallback
    assert "Opened" in fallback


def test_format_tool_output_fallback_youtube():
    data = {"videoTitle": "Believer", "watchUrl": "https://www.youtube.com/watch?v=7wtfhZwyrcc"}
    fallback = format_tool_output_fallback("browser.play_youtube", data)
    assert "Believer" in fallback
    assert "https://www.youtube.com/watch?v=7wtfhZwyrcc" in fallback
