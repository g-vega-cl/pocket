import { useState, useRef, useEffect } from 'react';
import { usePocket } from '#/hooks/usePocket';
import type { SessionStatus } from '#/hooks/usePocket';

export function PocketApp() {
  const [wsUrl, setWsUrl] = useState<string>('');
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    setWsUrl(`${protocol}//${window.location.host}/ws`);
  }, []);

  const {
    connected,
    session,
    sessions,
    messages,
    isLoading,
    isThinking,
    currentToolCall,
    toolLogs,
    error,
    prUrl,
    notification,
    createSession,
    createLocalSession,
    resumeSession,
    respondToPermission,
    clone,
    createBranch,
    sendMessage,
    commit,
    createPR,
    preSetup,
    pendingPermission,
  } = usePocket(wsUrl);

  const [repoUrl, setRepoUrl] = useState('');
  const [task, setTask] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [sessionIdInput, setSessionIdInput] = useState('');
  const [selectedModel, setSelectedModel] = useState('stepfun/step-3.5-flash');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get('sessionId');
    if (sid && connected && !session) {
      resumeSession(sid);
    }
  }, [connected, resumeSession, session]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (session?.id) {
      url.searchParams.set('sessionId', session.id);
      window.history.replaceState({}, '', url.toString());
    } else if (session === null && !new URLSearchParams(window.location.search).get('sessionId')) {
      // Only clear if we explicitly have no session and no sessionId in URL
      // This avoids clearing the URL before the resumeSession effect has a chance to run
    }
  }, [session?.id]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleStart = () => {
    if (!repoUrl || !task) return;
    createSession(repoUrl, task, githubToken);
  };

  const handleStartLocal = () => {
    if (!task) return;
    createLocalSession(task);
  };

  const handleResume = () => {
    if (!sessionIdInput) return;
    resumeSession(sessionIdInput);
  };

  const handleClone = () => {
    if (!session?.id) return;
    clone(session.id);
  };

  const handleCreateBranch = () => {
    if (!session?.id) return;
    createBranch(session.id);
  };

  const handleSendMessage = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputValue.trim() || !session?.id.trim() || isLoading) return;
    sendMessage(session.id, inputValue, selectedModel);
    setInputValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const getStatusMessage = (status: SessionStatus) => {
    switch (status) {
      case 'created':
        return 'Session created. Click "Clone" to start.';
      case 'cloning':
        return 'Cloning repository...';
      case 'cloned':
        return 'Repository cloned. Click "Create Branch" to continue.';
      case 'creating_branch':
        return 'Creating branch...';
      case 'ready':
        return 'Ready! Type your task in the chat below.';
      case 'working':
        return 'Agent is working...';
      case 'done':
        return 'Ready for more!';
      case 'error':
        return 'An error occurred.';
      default:
        return '';
    }
  };

  const renderSetup = () => (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
        <h2 className="text-xl font-semibold mb-4">New Session</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">GitHub Repository URL</label>
            <input
              type="text"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://github.com/username/repo"
              className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Task Description</label>
            <textarea
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="Fix the login bug in auth.py and add tests"
              rows={3}
              className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              GitHub Token (Optional override)
            </label>
            <input
              type="password"
              value={githubToken}
              onChange={(e) => setGithubToken(e.target.value)}
              placeholder="ghp_xxxxxxxxxxxx"
              className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-1">
              Uses GITHUB_TOKEN from .env if left blank. Use this if you need to provide new
              credentials.
            </p>
          </div>
          <div className="flex gap-4">
            <button
              onClick={handleStart}
              disabled={!repoUrl || !task || isLoading}
              className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              Start Session
            </button>
            <button
              id="start-local-session"
              onClick={handleStartLocal}
              disabled={!task || isLoading}
              className="flex-1 px-6 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              Start Local Session
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
        <h2 className="text-xl font-semibold mb-4">Resume Session</h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={sessionIdInput}
            onChange={(e) => setSessionIdInput(e.target.value)}
            placeholder="Session ID"
            className="flex-1 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700"
          />
          <button
            onClick={handleResume}
            disabled={!sessionIdInput}
            className="px-6 py-2 bg-gray-600 text-white rounded-lg font-medium hover:bg-gray-700 disabled:opacity-50"
          >
            Resume
          </button>
        </div>
      </div>

      {sessions.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
          <h2 className="text-xl font-semibold mb-4">Session History</h2>
          <div className="divide-y dark:divide-gray-700">
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => resumeSession(s.id)}
                className="w-full text-left py-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition px-2 -mx-2 rounded-lg group"
              >
                <div className="flex justify-between items-start mb-1">
                  <span className="font-medium text-blue-600 dark:text-blue-400 group-hover:underline">
                    {s.task.length > 60 ? s.task.substring(0, 60) + '...' : s.task}
                  </span>
                  <span className="text-xs text-gray-400 font-mono">{s.id}</span>
                </div>
                <div className="flex justify-between items-center text-xs text-gray-500">
                  <span className="truncate max-w-[200px]">{s.repoUrl}</span>
                  <span>{new Date(s.createdAt).toLocaleString()}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const renderWorkflow = () => (
    <div className="max-w-4xl mx-auto">
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm mb-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">Current Session</h2>
            <p className="text-sm text-gray-500 font-mono">{session?.id}</p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`w-3 h-3 rounded-full ${
                connected ? 'bg-green-500' : 'bg-red-500'
              }`}
            />
            <span className="text-sm">{connected ? 'Connected' : 'Disconnected'}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm mb-4">
          <div>
            <span className="text-gray-500">Repository:</span>
            <span className="ml-2 font-mono text-xs">{session?.repoUrl}</span>
          </div>
          <div>
            <span className="text-gray-500">Branch:</span>
            <span className="ml-2 font-mono text-xs">{session?.branchName || 'Not created'}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-4">
          <span
            className={`px-3 py-1 rounded-full text-sm ${
              session?.status === 'ready'
                ? 'bg-green-100 text-green-800'
                : session?.status === 'error'
                  ? 'bg-red-100 text-red-800'
                  : 'bg-yellow-100 text-yellow-800'
            }`}
          >
            {getStatusMessage(session?.status || 'created')}
          </span>
        </div>

        {notification && (
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm font-medium text-blue-800">{notification}</p>
          </div>
        )}

        {prUrl && (
          <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-sm font-medium text-green-800 mb-1">Pull Request Created!</p>
            <a
              href={prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:text-blue-800 underline"
            >
              {prUrl}
            </a>
          </div>
        )}

        {pendingPermission && (
          <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg shadow-sm">
            <h3 className="text-lg font-semibold text-yellow-800 mb-2">Permission Required</h3>
            <p className="text-sm text-yellow-700 mb-4">{pendingPermission.reason}</p>
            <div className="bg-white/50 p-2 rounded mb-4 font-mono text-xs">
              <p>Tool: {pendingPermission.tool}</p>
              <pre className="mt-1 overflow-x-auto">{JSON.stringify(pendingPermission.args, null, 2)}</pre>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => respondToPermission(pendingPermission.requestId, true)}
                className="px-4 py-2 bg-green-600 text-white rounded font-medium hover:bg-green-700 transition"
              >
                Approve
              </button>
              <button
                onClick={() => respondToPermission(pendingPermission.requestId, false)}
                className="px-4 py-2 bg-red-600 text-white rounded font-medium hover:bg-red-700 transition"
              >
                Deny
              </button>
            </div>
          </div>
        )}

        <div className="flex gap-2">
          {!session?.localPath && (
            <button
              onClick={handleClone}
              disabled={session?.status === 'cloning'}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {session?.status === 'cloning' ? 'Cloning...' : 'Clone Repo'}
            </button>
          )}
          {session && session.localPath && !session.branchName && (
            <button
              onClick={handleCreateBranch}
              disabled={session.status === 'creating_branch'}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50"
            >
              {session.status === 'creating_branch' ? 'Creating...' : 'Create Branch'}
            </button>
          )}
          {session && session.branchName && (
             <button
              onClick={() => preSetup(session.id)}
              disabled={isLoading}
              className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50"
            >
              Pre-setup
            </button>
          )}
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {session?.status === 'ready' && (
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => commit(session.id)}
              className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
            >
              Commit
            </button>
            {!session.isLocal && (
              <button
                onClick={() => createPR(session.id)}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700"
              >
                Create PR
              </button>
            )}
            {prUrl && (
              <a
                href={prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
              >
                View PR
              </a>
            )}
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden">
        <div className="h-96 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && session && session.status === 'ready' && (
            <div className="text-center text-gray-500 py-8">
              <p className="text-lg mb-2">Ready to assist!</p>
              <p>Task: {session.task}</p>
            </div>
          )}

          {messages.map((msg, i) => {
            if (msg.role === 'tool') {
              return (
                <div key={i} className="flex justify-start opacity-60 hover:opacity-100 transition-opacity">
                  <div className="max-w-[90%] w-full rounded-xl px-4 py-1 bg-gray-100 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 text-xs">
                    <details>
                      <summary className="cursor-pointer font-mono py-1">
                        Tool Result
                      </summary>
                      <pre className="p-2 bg-black/5 rounded overflow-x-auto max-h-40 overflow-y-auto mt-1 font-mono">
                        {msg.content}
                      </pre>
                    </details>
                  </div>
                </div>
              );
            }
            return (
            <div
              key={i}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-xl px-4 py-2 ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : msg.role === 'system'
                      ? 'bg-gray-200 dark:bg-gray-700 text-sm italic'
                      : 'bg-gray-100 dark:bg-gray-700'
                }`}
              >
                {msg.role === 'assistant' && msg.reasoning && (
                  <div className="mb-2 pb-2 border-b border-gray-300 dark:border-gray-600">
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Thinking</p>
                    <pre className="whitespace-pre-wrap font-sans text-sm text-gray-600 dark:text-gray-300">{msg.reasoning}</pre>
                  </div>
                )}
                <pre className="whitespace-pre-wrap font-sans text-sm">{msg.content}</pre>
              </div>
            </div>
          );})}

          {currentToolCall && (
            <div className="flex justify-start">
              <div className="max-w-[90%] w-full rounded-xl px-4 py-2 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800">
                <div className="flex items-center gap-2 mb-2">
                  {!currentToolCall.result && (
                    <div className="animate-spin w-3 h-3 border-2 border-yellow-600 border-t-transparent rounded-full" />
                  )}
                  <p className="text-sm font-bold text-yellow-800 dark:text-yellow-200">
                    Tool: {currentToolCall.name} {currentToolCall.result ? '(Completed)' : '(Running...)'}
                  </p>
                </div>
                <details className="mb-2">
                  <summary className="text-xs text-yellow-700 dark:text-yellow-400 cursor-pointer hover:underline">
                    Arguments
                  </summary>
                  <pre className="text-xs mt-1 p-2 bg-black/5 rounded text-yellow-700 dark:text-yellow-300 font-mono overflow-x-auto">
                    {JSON.stringify(currentToolCall.args, null, 2)}
                  </pre>
                </details>
                {currentToolCall.result && (
                  <div className="mt-2 pt-2 border-t border-yellow-200 dark:border-yellow-800">
                    <p className="text-xs font-bold text-yellow-800 dark:text-yellow-200 mb-1">Result:</p>
                    <pre className="text-xs p-2 bg-black/5 rounded font-mono overflow-x-auto max-h-60 overflow-y-auto">
                      {typeof currentToolCall.result === 'string'
                        ? currentToolCall.result
                        : JSON.stringify(currentToolCall.result, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}

          {isThinking && (
            <div className="flex justify-start">
              <div className="bg-gray-100 dark:bg-gray-700 rounded-xl px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                  <span
                    className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                    style={{ animationDelay: '0.1s' }}
                  />
                  <span
                    className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                    style={{ animationDelay: '0.2s' }}
                  />
                  <span className="text-sm text-gray-500 ml-1">Thinking...</span>
                </div>
              </div>
            </div>
          )}

          {isLoading && !currentToolCall && !isThinking && (
            <div className="flex justify-start">
              <div className="bg-gray-100 dark:bg-gray-700 rounded-xl px-4 py-3">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                  <span
                    className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                    style={{ animationDelay: '0.1s' }}
                  />
                  <span
                    className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                    style={{ animationDelay: '0.2s' }}
                  />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {(session?.status === 'ready' || session?.status === 'done') && (
          <form onSubmit={handleSendMessage} className="border-t dark:border-gray-700 p-4">
            <div className="flex items-center gap-2 mb-2">
              <input
                type="text"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                placeholder="Model (e.g. stepfun/step-3.5-flash)"
                className="flex-1 px-3 py-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your message... (Enter to send, Shift+Enter for new line)"
                rows={1}
                className="flex-1 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 resize-none focus:ring-2 focus:ring-blue-500"
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={!inputValue.trim() || isLoading}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                Send
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
      {!connected && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-xl text-center max-w-sm mx-4">
            <div className="animate-spin w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Connecting to Server</h2>
            <p className="text-gray-600 dark:text-gray-400">
              Please wait while we re-establish the connection...
            </p>
          </div>
        </div>
      )}
      <div className="px-4">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Pocket</h1>
          <p className="text-gray-600 dark:text-gray-400">
            Autonomous coding agent for GitHub repositories
          </p>
        </div>

        {!session ? renderSetup() : renderWorkflow()}
      </div>
    </main>
  );
}
