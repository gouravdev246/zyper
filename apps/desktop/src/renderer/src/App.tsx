import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  ShieldAlert,
  Workflow,
  Boxes,
  Send,
  Square,
  Plus,
  Cpu,
  CheckCircle2,
  XCircle,
  Activity,
  Sparkles,
  RefreshCw,
} from 'lucide-react';

interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

interface PendingApproval {
  id: string;
  action: string;
  tool: string;
  description: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}

const API_BASE = 'http://localhost:4000/api/v1';

export const App: React.FC = () => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputPrompt, setInputPrompt] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const [apiStatus, setApiStatus] = useState<'online' | 'offline' | 'checking'>('checking');
  const [activeTab, setActiveTab] = useState<'chat' | 'approvals' | 'tasks' | 'services'>('chat');

  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([
    {
      id: 'appr-101',
      action: 'gmail.send',
      tool: 'Gmail Connector',
      description: 'Send weekly status summary to engineering lead',
      status: 'PENDING',
    },
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load conversations and health check on mount
  useEffect(() => {
    checkHealth();
    fetchConversations();
  }, []);

  // When active conversation changes, fetch its messages
  useEffect(() => {
    if (activeConversationId) {
      fetchMessages(activeConversationId);
    } else {
      setMessages([]);
    }
  }, [activeConversationId]);

  const checkHealth = async () => {
    try {
      const res = await fetch(`${API_BASE}/health`);
      setApiStatus(res.ok ? 'online' : 'offline');
    } catch {
      setApiStatus('offline');
    }
  };

  const fetchConversations = async () => {
    try {
      const res = await fetch(`${API_BASE}/conversations`);
      const data = await res.json();
      if (data.success && data.data) {
        setConversations(data.data);
        if (data.data.length > 0 && !activeConversationId) {
          setActiveConversationId(data.data[0].id);
        } else if (data.data.length === 0) {
          handleNewConversation();
        }
      }
    } catch {
      // Fallback local conversation
      const fallback: Conversation = {
        id: 'local-init',
        title: 'Initial Workspace Session',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setConversations([fallback]);
      setActiveConversationId(fallback.id);
    }
  };

  const fetchMessages = async (convoId: string) => {
    try {
      const res = await fetch(`${API_BASE}/conversations/${convoId}/messages`);
      const data = await res.json();
      if (data.success && data.data) {
        setMessages(data.data);
      }
    } catch {
      setMessages([
        {
          id: 'welcome',
          role: 'assistant',
          content: 'Zyper Personal AI Operator initialized. Ready to execute workflows.',
        },
      ]);
    }
  };

  const handleNewConversation = async () => {
    try {
      const res = await fetch(`${API_BASE}/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Operator Goal' }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        setConversations((prev) => [data.data, ...prev]);
        setActiveConversationId(data.data.id);
        setMessages([]);
      }
    } catch {
      const fallback: Conversation = {
        id: `convo-${Date.now()}`,
        title: 'New Workspace Goal',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setConversations((prev) => [fallback, ...prev]);
      setActiveConversationId(fallback.id);
      setMessages([]);
    }
  };

  const handleCancelRun = async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    if (activeConversationId) {
      try {
        await fetch(`${API_BASE}/conversations/${activeConversationId}/cancel`, { method: 'POST' });
      } catch {
        // ignore error
      }
    }
    setIsStreaming(false);
    setActiveRunId(null);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputPrompt.trim() || isStreaming) return;

    let targetConvoId = activeConversationId;
    if (!targetConvoId) {
      const newConvo: Conversation = {
        id: `convo-${Date.now()}`,
        title: inputPrompt.slice(0, 30),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setConversations((prev) => [newConvo, ...prev]);
      setActiveConversationId(newConvo.id);
      targetConvoId = newConvo.id;
    }

    const currentPrompt = inputPrompt;
    setInputPrompt('');

    // Optimistically append user message
    const tempUserMsg: Message = {
      id: `usr-${Date.now()}`,
      role: 'user',
      content: currentPrompt,
    };

    // Placeholder assistant message for streaming tokens
    const tempAssistantMsg: Message = {
      id: `ast-${Date.now()}`,
      role: 'assistant',
      content: '',
    };

    setMessages((prev) => [...prev, tempUserMsg, tempAssistantMsg]);
    setIsStreaming(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await fetch(`${API_BASE}/conversations/${targetConvoId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: currentPrompt }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error('Failed to stream response from API');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let streamedContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const eventData = JSON.parse(line.replace('data: ', ''));

              if (eventData.type === 'run.created') {
                setActiveRunId(eventData.runId);
              }

              if (eventData.type === 'token' && typeof eventData.content === 'string') {
                streamedContent += eventData.content;
                setMessages((prev) => {
                  const updated = [...prev];
                  const lastIndex = updated.length - 1;
                  if (lastIndex >= 0 && updated[lastIndex].role === 'assistant') {
                    updated[lastIndex] = {
                      ...updated[lastIndex],
                      content: streamedContent,
                    };
                  }
                  return updated;
                });
              }

              if (eventData.type === 'run.completed' || eventData.type === 'run.cancelled') {
                setIsStreaming(false);
                setActiveRunId(null);
              }
            } catch {
              // ignore parse errors on fragmented events
            }
          }
        }
      }
    } catch (err: unknown) {
      if ((err as Error)?.name === 'AbortError') {
        setMessages((prev) => {
          const updated = [...prev];
          const lastIndex = updated.length - 1;
          if (lastIndex >= 0 && updated[lastIndex].role === 'assistant') {
            updated[lastIndex].content += '\n\n*(Run cancelled by user)*';
          }
          return updated;
        });
      } else {
        setMessages((prev) => {
          const updated = [...prev];
          const lastIndex = updated.length - 1;
          if (lastIndex >= 0 && updated[lastIndex].role === 'assistant') {
            updated[lastIndex].content = 'Error connecting to orchestration API. Please ensure the backend is running.';
          }
          return updated;
        });
      }
    } finally {
      setIsStreaming(false);
      setActiveRunId(null);
      abortControllerRef.current = null;
    }
  };

  const handleApprovalDecision = (id: string, decision: 'APPROVED' | 'REJECTED') => {
    setPendingApprovals((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status: decision } : item))
    );
  };

  return (
    <div className="flex h-screen w-screen bg-[#07090e] text-slate-100 font-sans">
      {/* Left Sidebar */}
      <aside className="w-64 bg-[#0d111a] border-r border-white/10 flex flex-col justify-between p-4">
        <div className="space-y-6">
          {/* Logo & Brand */}
          <div className="flex items-center gap-3 px-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-indigo-500/30">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
                ZYPER
              </h1>
              <p className="text-[10px] text-slate-400 tracking-wider font-semibold uppercase">Personal AI Operator</p>
            </div>
          </div>

          {/* New Session Button */}
          <button
            onClick={handleNewConversation}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded-lg text-xs font-semibold transition-all duration-200"
          >
            <Plus className="w-4 h-4" />
            New Goal Workflow
          </button>

          {/* Navigation Links */}
          <nav className="space-y-1">
            <button
              onClick={() => setActiveTab('chat')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                activeTab === 'chat'
                  ? 'bg-indigo-600/20 text-white border border-indigo-500/40 shadow-sm shadow-indigo-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              Operator Chat
            </button>
            <button
              onClick={() => setActiveTab('approvals')}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                activeTab === 'approvals'
                  ? 'bg-indigo-600/20 text-white border border-indigo-500/40 shadow-sm shadow-indigo-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
            >
              <div className="flex items-center gap-3">
                <ShieldAlert className="w-4 h-4" />
                Approvals
              </div>
              {pendingApprovals.filter((a) => a.status === 'PENDING').length > 0 && (
                <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                  {pendingApprovals.filter((a) => a.status === 'PENDING').length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('tasks')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                activeTab === 'tasks'
                  ? 'bg-indigo-600/20 text-white border border-indigo-500/40 shadow-sm shadow-indigo-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
            >
              <Workflow className="w-4 h-4" />
              Workflows & Tasks
            </button>
            <button
              onClick={() => setActiveTab('services')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                activeTab === 'services'
                  ? 'bg-indigo-600/20 text-white border border-indigo-500/40 shadow-sm shadow-indigo-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
            >
              <Boxes className="w-4 h-4" />
              Connected Tools
            </button>
          </nav>

          {/* Conversation History List */}
          <div className="pt-2">
            <span className="text-[11px] font-semibold text-slate-500 tracking-wider uppercase px-2">History</span>
            <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
              {conversations.map((c) => (
                <div
                  key={c.id}
                  onClick={() => setActiveConversationId(c.id)}
                  className={`px-3 py-2 rounded-md text-xs truncate cursor-pointer transition-colors ${
                    activeConversationId === c.id
                      ? 'bg-white/10 text-slate-100 font-medium'
                      : 'text-slate-400 hover:text-slate-300 hover:bg-white/5'
                  }`}
                >
                  {c.title}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* System Status in Footer */}
        <div className="pt-4 border-t border-white/5 space-y-2">
          <div className="flex items-center justify-between text-xs px-2 text-slate-400">
            <span className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${apiStatus === 'online' ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`} />
              API Server
            </span>
            <span className="text-[11px] font-mono text-slate-500">{apiStatus}</span>
          </div>
        </div>
      </aside>

      {/* Main Chat & Workflow Area */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Header Bar */}
        <header className="h-14 border-b border-white/10 bg-[#0d111a]/70 backdrop-blur-md px-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-slate-200">
              {conversations.find((c) => c.id === activeConversationId)?.title || 'Current Session'}
            </h2>
            {isStreaming && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 animate-pulse">
                <Activity className="w-3 h-3" />
                Active Run
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={checkHealth}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-colors"
              title="Refresh Health"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Content Layout */}
        <div className="flex-1 flex overflow-hidden">
          {/* Messages Feed */}
          <section className="flex-1 flex flex-col justify-between border-r border-white/10">
            {/* Scrollable Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex flex-col max-w-[80%] rounded-xl p-4 text-sm leading-relaxed transition-all ${
                    m.role === 'user'
                      ? 'ml-auto bg-gradient-to-r from-indigo-600 to-indigo-700 text-white rounded-br-none shadow-md shadow-indigo-600/20'
                      : 'mr-auto bg-[#121826] border border-white/10 text-slate-200 rounded-bl-none'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5 text-[10px] font-bold tracking-wider uppercase text-slate-400">
                    <span>{m.role}</span>
                  </div>
                  <div className="whitespace-pre-wrap">{m.content || (isStreaming ? 'Thinking...' : '')}</div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Dock */}
            <div className="p-4 bg-[#0d111a]/60 border-t border-white/10 backdrop-blur-md">
              <form onSubmit={handleSendMessage} className="flex items-center gap-2 bg-[#07090e] border border-white/10 rounded-xl px-3 py-1.5 focus-within:border-indigo-500 transition-colors">
                <input
                  type="text"
                  value={inputPrompt}
                  onChange={(e) => setInputPrompt(e.target.value)}
                  placeholder="Enter a task (e.g. Read unread emails, draft replies, check calendar)..."
                  disabled={isStreaming}
                  className="flex-1 bg-transparent border-none outline-none text-sm text-slate-100 placeholder:text-slate-500 py-1.5 px-2"
                />

                {isStreaming ? (
                  <button
                    type="button"
                    onClick={handleCancelRun}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600/20 text-rose-300 border border-rose-500/30 hover:bg-rose-600/30 text-xs font-semibold transition-all"
                  >
                    <Square className="w-3.5 h-3.5 fill-rose-300" />
                    Cancel
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 transition-all"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Send
                  </button>
                )}
              </form>
            </div>
          </section>

          {/* Right Panel: Pending Approvals & Inspector */}
          <aside className="w-80 bg-[#0d111a]/80 p-5 flex flex-col gap-5 overflow-y-auto">
            {/* Approvals Safety Card */}
            <div className="p-4 rounded-xl bg-slate-900/60 border border-white/10 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-amber-400" />
                  Action Guard
                </span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
                  Approval Required
                </span>
              </div>

              {pendingApprovals.map((appr) => (
                <div key={appr.id} className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 space-y-2">
                  <p className="text-xs font-medium text-slate-200">{appr.description}</p>
                  <p className="text-[11px] font-mono text-slate-400">Action: {appr.action}</p>

                  {appr.status === 'PENDING' ? (
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => handleApprovalDecision(appr.id, 'APPROVED')}
                        className="flex-1 flex items-center justify-center gap-1 py-1 px-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Approve
                      </button>
                      <button
                        onClick={() => handleApprovalDecision(appr.id, 'REJECTED')}
                        className="flex-1 flex items-center justify-center gap-1 py-1 px-2 rounded bg-white/5 hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 border border-white/10 text-xs font-semibold transition-colors"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        Decline
                      </button>
                    </div>
                  ) : (
                    <div className={`text-xs font-semibold ${appr.status === 'APPROVED' ? 'text-emerald-400' : 'text-rose-400'}`}>
                      Decision: {appr.status}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Architecture Metrics */}
            <div className="p-4 rounded-xl bg-slate-900/60 border border-white/10 space-y-3">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <Cpu className="w-4 h-4 text-indigo-400" />
                Runtime Specs
              </span>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-white/5">
                  <span className="text-slate-400">Orchestrator</span>
                  <span className="font-mono text-slate-200">FastAPI + LangGraph</span>
                </div>
                <div className="flex justify-between py-1 border-b border-white/5">
                  <span className="text-slate-400">Persistence</span>
                  <span className="font-mono text-slate-200">Prisma (17 Tables)</span>
                </div>
                <div className="flex justify-between py-1 border-b border-white/5">
                  <span className="text-slate-400">Desktop Security</span>
                  <span className="font-mono text-emerald-400">Isolated & Sandboxed</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-400">Active Run</span>
                  <span className="font-mono text-indigo-300">{activeRunId ? activeRunId.slice(0, 8) : 'Idle'}</span>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
};
