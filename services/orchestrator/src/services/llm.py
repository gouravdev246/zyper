"""
LLM and Tool Calling Service for Zyper Personal AI Operator.

Supports multi-provider execution:
- Google Gemini (native REST stream)
- Nebius Token Factory / OpenAI-compatible endpoint (using openai SDK)

Handles streaming chat completions, tool execution via Express API Safe Tool
Registry, and automated fallback when provider rate limits are encountered.
"""

import os
import re
import json
import logging
import httpx
from typing import Dict, Any, List, Optional, Tuple, AsyncGenerator
from fastapi import Request
from openai import AsyncOpenAI, OpenAI
from src.config import settings

logger = logging.getLogger("zyper.orchestrator.llm")

# System prompt defining Zyper operator capabilities and safety rules
SYSTEM_INSTRUCTION = """
You are Zyper, a Personal AI Operator and executive AI assistant.
You assist the user by answering questions, executing tasks, and integrating with connected tools.

Available tools include:
- Web Search & Browser: live web search (`web_search`), opening web links in default browser (`browser_open_url`), and searching & playing songs/videos on YouTube (`browser_play_youtube`).
- Gmail: listing unread messages, reading emails, preparing drafts, and sending emails.
- Google Calendar: listing schedules, checking meeting conflicts, and scheduling events.
- Windows Desktop: opening permitted applications (notepad, calculator, vscode, terminal, browser, explorer, spotify), controlling media playback (play_pause, next_track, prev_track, volume_up, volume_down, mute), and searching local files in approved folders (documents, downloads, desktop, workspace).

Tool Calling Rules:
1. When the user asks any question requiring current, real-time, or external facts (e.g. current time, date, weather, news, sports scores, live information, web research), IMMEDIATELY call `web_search` with the query keywords. When search results return, synthesize and provide a direct answer. Do NOT use `browser_open_url` for informational questions.
2. When the user asks to "Open YouTube and play [song/video]" or play any music/video, IMMEDIATELY call `browser_play_youtube` with the song or video title query. Do not ask for confirmation; open and play it directly.
3. When the user explicitly asks to open a specific website or URL in their browser (e.g. "open github.com", "open youtube", "open this link in browser"), call `browser_open_url` with the target URL.
4. When the user asks to check, list, read, or summarize unread emails, IMMEDIATELY call `gmail_list_unread`.
5. When the user asks to check their calendar or schedule, IMMEDIATELY call `calendar_list_events`.
6. When the user asks to open an app (e.g. "open notepad", "open calculator", "launch vs code"), call `app_open` with the appropriate appId.
7. When the user asks to control media or audio (e.g. "mute volume", "pause music", "turn volume up"), call `media_control` with the corresponding action.
8. When the user asks to find or search files in a folder, call `files_search` with the target folderId (documents, downloads, desktop, workspace) and search query.
9. For consequential actions (like sending an email or booking a calendar event), make sure you have the required parameters before calling the tool.
10. Always invoke tools directly using the tool calling mechanism. Do NOT print raw tool tags like `<tool_call>`, `<invoke>`, or `<]minimax[>` in your conversational text.
11. Keep answers helpful, professional, polite, and well-structured with markdown.
""".strip()


