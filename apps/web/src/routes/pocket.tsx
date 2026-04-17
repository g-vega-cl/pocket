import { createFileRoute } from '@tanstack/react-router';
import { useState, useRef, useEffect } from 'react';
import { usePocket, type SessionStatus } from '#/hooks/usePocket';

export const Route = createFileRoute('/pocket')({
  component: PocketApp,
});

function PocketApp() {
  const [wsUrl, setWsUrl] = useState<string>('');

  useEffect(() => {
    setWsUrl(`ws://${window.location.host}/ws`);
  }, []);

  const {
    connected,
    session,
    messages,
    isLoading,
    currentToolCall,
    error,
    prUrl,
    createSession,
    resumeSession,
    clone,
    createBranch,
    sendMessage,
  } = usePocket(wsUrl);

  const [repoUrl, setRepoUrl] = useState('');
  const [task, setTask] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [sessionIdInput, setSessionIdInput] = useState('');
  const [selectedModel, setSelectedModel] = useState('minimax/minimax-m2.5:free');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleStart = () => {
    if (!repoUrl || !task) return;
    createSession(repoUrl, task);
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
    if (!inputValue.trim() || !session?.id || isLoading) return;
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
        return 'Task complete! Check for PR link above.';
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
          <button
            onClick={handleStart}
            disabled={!repoUrl || !task || isLoading}
            className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            Start Session
          </button>
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
          {session?.localPath && !session?.branchName && (
            <button
              onClick={handleCreateBranch}
              disabled={session?.status === 'creating_branch'}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50"
            >
              {session?.status === 'creating_branch' ? 'Creating...' : 'Create Branch'}
            </button>
          )}
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden">
        <div className="h-96 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && session?.status === 'ready' && (
            <div className="text-center text-gray-500 py-8">
              <p className="text-lg mb-2">Ready to assist!</p>
              <p>Task: {session?.task}</p>
            </div>
          )}

          {messages.map((msg, i) => (
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
                <pre className="whitespace-pre-wrap font-sans text-sm">{msg.content}</pre>
              </div>
            </div>
          ))}

          {currentToolCall && (
            <div className="flex justify-start">
              <div className="max-w-[80%] rounded-xl px-4 py-2 bg-yellow-100 dark:bg-yellow-900">
                <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                  Tool: {currentToolCall.name}
                </p>
                <pre className="text-xs mt-1 text-yellow-700 dark:text-yellow-300 font-mono">
                  {JSON.stringify(currentToolCall.args, null, 2)}
                </pre>
                {currentToolCall.result && (
                  <div className="mt-2 pt-2 border-t border-yellow-300">
                    <p className="text-xs font-medium">Result:</p>
                    <pre className="text-xs mt-1 font-mono overflow-x-auto">
                      {JSON.stringify(currentToolCall.result, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}

          {isLoading && !currentToolCall && (
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
                placeholder="Model (e.g. minimax/minimax-m2.5:free)"
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
