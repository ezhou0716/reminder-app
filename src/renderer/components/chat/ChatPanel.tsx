import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Trash2, Settings, X, Check, XCircle, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useChatStore } from '@/stores/chat-store';
import { useCalendarStore } from '@/stores/calendar-store';
import ChatMessage from './ChatMessage';
import ApiKeyDialog from './ApiKeyDialog';

const MIN_WIDTH = 280;
const MAX_WIDTH = 600;
const DEFAULT_WIDTH = 350;

export default function ChatPanel() {
  const {
    panelOpen, messages, streaming, streamingText, hasApiKey,
    proposals, acceptedProposalIds,
    sendMessage, clearConversation, togglePanel,
    acceptAllProposals, rejectAllProposals, executeAccepted,
  } = useChatStore();
  const { weekStart, weekEnd } = useCalendarStore();

  const [input, setInput] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<string[]>([]);
  const [showApiKeyDialog, setShowApiKeyDialog] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const scrollEndRef = useRef<HTMLDivElement>(null);
  const isResizingRef = useRef(false);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  // Resize drag handler
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    const startX = e.clientX;
    const startWidth = width;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizingRef.current) return;
      // Dragging left increases width (panel is on the right)
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + (startX - ev.clientX)));
      setWidth(newWidth);
    };

    const onMouseUp = () => {
      isResizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [width]);

  if (!panelOpen) return null;

  const handleSend = () => {
    const text = input.trim();
    if (!text || streaming) return;
    const files = attachedFiles.length > 0 ? [...attachedFiles] : undefined;
    setInput('');
    setAttachedFiles([]);
    sendMessage(text, weekStart.toISOString(), weekEnd.toISOString(), files);
  };

  const handleAttachFiles = async () => {
    const paths = await window.electronAPI.selectFiles();
    if (paths.length > 0) {
      setAttachedFiles((prev) => [...prev, ...paths]);
    }
  };

  const pendingProposals = proposals.filter(
    (p) => !acceptedProposalIds.has(p.id) && !useChatStore.getState().rejectedProposalIds.has(p.id),
  );
  const hasAccepted = acceptedProposalIds.size > 0;

  return (
    <>
      <div className="shrink-0 border-l border-border flex flex-col bg-background relative" style={{ width }}>
        {/* Resize handle */}
        <div
          className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-ring/40 active:bg-ring/60 z-10"
          onMouseDown={handleResizeMouseDown}
        />
        {/* Header */}
        <div className="h-12 border-b border-border flex items-center justify-between px-3 shrink-0">
          <span className="text-sm font-semibold">AI Scheduler</span>
          <div className="flex items-center gap-1">
            <button
              onClick={clearConversation}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
              title="Clear conversation"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setShowApiKeyDialog(true)}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
              title="API Key settings"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={togglePanel}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
              title="Close panel"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 px-3 py-3">
          {messages.length === 0 && !streaming && (
            <div className="text-xs text-muted-foreground text-center mt-8 px-4">
              <p className="mb-2 font-medium">Ask me to schedule events!</p>
              <p>"Schedule 2 hours of study time for CS 61B tomorrow afternoon"</p>
              <p className="mt-1">"Move my 3pm meeting to Thursday"</p>
              <p className="mt-1">"What's on my calendar this week?"</p>
            </div>
          )}

          {messages.map((msg) => (
            <ChatMessage key={msg.id} message={msg} />
          ))}

          {/* Streaming indicator */}
          {streaming && (
            <div className="flex justify-start mb-3">
              <div className="max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed bg-muted text-foreground">
                {streamingText ? (
                  <span className="whitespace-pre-wrap">{streamingText}<span className="inline-block w-1.5 h-3 bg-foreground/70 ml-0.5 animate-pulse" /></span>
                ) : (
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="inline-block w-1 h-1 rounded-full bg-foreground/50 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="inline-block w-1 h-1 rounded-full bg-foreground/50 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="inline-block w-1 h-1 rounded-full bg-foreground/50 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </span>
                )}
              </div>
            </div>
          )}

          <div ref={scrollEndRef} />
        </ScrollArea>

        {/* Proposal action bar */}
        {proposals.length > 0 && (
          <div className="border-t border-border px-3 py-2 flex items-center justify-between gap-2">
            <span className="text-[10px] text-muted-foreground">
              {proposals.length} proposal{proposals.length !== 1 ? 's' : ''}
            </span>
            <div className="flex items-center gap-1.5">
              {pendingProposals.length > 0 && (
                <>
                  <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={acceptAllProposals}>
                    <Check className="w-3 h-3 mr-1" />Accept All
                  </Button>
                  <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={rejectAllProposals}>
                    <XCircle className="w-3 h-3 mr-1" />Reject All
                  </Button>
                </>
              )}
              {hasAccepted && (
                <Button size="sm" className="h-6 text-[10px] px-2" onClick={executeAccepted}>
                  Apply ({acceptedProposalIds.size})
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Input */}
        <div className="border-t border-border p-3">
          {hasApiKey ? (
            <div className="flex flex-col gap-1.5">
              {attachedFiles.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {attachedFiles.map((fp, i) => (
                    <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-[10px] text-muted-foreground">
                      <Paperclip className="w-2.5 h-2.5" />
                      {fp.split(/[/\\]/).pop()}
                      <button
                        onClick={() => setAttachedFiles((prev) => prev.filter((_, j) => j !== i))}
                        className="hover:text-foreground"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleAttachFiles}
                  disabled={streaming}
                  className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-50 shrink-0"
                  title="Attach files"
                >
                  <Paperclip className="w-3.5 h-3.5" />
                </button>
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                  placeholder="Ask to schedule something..."
                  disabled={streaming}
                  className="flex-1 px-2.5 py-1.5 text-xs border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                />
                <Button
                  size="sm"
                  className="h-7 w-7 p-0 shrink-0"
                  onClick={handleSend}
                  disabled={!input.trim() || streaming}
                >
                  <Send className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={() => setShowApiKeyDialog(true)}
            >
              Set API Key to get started
            </Button>
          )}
        </div>
      </div>

      {showApiKeyDialog && (
        <ApiKeyDialog onClose={() => setShowApiKeyDialog(false)} />
      )}
    </>
  );
}
