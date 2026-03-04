import { Check, X } from 'lucide-react';
import { HOUR_HEIGHT_PX } from './TimeGrid';
import { cn } from '@/lib/utils';
import type { EventProposal } from '@shared/types/ai';

interface ProposalBlockProps {
  proposal: EventProposal;
  dayIndex: number;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  isAccepted: boolean;
  isRejected: boolean;
}

export default function ProposalBlock({ proposal, dayIndex, onAccept, onReject, isAccepted, isRejected }: ProposalBlockProps) {
  if (isRejected) return null;

  let startTime: string | undefined;
  let endTime: string | undefined;
  let title = '';
  let borderColor = '#22c55e'; // green for create

  if (proposal.type === 'create') {
    startTime = proposal.event.startTime;
    endTime = proposal.event.endTime;
    title = proposal.event.title;
    borderColor = proposal.event.color || '#22c55e';
  } else if (proposal.type === 'update') {
    startTime = proposal.changes.startTime;
    endTime = proposal.changes.endTime;
    title = proposal.changes.title ?? proposal.originalTitle ?? 'Update';
    borderColor = '#3b82f6'; // blue for update
  } else {
    return null; // delete proposals don't render on grid
  }

  if (!startTime || !endTime) return null;

  const start = new Date(startTime);
  const end = new Date(endTime);
  const startMinutes = start.getHours() * 60 + start.getMinutes();
  const endMinutes = end.getHours() * 60 + end.getMinutes();
  const durationMinutes = Math.max(endMinutes - startMinutes, 15);

  const top = (startMinutes / 60) * HOUR_HEIGHT_PX;
  const height = Math.max((durationMinutes / 60) * HOUR_HEIGHT_PX, 15);
  const isTall = height >= 36;

  return (
    <div
      className={cn(
        'absolute rounded-md px-1.5 py-0.5 text-[10px] overflow-hidden group z-20',
        isAccepted && 'opacity-50',
      )}
      style={{
        top,
        height,
        gridColumn: `${dayIndex + 2} / ${dayIndex + 3}`,
        left: 2,
        right: 2,
        backgroundColor: `${borderColor}15`,
        border: `2px dashed ${borderColor}`,
        color: borderColor,
        pointerEvents: 'auto',
      }}
    >
      <div className="font-medium truncate leading-tight">{title}</div>
      {isTall && (
        <div className="truncate leading-tight opacity-70 text-[9px]">
          {start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}–
          {end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
        </div>
      )}

      {/* Accept/Reject buttons on hover */}
      {!isAccepted && (
        <div className="absolute top-0.5 right-0.5 hidden group-hover:flex items-center gap-0.5">
          <button
            onClick={(e) => { e.stopPropagation(); onAccept(proposal.id); }}
            className="p-0.5 rounded bg-green-500/20 hover:bg-green-500/40 text-green-600"
          >
            <Check className="w-3 h-3" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onReject(proposal.id); }}
            className="p-0.5 rounded bg-red-500/20 hover:bg-red-500/40 text-red-600"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}