def build_gemini_tools() -> List[Dict[str, Any]]:
    """
    Builds the function declarations for Google Gemini matching the
    Safe Tool Registry registered in the Express API.
    """
    return [
        {
            "name": "gmail_list_unread",
            "description": "Fetch permitted unread inbox messages from connected Gmail account.",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "maxResults": {
                        "type": "INTEGER",
                        "description": "Maximum number of unread emails to retrieve (default: 10)",
                    }
                },
            },
        },
        {
            "name": "gmail_read_message",
            "description": "Read the full email message content and metadata by message ID.",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "messageId": {
                        "type": "STRING",
                        "description": "Unique identifier of the email message to read",
                    }
                },
                "required": ["messageId"],
            },
        },
        {
            "name": "gmail_create_draft",
            "description": "Prepare a draft email in Gmail without sending it.",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "to": {"type": "STRING", "description": "Recipient email address"},
                    "subject": {"type": "STRING", "description": "Email subject line"},
                    "body": {"type": "STRING", "description": "Email message body content"},
                },
                "required": ["to", "subject", "body"],
            },
        },
        {
            "name": "gmail_send",
            "description": "Send an email message through connected Gmail account. Requires explicit user approval.",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "to": {"type": "STRING", "description": "Recipient email address"},
                    "subject": {"type": "STRING", "description": "Email subject line"},
                    "body": {"type": "STRING", "description": "Email message body content"},
                },
                "required": ["to", "subject", "body"],
            },
        },
        {
            "name": "calendar_list_events",
            "description": "Retrieve upcoming calendar schedule and briefing items.",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "daysAhead": {
                        "type": "INTEGER",
                        "description": "Number of days ahead to search (default: 7)",
                    },
                    "maxResults": {
                        "type": "INTEGER",
                        "description": "Maximum number of events to return (default: 10)",
                    },
                },
            },
        },
        {
            "name": "calendar_check_conflicts",
            "description": "Check if a proposed meeting slot conflicts with existing scheduled events.",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "start": {
                        "type": "STRING",
                        "description": "Proposed event start ISO datetime",
                    },
                    "end": {
                        "type": "STRING",
                        "description": "Proposed event end ISO datetime",
                    },
                },
                "required": ["start", "end"],
            },
        },
        {
            "name": "calendar_create_event",
            "description": "Schedule a new calendar event. Requires explicit user approval.",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "summary": {"type": "STRING", "description": "Title or summary of the meeting"},
                    "start": {"type": "STRING", "description": "Start ISO datetime"},
                    "end": {"type": "STRING", "description": "End ISO datetime"},
                    "description": {"type": "STRING", "description": "Optional notes or agenda"},
                    "location": {"type": "STRING", "description": "Optional physical location or meeting URL"},
                },
                "required": ["summary", "start", "end"],
            },
        },
        {
            "name": "app_open",
            "description": "Open an authorized desktop application on the Windows host machine (notepad, calculator, vscode, terminal, browser, explorer, spotify).",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "appId": {
                        "type": "STRING",
                        "description": "Application identifier: notepad, calculator, vscode, terminal, browser, explorer, spotify",
                    }
                },
                "required": ["appId"],
            },
        },
        {
            "name": "media_control",
            "description": "Control Windows system audio and media playback.",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "action": {
                        "type": "STRING",
                        "description": "Media action: play_pause, next_track, prev_track, volume_up, volume_down, mute",
                    }
                },
                "required": ["action"],
            },
        },
        {
            "name": "files_search",
            "description": "Search for files within approved local directories (documents, downloads, desktop, workspace) with path traversal security.",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "folderId": {
                        "type": "STRING",
                        "description": "Approved directory: documents, downloads, desktop, or workspace",
                    },
                    "query": {
                        "type": "STRING",
                        "description": "File name search keyword or extension (e.g. .pdf, invoice, notes)",
                    },
                    "maxResults": {
                        "type": "INTEGER",
                        "description": "Maximum number of files to return (default: 10)",
                    },
                },
                "required": ["folderId", "query"],
            },
        },
        {
            "name": "web_search",
            "description": "Search the live web for real-time information, documentation, news, and links without requiring API keys.",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "query": {
                        "type": "STRING",
                        "description": "Search query keywords",
                    },
                    "maxResults": {
                        "type": "INTEGER",
                        "description": "Maximum number of search results (default: 5)",
                    },
                },
                "required": ["query"],
            },
        },
        {
            "name": "browser_open_url",
            "description": "Open a web URL directly in the user's default desktop browser (e.g. Chrome, Edge).",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "url": {
                        "type": "STRING",
                        "description": "Full web URL starting with http:// or https://",
                    },
                },
                "required": ["url"],
            },
        },
        {
            "name": "browser_play_youtube",
            "description": "Search for a song, music video, or content on YouTube and immediately launch it in the web browser for instant autoplay.",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "query": {
                        "type": "STRING",
                        "description": "Song name, artist, music, or video title to play on YouTube",
                    },
                },
                "required": ["query"],
            },
        },
    ]


