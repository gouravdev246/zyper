"""
LLM and Tool Calling Service for Zyper Personal AI Operator.

Supports multi-provider execution:
- Google Gemini (native REST stream)
- Nebius Token Factory / OpenAI-compatible endpoint (using openai SDK)

Handles streaming chat completions, tool execution via Express API Safe Tool
Registry, and automated fallback when provider rate limits are encountered.
"""

import os
import json
import logging
import httpx
from typing import Dict, Any, List, Optional, AsyncGenerator
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
1. When the user asks to "Open YouTube and play [song/video]" or play any music/video, IMMEDIATELY call `browser_play_youtube` with the song or video title query. Do not ask for confirmation; open and play it directly.
2. When the user asks to search the web, lookup information on internet, or find latest news, IMMEDIATELY call `web_search` with the query. Once results return, summarize findings accurately with sources.
3. When the user asks to open a specific website or URL in their browser, call `browser_open_url` with the target URL.
4. When the user asks to check, list, read, or summarize unread emails, IMMEDIATELY call `gmail_list_unread`.
5. When the user asks to check their calendar or schedule, IMMEDIATELY call `calendar_list_events`.
6. When the user asks to open an app (e.g. "open notepad", "open calculator", "launch vs code"), call `app_open` with the appropriate appId.
7. When the user asks to control media or audio (e.g. "mute volume", "pause music", "turn volume up"), call `media_control` with the corresponding action.
8. When the user asks to find or search files in a folder, call `files_search` with the target folderId (documents, downloads, desktop, workspace) and search query.
9. For consequential actions (like sending an email or booking a calendar event), make sure you have the required parameters before calling the tool.
10. Keep answers helpful, professional, polite, and well-structured with markdown.
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


async def stream_nebius_chat_and_tools(
    run_id: str,
    goal: str,
    history: Optional[List[Dict[str, Any]]],
    req: Request,
    active_runs: Dict[str, Any],
) -> AsyncGenerator[str, None]:
    """
    Streams completions from Nebius AI (OpenAI-compatible Token Factory).
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

    async for chunk in response_stream:
        if active_runs.get(run_id, {}).get("cancelled") or await req.is_disconnected():
            active_runs[run_id]["cancelled"] = True
            yield f"data: {json.dumps({'type': 'run.cancelled', 'runId': run_id})}\n\n"
            return

        if not chunk.choices:
            continue

        delta = chunk.choices[0].delta
        if delta.content:
            yield f"data: {json.dumps({'type': 'token', 'content': delta.content})}\n\n"

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

    # Process any accumulated tool calls
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
                        yield f"data: {json.dumps({'type': 'token', 'content': chunk.choices[0].delta.content})}\n\n"
            except Exception as f_err:
                logger.error(f"Nebius follow-up synthesis error: {f_err}")
                msgs = output_data.get("messages", [])
                if msgs:
                    yield f"data: {json.dumps({'type': 'token', 'content': '\n\nHere are your recent unread emails:\n'})}\n\n"
                    for m in msgs[:5]:
                        from_addr = m.get("from", "Unknown")
                        subj = m.get("subject", "(No subject)")
                        yield f"data: {json.dumps({'type': 'token', 'content': f'- **{from_addr}**: {subj}\n'})}\n\n"
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
                            msgs = output_data.get("messages", [])
                            if msgs:
                                yield f"data: {json.dumps({'type': 'token', 'content': '\n\nHere are your recent unread emails:\n'})}\n\n"
                                for m in msgs[:5]:
                                    from_addr = m.get("from", "Unknown")
                                    subj = m.get("subject", "(No subject)")
                                    yield f"data: {json.dumps({'type': 'token', 'content': f'- **{from_addr}**: {subj}\n'})}\n\n"
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
