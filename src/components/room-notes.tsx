import { useRef, useState } from "react";
import Markdown from "react-markdown";
import { NotebookPen } from "lucide-react";
import type { Room } from "../lib/room";
import { AgentContext } from "./agent-context";
import { useDismiss } from "./use-dismiss";

/** Header button that shows the room's shared notes and agent context in a popover. */
export function RoomNotes({
  room,
  disabled,
  onEdit,
}: {
  room?: Room;
  disabled: boolean;
  onEdit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  useDismiss(wrapper, open, () => setOpen(false));
  return (
    <div className="room-notes" ref={wrapper}>
      <button
        type="button"
        className="notes-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <NotebookPen size={15} />
        <span>Notes</span>
        {room?.notes && <i className="notes-dot" aria-label="has notes" />}
      </button>
      {open && (
        <div className="notes-popover">
          <div className="notes-heading">
            <span>Notes</span>
            <button
              type="button"
              className="text-button"
              disabled={disabled}
              onClick={() => {
                setOpen(false);
                onEdit();
              }}
            >
              Edit
            </button>
          </div>
          <div className="shared-notes">
            {room?.notes ? (
              <Markdown>{room.notes}</Markdown>
            ) : (
              <p>No notes yet. Every duck reads these.</p>
            )}
          </div>
          {room?.observe && <p className="notes-meta">Observers are on.</p>}
          {room && <AgentContext key={room.id} roomId={room.id} />}
        </div>
      )}
    </div>
  );
}
