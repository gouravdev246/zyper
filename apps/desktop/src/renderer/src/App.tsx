import React, { useState, useEffect } from 'react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

interface PendingApproval {
  id: string;
  action: string;
  tool: string;
  description: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'chat' | 'approvals' | 'tasks' | 'services'>('chat');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: 'Greetings. I am your **Personal AI Operator**. I can coordinate multi-step workflows, summarize emails, control approved Windows desktop tools, and draft responses. How can I assist you today?',
      timestamp: 'Just now',
    },
  ]);
  const [inputPrompt, setInputPrompt] = useState('');
  const [apiStatus, setApiStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [orchestratorStatus, setOrchestratorStatus] = useState<'checking' | 'online' | 'offline'>('checking');

  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([
    {
      id: 'appr-101',
      action: 'gmail.send',
      tool: 'Gmail Connector',
      description: 'Send weekly status report to engineering team',
      status: 'PENDING',
    },
  ]);

  // Check backend health on mount
  useEffect(() => {
    fetch('http://localhost:4000/api/v1/health')
      .then((res) => (res.ok ? setApiStatus('online') : setApiStatus('offline')))
      .catch(() => setApiStatus('offline'));

    fetch('http://localhost:8000/internal/v1/health')
      .then((res) => (res.ok ? setOrchestratorStatus('online') : setOrchestratorStatus('offline')))
      .catch(() => setOrchestratorStatus('offline'));
  }, []);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputPrompt.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: inputPrompt,
      timestamp: 'Now',
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputPrompt('');

    // Simulated operator acknowledgement & task planning response
    setTimeout(() => {
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Received goal: "${userMessage.content}". Checking connected permissions and generating structured plan...`,
        timestamp: 'Just now',
      };
      setMessages((prev) => [...prev, assistantMessage]);
    }, 600);
  };

  const handleApprovalDecision = (id: string, decision: 'APPROVED' | 'REJECTED') => {
    setPendingApprovals((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status: decision } : item))
    );
  };

  return (
    <div className="app-container">
      {/* Left Sidebar */}
      <aside className="sidebar">
        <div className="brand-section">
          <div className="brand-logo-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
              <polyline points="2 17 12 22 22 17"></polyline>
              <polyline points="2 12 12 17 22 12"></polyline>
            </svg>
          </div>
          <div>
            <h1 className="brand-title">ZYPER</h1>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>AI Operator v0.1.0</p>
          </div>
        </div>

        <nav>
          <ul className="nav-links">
            <li
              className={`nav-item ${activeTab === 'chat' ? 'active' : ''}`}
              onClick={() => setActiveTab('chat')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
              </svg>
              Operator Chat
            </li>
            <li
              className={`nav-item ${activeTab === 'approvals' ? 'active' : ''}`}
              onClick={() => setActiveTab('approvals')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
              </svg>
              Approvals ({pendingApprovals.filter((a) => a.status === 'PENDING').length})
            </li>
            <li
              className={`nav-item ${activeTab === 'tasks' ? 'active' : ''}`}
              onClick={() => setActiveTab('tasks')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
              </svg>
              Workflows & Tasks
            </li>
            <li
              className={`nav-item ${activeTab === 'services' ? 'active' : ''}`}
              onClick={() => setActiveTab('services')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
                <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
                <line x1="6" y1="6" x2="6.01" y2="6"></line>
                <line x1="6" y1="18" x2="6.01" y2="18"></line>
              </svg>
              Integrations
            </li>
          </ul>
        </nav>
      </aside>

      {/* Main Stage */}
      <main className="main-stage">
        {/* Top Header */}
        <header className="top-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <span style={{ fontSize: '0.95rem', fontWeight: 600 }}>Active Workspace: Primary Session</span>
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <div className="header-status-badge">
              <span className="status-dot"></span>
              API: {apiStatus}
            </div>
            <div className="header-status-badge" style={{ borderColor: 'rgba(99, 102, 241, 0.4)', color: 'var(--accent-indigo)' }}>
              <span className="status-dot" style={{ background: 'var(--accent-indigo)', boxShadow: '0 0 8px var(--accent-indigo)' }}></span>
              Orchestrator: {orchestratorStatus}
            </div>
          </div>
        </header>

        {/* Workspace Grid */}
        <div className="workspace-grid">
          {/* Chat Pane */}
          <section className="chat-pane">
            <div className="messages-scroll">
              {messages.map((msg) => (
                <div key={msg.id} className={`message-bubble ${msg.role}`}>
                  <div className="message-role-label">{msg.role}</div>
                  <div>{msg.content}</div>
                </div>
              ))}
            </div>

            <div className="input-dock">
              <form onSubmit={handleSendMessage} className="input-container">
                <input
                  type="text"
                  className="chat-input"
                  placeholder="Describe your goal (e.g., summarize unread emails and prepare brief)..."
                  value={inputPrompt}
                  onChange={(e) => setInputPrompt(e.target.value)}
                />
                <button type="submit" className="send-button">
                  Send Goal
                </button>
              </form>
            </div>
          </section>

          {/* Inspector / Details Pane */}
          <aside className="inspector-pane">
            {/* Pending Approvals Card */}
            <div className="panel-card">
              <div className="panel-card-title">
                <span>Pending Approvals</span>
                <span className="approval-badge">Safety Guard</span>
              </div>
              {pendingApprovals.map((appr) => (
                <div key={appr.id} className="approval-card">
                  <div style={{ fontSize: '0.84rem', fontWeight: 600 }}>{appr.description}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Tool: <code>{appr.action}</code>
                  </div>
                  {appr.status === 'PENDING' ? (
                    <div className="approval-btn-group">
                      <button className="btn-approve" onClick={() => handleApprovalDecision(appr.id, 'APPROVED')}>
                        Authorize Action
                      </button>
                      <button className="btn-reject" onClick={() => handleApprovalDecision(appr.id, 'REJECTED')}>
                        Decline
                      </button>
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.78rem', fontWeight: 600, color: appr.status === 'APPROVED' ? 'var(--accent-emerald)' : 'var(--accent-rose)' }}>
                      Decision: {appr.status}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Architecture Metrics */}
            <div className="panel-card">
              <div className="panel-card-title">System Status</div>
              <div className="metric-row">
                <span className="metric-label">Execution Engine</span>
                <span className="metric-value">LangGraph</span>
              </div>
              <div className="metric-row">
                <span className="metric-label">Persistence</span>
                <span className="metric-value">Prisma + Postgres</span>
              </div>
              <div className="metric-row">
                <span className="metric-label">Windows Companion</span>
                <span className="metric-value">Local Restricted</span>
              </div>
              <div className="metric-row">
                <span className="metric-label">Policy Status</span>
                <span className="metric-value" style={{ color: 'var(--accent-emerald)' }}>Enforced</span>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
};