def build_openai_tools() -> List[Dict[str, Any]]:
    """
    Builds OpenAI-compatible tool specifications matching the Safe Tool Registry.
    """
    gemini_tools = build_gemini_tools()
    openai_tools: List[Dict[str, Any]] = []

    for gt in gemini_tools:
        props = {}
        gemini_props = gt.get("parameters", {}).get("properties", {})
        for prop_name, prop_data in gemini_props.items():
            prop_type = prop_data.get("type", "STRING").lower()
            if prop_type == "integer":
                prop_type = "integer"
            else:
                prop_type = "string"

            props[prop_name] = {
                "type": prop_type,
                "description": prop_data.get("description", ""),
            }

        openai_tools.append({
            "type": "function",
            "function": {
                "name": gt["name"],
                "description": gt["description"],
                "parameters": {
                    "type": "object",
                    "properties": props,
                    "required": gt.get("parameters", {}).get("required", []),
                },
            },
        })

    return openai_tools


def map_fn_to_tool_id(fn_name: str) -> str:
    """
    Maps LLM function name (e.g. gmail_list_unread)
    back to internal tool registry ID (e.g. gmail.list_unread).
    """
    mapping = {
        "gmail_list_unread": "gmail.list_unread",
        "gmail_read_message": "gmail.read_message",
        "gmail_create_draft": "gmail.create_draft",
        "gmail_send": "gmail.send",
        "calendar_list_events": "calendar.list_events",
        "calendar_check_conflicts": "calendar.check_conflicts",
        "calendar_create_event": "calendar.create_event",
        "app_open": "app.open",
        "media_control": "media.control",
        "files_search": "files.search",
        "web_search": "web.search",
        "browser_open_url": "browser.open_url",
        "browser_play_youtube": "browser.play_youtube",
        "youtube_play": "browser.play_youtube",
    }
    return mapping.get(fn_name, fn_name.replace("_", "."))


