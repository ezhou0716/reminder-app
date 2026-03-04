import { Check, X, Paperclip } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/stores/chat-store';
import type { ChatMessage as ChatMessageType, EventProposal } from '@shared/types/ai';

interface ChatMessageProps {
  message: ChatMessageType;
}

function ProposalCard({ proposal }: { proposal: EventProposal }) {
  const { acceptProposal, rejectProposal, acceptedProposalIds, rejectedProposalIds } = useChatStore();
  const isAccepted = acceptedProposalIds.has(proposal.id);
  const isRejected = rejectedProposalIds.has(proposal.id);

  let label = '';
  let detail = '';
  let borderColor = '';

  if (proposal.type === 'create') {
    label = 'Create';
    detail = `"${proposal.event.title}" ${formatTimeRange(proposal.event.startTime, proposal.event.endTime)}`;
    borderColor = 'border-green-500';
  } else if (proposal.type === 'update') {
    label = 'Update';
    detail = `"${proposal.originalTitle ?? proposal.eventId}"`;
    if (proposal.changes.startTime || proposal.changes.endTime) {
      detail += ` → ${formatTimeRange(proposal.changes.startTime, proposal.changes.endTime)}`;
    }
    if (proposal.changes.title) {
      detail += ` → "${proposal.changes.title}"`;
    }
    borderColor = 'border-blue-500';
  } else if (proposal.type === 'delete') {
    label = 'Delete';
    detail = `"${proposal.originalTitle ?? proposal.eventId}"`;
    borderColor = 'border-red-500';
  }

  return (
    <div className={cn('border-l-2 rounded-r-md p-2 mt-1.5 bg-muted/50 text-xs', borderColor)}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="font-medium">{label}: </span>
          <span className="text-muted-foreground">{detail}</span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={() => acceptProposal(proposal.id)}
            className={cn(
              'p-0.5 rounded hover:bg-green-500/20',
              isAccepted && 'bg-green-500/20 text-green-600',
            )}
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => rejectProposal(proposal.id)}
            className={cn(
              'p-0.5 rounded hover:bg-red-500/20',
              isRejected && 'bg-red-500/20 text-red-600',
            )}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function formatTimeRange(start?: string, end?: string): string {
  const fmt = (iso?: string) => {
    if (!iso) return '?';
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };
  const dateFmt = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };
  return `${dateFmt(start)} ${fmt(start)}–${fmt(end)}`;
}

export default function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex mb-3', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed',
          isUser
            ? 'bg-[#003262] text-white'
            : 'bg-muted text-foreground',
        )}
      >
        {message.filePaths && message.filePaths.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1">
            {message.filePaths.map((fp, i) => (
              <span key={i} className="inline-flex items-center gap-0.5 text-[10px] opacity-80">
                <Paperclip className="w-2.5 h-2.5" />
                {fp.split(/[/\\]/).pop()}
              </span>
            ))}
          </div>
        )}
        <div className="whitespace-pre-wrap">{message.content}</div>
        {message.proposals?.map((p) => (
          <ProposalCard key={p.id} proposal={p} />
        ))}
      </div>
    </div>
  );
}