async def execute_tool_via_api(tool_id: str, tool_input: Dict[str, Any], run_id: str) -> Dict[str, Any]:
    """
    Executes a tool call via the Express API /api/v1/tools/execute endpoint.
    Respects policy engine validation and approval requirements.
    """
    url = f"{settings.API_BASE_URL}/tools/execute"
    payload = {
        "toolId": tool_id,
        "input": tool_input,
        "runId": run_id,
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.post(url, json=payload)
            if res.status_code in (200, 403):
                body = res.json()
                return body.get("data", {})
            return {
                "toolId": tool_id,
                "status": "FAILED",
                "error": f"API returned HTTP {res.status_code}: {res.text}",
            }
    except Exception as err:
        logger.error(f"Failed to execute tool {tool_id} via API: {err}")
        return {
            "toolId": tool_id,
            "status": "FAILED",
            "error": str(err),
        }


def parse_inline_tool_calls(text: str) -> Tuple[List[Dict[str, Any]], str]:
    """
    Extracts tool calls that were generated as inline XML/text markup
    (such as MiniMax <]minimax[>[<tool_call>...<invoke name="...">...</invoke>]
    or standard <tool_call><invoke name="...">...</invoke></tool_call>).
    Returns (tool_calls, clean_visible_text).
    """
    tool_calls: List[Dict[str, Any]] = []
    cleaned = text.replace("<]minimax[>", "")

    # Regex to find <invoke name="...">...</invoke> (optionally enclosed in brackets)
    invoke_pattern = re.compile(
        r'\[?<invoke\s+name=["\']([^"\']+)["\']>([\s\S]*?)<\/invoke>\]?',
        re.IGNORECASE,
    )

    for match in invoke_pattern.finditer(cleaned):
        fn_name = match.group(1).strip()
        body = match.group(2).replace("<]minimax[>", "").strip()
        args: Dict[str, Any] = {}

        # Look for XML-style parameter tags <param_name>value</param_name>
        arg_pattern = re.compile(r'\[?<([a-zA-Z0-9_]+)>([\s\S]*?)<\/\1>\]?')
        for arg_m in arg_pattern.finditer(body):
            param_name = arg_m.group(1)
            raw_val = arg_m.group(2).strip()
            # Clean stray brackets or minimax markup inside the parameter
            clean_val = raw_val.replace("<]minimax[>", "").replace("[", "").replace("]", "").strip()
            args[param_name] = clean_val

        # If no XML tags matched, check if body is raw JSON
        if not args and body.startswith("{") and body.endswith("}"):
            try:
                args = json.loads(body)
            except Exception:
                pass

        tool_calls.append({
            "id": f"call_inline_{len(tool_calls)}",
            "name": fn_name,
            "arguments": json.dumps(args),
        })

    # Strip out all tool call markup and minimax markers from visible text
    visible_text = re.sub(r'\[?<tool_call>[\s\S]*?<\/tool_call>\]?', '', cleaned, flags=re.IGNORECASE)
    visible_text = re.sub(r'\[?<invoke[\s\S]*?<\/invoke>\]?', '', visible_text, flags=re.IGNORECASE)
    visible_text = visible_text.replace('<]minimax[>', '').strip()
    visible_text = re.sub(r'\]+$', '', visible_text).strip()

    return tool_calls, visible_text


def format_tool_output_fallback(tool_id: str, output_data: Dict[str, Any]) -> str:
    """
    Generates a structured, human-readable summary of tool output
    if the LLM follow-up synthesis fails or is unavailable.
    """
    if tool_id in ("web.search", "web_search"):
        results = output_data.get("results", [])
        if not results:
            return "\n\nNo web search results were found for your query."
        lines = ["\n\n**Web Search Results:**\n"]
        for r in results[:5]:
            title = r.get("title", "Result")
            url = r.get("url", "")
            snippet = r.get("snippet", "")
            lines.append(f"- [{title}]({url}): {snippet}")
        return "\n".join(lines) + "\n"

    elif tool_id in ("browser.play_youtube", "browser_play_youtube", "youtube.play", "youtube_play"):
        video_title = output_data.get("videoTitle") or output_data.get("query", "video")
        watch_url = output_data.get("watchUrl", "")
        return f"\n\nNow playing **{video_title}** on YouTube: [{watch_url}]({watch_url})\n"

    elif tool_id in ("browser.open_url", "browser_open_url", "web.open_url", "web_open_url"):
        opened_url = output_data.get("url", "")
        return f"\n\nOpened **{opened_url}** in your default web browser.\n"

    elif tool_id in ("gmail.list_unread", "gmail_list_unread"):
        msgs = output_data.get("messages", [])
        if not msgs:
            return "\n\nYou have no unread emails in your inbox."
        lines = ["\n\nHere are your recent unread emails:\n"]
        for m in msgs[:5]:
            from_addr = m.get("from", "Unknown")
            subj = m.get("subject", "(No subject)")
            lines.append(f"- **{from_addr}**: {subj}")
        return "\n".join(lines) + "\n"

    elif tool_id in ("calendar.list_events", "calendar_list_events"):
        events = output_data.get("events", [])
        if not events:
            return "\n\nYou have no upcoming events scheduled."
        lines = ["\n\nHere are your upcoming calendar events:\n"]
        for ev in events[:5]:
            summary = ev.get("summary", "Event")
            start = ev.get("start", "")
            lines.append(f"- **{summary}** at {start}")
        return "\n".join(lines) + "\n"

    elif tool_id in ("app.open", "app_open", "desktop.app_launch"):
        app_name = output_data.get("appName") or output_data.get("appId", "application")
        return f"\n\nSuccessfully launched **{app_name}** on your Windows desktop.\n"

    elif tool_id in ("media.control", "media_control", "desktop.media_control"):
        action = output_data.get("action", "action")
        return f"\n\nExecuted Windows media action: `{action}`.\n"

    elif tool_id in ("files.search", "files_search", "desktop.fs_search"):
        results = output_data.get("results", [])
        folder = output_data.get("folderId", "folder")
        if not results:
            return f"\n\nNo files found matching your search in {folder}."
        lines = [f"\n\nFound {len(results)} file(s) in {folder}:\n"]
        for f in results[:5]:
            name = f.get("name", "")
            size = f.get("sizeBytes", 0)
            lines.append(f"- `{name}` ({size} bytes)")
        return "\n".join(lines) + "\n"

    return f"\n\nTool `{tool_id}` executed successfully."


async def stream_nebius_chat_and_tools(
    run_id: str,
    goal: str,
    history: Optional[List[Dict[str, Any]]],
    req: Request,
    active_runs: Dict[str, Any],
) -> AsyncGenerator[str, None]:
    """
    Streams completions from Nebius AI (OpenAI-compatible Token Factory).
    Detects and executes both standard OpenAI delta tool calls and inline model tool calls.
    """
    api_key = settings.NEBIUS_API_KEY or os.environ.get("NEBIUS_API_KEY")
    base_url = settings.NEBIUS_BASE_URL or os.environ.get("NEBIUS_BASE_URL") or "https://api.tokenfactory.nebius.com/v1/"
    model_name = settings.NEBIUS_MODEL or os.environ.get("NEBIUS_MODEL") or "MiniMaxAI/MiniMax-M3"

    if not api_key:
        yield f"data: {json.dumps({'type': 'token', 'content': 'Error: NEBIUS_API_KEY is not set in .env. Please configure it to enable Nebius AI.'})}\n\n"
        yield f"data: {json.dumps({'type': 'run.completed', 'runId': run_id, 'status': 'FAILED'})}\n\n"
        return

    client = AsyncOpenAI(base_url=base_url, api_key=api_key)

    messages: List[Dict[str, Any]] = [
        {"role": "system", "content": SYSTEM_INSTRUCTION}
    ]

    if history:
        for msg in history[-10:]:
            role = "user" if msg.get("sender") == "user" or msg.get("role") == "user" else "assistant"
            content = msg.get("content", "")
            if content:
                messages.append({"role": role, "content": content})

    messages.append({
        "role": "user",
        "content": [
            {
                "type": "text",
                "text": goal,
            }
        ],
    })

    yield f"data: {json.dumps({'type': 'task.started', 'task': 'reasoning', 'description': f'Reasoning with Nebius ({model_name})'})}\n\n"

    tools = build_openai_tools()

    try:
        # Request stream with tools
        response_stream = await client.chat.completions.create(
            model=model_name,
            messages=messages,
            tools=tools,
            stream=True,
        )
    except Exception as e:
        logger.warning(f"Nebius stream with tools threw ({e}), falling back to stream without tools")
        response_stream = await client.chat.completions.create(
            model=model_name,
            messages=messages,
            stream=True,
        )

    tool_calls_list: List[Dict[str, Any]] = []
    current_tc = None
    accumulated_content = ""
    streamed_length = 0
    in_tool_markup = False
    MARKERS = ["<]minimax[>", "<tool_call", "<invoke", "[<tool_call"]

    async for chunk in response_stream:
        if active_runs.get(run_id, {}).get("cancelled") or await req.is_disconnected():
            active_runs[run_id]["cancelled"] = True
            yield f"data: {json.dumps({'type': 'run.cancelled', 'runId': run_id})}\n\n"
            return

        if not chunk.choices:
            continue

        delta = chunk.choices[0].delta

        # 1. Accumulate text content and safely filter out tool markup tokens
        if delta.content:
            accumulated_content += delta.content

            if not in_tool_markup:
                marker_indices = [
                    accumulated_content.find(m) for m in MARKERS if accumulated_content.find(m) != -1
                ]
                if marker_indices:
                    in_tool_markup = True
                    first_marker_idx = min(marker_indices)
                    safe_to_stream = accumulated_content[streamed_length:first_marker_idx].rstrip("] \n\r")
                    if safe_to_stream:
                        yield f"data: {json.dumps({'type': 'token', 'content': safe_to_stream})}\n\n"
                    streamed_length = first_marker_idx
                else:
                    tail = accumulated_content[-15:]
                    possible_split = -1
                    for i, char in enumerate(tail):
                        if char in ('<', '['):
                            possible_split = len(accumulated_content) - 15 + i
                            break

                    if possible_split != -1 and possible_split > streamed_length:
                        safe_text = accumulated_content[streamed_length:possible_split]
                        if safe_text:
                            yield f"data: {json.dumps({'type': 'token', 'content': safe_text})}\n\n"
                            streamed_length = possible_split
                    elif possible_split == -1:
                        safe_text = accumulated_content[streamed_length:]
                        if safe_text:
                            yield f"data: {json.dumps({'type': 'token', 'content': safe_text})}\n\n"
                            streamed_length = len(accumulated_content)

        # 2. Accumulate standard OpenAI delta tool calls
        if delta.tool_calls:
            for tc in delta.tool_calls:
                if tc.id or (tc.function and tc.function.name):
                    current_tc = {
                        "id": tc.id or f"call_{len(tool_calls_list)}",
                        "name": tc.function.name if tc.function and tc.function.name else "",
                        "arguments": (tc.function.arguments or "") if tc.function else "",
                    }
                    tool_calls_list.append(current_tc)
                elif current_tc is not None and tc.function and tc.function.arguments:
                    current_tc["arguments"] += tc.function.arguments

    # If no standard tool calls were received, parse any inline XML/text tool calls
    if not tool_calls_list and accumulated_content:
        inline_tcs, _ = parse_inline_tool_calls(accumulated_content)
        if inline_tcs:
            tool_calls_list.extend(inline_tcs)

    # If no tool calls were detected and no tool markup started, flush remaining text
    if not tool_calls_list and not in_tool_markup and streamed_length < len(accumulated_content):
        rem = accumulated_content[streamed_length:]
        if rem:
            yield f"data: {json.dumps({'type': 'token', 'content': rem})}\n\n"

    # Process all detected tool calls
    for tc in tool_calls_list:
        fn_name = tc["name"]
        args_str = tc["arguments"]
        try:
            fn_args = json.loads(args_str) if args_str else {}
        except Exception:
            fn_args = {}

        tool_id = map_fn_to_tool_id(fn_name)
        yield f"data: {json.dumps({'type': 'task.started', 'task': 'tool_call', 'description': f'Executing {tool_id}'})}\n\n"

        tool_result = await execute_tool_via_api(tool_id, fn_args, run_id)
        tool_status = tool_result.get("status")

        if tool_status == "REQUIRES_APPROVAL":
            approval = tool_result.get("approval", {})
            yield f"data: {json.dumps({'type': 'approval.required', 'approval': approval})}\n\n"
            msg = f"\n\n**Action Requires Approval**: The requested action `{tool_id}` involves consequential side effects. A pending approval record has been generated. Please navigate to the **Approvals** tab to inspect and authorize this action."
            yield f"data: {json.dumps({'type': 'token', 'content': msg})}\n\n"

        elif tool_status == "SUCCESS":
            output_data = tool_result.get("output", {})
            yield f"data: {json.dumps({'type': 'tool.completed', 'toolId': tool_id, 'output': output_data})}\n\n"

            # Prepare follow-up messages with tool result
            follow_up_messages = list(messages)
            follow_up_messages.append({
                "role": "assistant",
                "tool_calls": [
                    {
                        "id": tc["id"],
                        "type": "function",
                        "function": {
                            "name": fn_name,
                            "arguments": args_str,
                        },
                    }
                ],
            })
            follow_up_messages.append({
                "role": "tool",
                "tool_call_id": tc["id"],
                "content": json.dumps(output_data),
            })

            try:
                follow_up_stream = await client.chat.completions.create(
                    model=model_name,
                    messages=follow_up_messages,
                    stream=True,
                )
                async for chunk in follow_up_stream:
                    if active_runs.get(run_id, {}).get("cancelled") or await req.is_disconnected():
                        return
                    if chunk.choices and chunk.choices[0].delta.content:
                        c_text = chunk.choices[0].delta.content
                        clean_c = c_text.replace("<]minimax[>", "")
                        if "<tool_call" in clean_c or "<invoke" in clean_c:
                            continue
                        if clean_c:
                            yield f"data: {json.dumps({'type': 'token', 'content': clean_c})}\n\n"
            except Exception as f_err:
                logger.error(f"Nebius follow-up synthesis error: {f_err}")
                fallback_msg = format_tool_output_fallback(tool_id, output_data)
                yield f"data: {json.dumps({'type': 'token', 'content': fallback_msg})}\n\n"
        else:
            err_message = tool_result.get("error", "Action was denied or failed")
            yield f"data: {json.dumps({'type': 'token', 'content': f'\\n\\n[Tool execution notice: {err_message}]'})}\n\n"

    if run_id in active_runs:
        active_runs[run_id]["status"] = "COMPLETED"

    yield f"data: {json.dumps({'type': 'run.completed', 'runId': run_id, 'status': 'COMPLETED'})}\n\n"


async def stream_chat_and_tools(
    run_id: str,
    goal: str,
    history: Optional[List[Dict[str, Any]]],
    req: Request,
    active_runs: Dict[str, Any],
    model: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    """
    Orchestrates streaming chat with the configured LLM provider.
    Automatically handles rate limit fallback from Gemini to Nebius AI.
    """
    # 1. Yield run.started
    yield f"data: {json.dumps({'type': 'run.started', 'runId': run_id, 'goal': goal})}\n\n"

    # 2. Check if Nebius is requested by user or configured as default
    provider = (model or settings.DEFAULT_LLM_PROVIDER).lower()
    has_nebius_key = bool(settings.NEBIUS_API_KEY or os.environ.get("NEBIUS_API_KEY"))

    if provider in ("nebius", "gpt-oss", "gpt-oss-120b", "MiniMaxAI/MiniMax-M3") or (has_nebius_key and not settings.GEMINI_API_KEY and provider != "gemini"):
        async for evt in stream_nebius_chat_and_tools(run_id, goal, history, req, active_runs):
            yield evt
        return

    # 3. Default to Gemini provider
    api_key = settings.GEMINI_API_KEY
    if not api_key:
        if has_nebius_key:
            async for evt in stream_nebius_chat_and_tools(run_id, goal, history, req, active_runs):
                yield evt
            return

        yield f"data: {json.dumps({'type': 'token', 'content': 'Error: Neither GEMINI_API_KEY nor NEBIUS_API_KEY is configured in the environment.'})}\n\n"
        yield f"data: {json.dumps({'type': 'run.completed', 'runId': run_id, 'status': 'FAILED'})}\n\n"
        return

    # 4. Format contents for Gemini
    contents: List[Dict[str, Any]] = []

    if history:
        for msg in history[-10:]:
            role = "user" if msg.get("sender") == "user" or msg.get("role") == "user" else "model"
            text_content = msg.get("content", "")
            if text_content:
                contents.append({
                    "role": role,
                    "parts": [{"text": text_content}],
                })

    contents.append({
        "role": "user",
        "parts": [{"text": goal}],
    })

    model_name = settings.GEMINI_MODEL or "gemini-2.5-flash"
    gemini_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:streamGenerateContent?alt=sse&key={api_key}"

    payload = {
        "systemInstruction": {
            "parts": [{"text": SYSTEM_INSTRUCTION}],
        },
        "contents": contents,
        "tools": [
            {"functionDeclarations": build_gemini_tools()}
        ],
    }

    pending_function_call = None
    pending_model_parts = None

    try:
        yield f"data: {json.dumps({'type': 'task.started', 'task': 'reasoning', 'description': 'Analyzing request with Gemini'})}\n\n"

        async with httpx.AsyncClient(timeout=45.0) as client:
            async with client.stream("POST", gemini_url, json=payload) as response:
                if response.status_code != 200:
                    err_body = await response.aread()
                    error_text = err_body.decode("utf-8", errors="replace")
                    logger.error(f"Gemini API returned error {response.status_code}: {error_text}")

                    # Automatically fall back to Nebius if Gemini quota is exhausted
                    if (response.status_code == 429 or "quota" in error_text.lower() or "retry" in error_text.lower()) and has_nebius_key:
                        logger.info("Gemini free tier quota exhausted, switching to Nebius AI...")
                        yield f"data: {json.dumps({'type': 'token', 'content': '*(Gemini free tier quota exhausted, switching seamlessly to Nebius...)*\n\n'})}\n\n"
                        async for evt in stream_nebius_chat_and_tools(run_id, goal, history, req, active_runs):
                            yield evt
                        return

                    yield f"data: {json.dumps({'type': 'token', 'content': f'Assistant error: Gemini API returned status {response.status_code}. {error_text[:180]}'})}\n\n"
                    yield f"data: {json.dumps({'type': 'run.completed', 'runId': run_id, 'status': 'FAILED'})}\n\n"
                    return

                async for line in response.aiter_lines():
                    if active_runs.get(run_id, {}).get("cancelled") or await req.is_disconnected():
                        active_runs[run_id]["cancelled"] = True
                        yield f"data: {json.dumps({'type': 'run.cancelled', 'runId': run_id})}\n\n"
                        return

                    if not line.startswith("data: "):
                        continue

                    json_str = line[len("data: "):].strip()
                    if not json_str:
                        continue

                    try:
                        chunk_data = json.loads(json_str)
                    except json.JSONDecodeError:
                        continue

                    candidates = chunk_data.get("candidates", [])
                    if not candidates:
                        continue

                    parts = candidates[0].get("content", {}).get("parts", [])
                    for part in parts:
                        if "text" in part:
                            yield f"data: {json.dumps({'type': 'token', 'content': part['text']})}\n\n"

                        if "functionCall" in part:
                            pending_function_call = part["functionCall"]
                            pending_model_parts = parts

        # If Gemini invoked a tool, execute it via the Express API
        if pending_function_call:
            fn_name = pending_function_call.get("name")
            fn_args = pending_function_call.get("args", {})
            tool_id = map_fn_to_tool_id(fn_name)

            yield f"data: {json.dumps({'type': 'task.started', 'task': 'tool_call', 'description': f'Executing {tool_id}'})}\n\n"

            tool_result = await execute_tool_via_api(tool_id, fn_args, run_id)
            tool_status = tool_result.get("status")

            if tool_status == "REQUIRES_APPROVAL":
                approval = tool_result.get("approval", {})
                yield f"data: {json.dumps({'type': 'approval.required', 'approval': approval})}\n\n"
                msg = f"\n\n**Action Requires Approval**: The requested action `{tool_id}` involves consequential side effects. A pending approval record has been generated. Please navigate to the **Approvals** tab to inspect and authorize this action."
                yield f"data: {json.dumps({'type': 'token', 'content': msg})}\n\n"

            elif tool_status == "SUCCESS":
                output_data = tool_result.get("output", {})
                yield f"data: {json.dumps({'type': 'tool.completed', 'toolId': tool_id, 'output': output_data})}\n\n"

                # Feed tool response back into Gemini to generate the final synthesized answer
                follow_up_contents = list(contents)
                follow_up_contents.append({
                    "role": "model",
                    "parts": pending_model_parts if pending_model_parts else [{"functionCall": pending_function_call}],
                })
                follow_up_contents.append({
                    "role": "user",
                    "parts": [{
                        "functionResponse": {
                            "name": fn_name,
                            "response": output_data,
                        }
                    }],
                })

                follow_up_payload = {
                    "systemInstruction": {
                        "parts": [{"text": SYSTEM_INSTRUCTION}],
                    },
                    "contents": follow_up_contents,
                }

                async with httpx.AsyncClient(timeout=45.0) as client:
                    async with client.stream("POST", gemini_url, json=follow_up_payload) as follow_up_resp:
                        if follow_up_resp.status_code == 200:
                            async for line in follow_up_resp.aiter_lines():
                                if active_runs.get(run_id, {}).get("cancelled") or await req.is_disconnected():
                                    return

                                if not line.startswith("data: "):
                                    continue

                                json_str = line[len("data: "):].strip()
                                if not json_str:
                                    continue

                                try:
                                    chunk_data = json.loads(json_str)
                                    candidates = chunk_data.get("candidates", [])
                                    if not candidates:
                                        continue
                                    parts = candidates[0].get("content", {}).get("parts", [])
                                    for part in parts:
                                        if "text" in part:
                                            yield f"data: {json.dumps({'type': 'token', 'content': part['text']})}\n\n"
                                except Exception:
                                    continue
                        else:
                            err_body = await follow_up_resp.aread()
                            err_msg = err_body.decode("utf-8", errors="replace")
                            logger.error(f"Gemini follow-up error {follow_up_resp.status_code}: {err_msg}")
                            fallback_msg = format_tool_output_fallback(tool_id, output_data)
                            yield f"data: {json.dumps({'type': 'token', 'content': fallback_msg})}\n\n"
            else:
                err_message = tool_result.get("error", "Action was denied or failed")
                yield f"data: {json.dumps({'type': 'token', 'content': f'\\n\\n[Tool execution notice: {err_message}]'})}\n\n"

        if run_id in active_runs:
            active_runs[run_id]["status"] = "COMPLETED"

        yield f"data: {json.dumps({'type': 'run.completed', 'runId': run_id, 'status': 'COMPLETED'})}\n\n"

    except Exception as exc:
        logger.error(f"Error during stream_chat_and_tools: {exc}")
        if run_id in active_runs:
            active_runs[run_id]["status"] = "FAILED"
        yield f"data: {json.dumps({'type': 'run.failed', 'runId': run_id, 'error': str(exc)})}\n\n"
