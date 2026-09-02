import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, GripVertical } from 'lucide-react';
import { Tooltip } from './Tooltip';

export interface ReorderItem {
  id: string;
  /** Spoken when this item moves, so a keyboard user hears what happened. */
  label: string;
}

/**
 * Direct reordering (FRONTEND_STANDARDS §3.12).
 *
 * A numeric "order" field is not a reordering interface: it asks the author to hold the whole
 * sequence in their head and translate their intent into arithmetic. This is drag-and-drop, and —
 * with equal standing, not as a fallback — a pair of move buttons on every row, because a
 * drag-only interaction is unusable from the keyboard (§6).
 *
 * The caller owns persistence: `onReorder` receives the ids in their new order and decides what to
 * write. Nothing here assumes a particular endpoint.
 */
export function ReorderList({
  items,
  onReorder,
  renderItem,
  disabled,
  'aria-label': ariaLabel,
}: {
  items: ReorderItem[];
  onReorder: (orderedIds: string[]) => void;
  renderItem: (item: ReorderItem, index: number) => ReactNode;
  disabled?: boolean;
  'aria-label': string;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    const next = items.map((i) => i.id);
    const [moved] = next.splice(from, 1);
    if (moved) next.splice(to, 0, moved);
    onReorder(next);
  };

  const onDrop = (targetId: string) => {
    if (!draggingId || draggingId === targetId) return;
    move(
      items.findIndex((i) => i.id === draggingId),
      items.findIndex((i) => i.id === targetId),
    );
    setDraggingId(null);
    setOverId(null);
  };

  return (
    <ul aria-label={ariaLabel} className="space-y-2">
      {items.map((item, index) => (
        // Dragging is the second way to reorder, not the only one. Every row carries move up and
        // move down buttons of equal standing (see the note above the component), so nothing here
        // is mouse-only.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
        <li
          key={item.id}
          draggable={!disabled}
          onDragStart={() => setDraggingId(item.id)}
          onDragEnd={() => {
            setDraggingId(null);
            setOverId(null);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setOverId(item.id);
          }}
          onDrop={() => onDrop(item.id)}
          className={`flex items-start gap-2 rounded-lg transition-colors ${
            draggingId === item.id ? 'opacity-40' : ''
          } ${overId === item.id && draggingId !== item.id ? 'ring-2 ring-brand/40' : ''}`}
        >
          {!disabled && (
            <div className="flex shrink-0 flex-col items-center pt-2">
              <Tooltip content="Drag to reorder">
                <span
                  aria-hidden
                  className="cursor-grab rounded p-1 text-gray-300 hover:text-gray-500 active:cursor-grabbing"
                >
                  <GripVertical size={16} />
                </span>
              </Tooltip>
              <button
                type="button"
                disabled={index === 0}
                onClick={() => move(index, index - 1)}
                aria-label={`Move ${item.label} up`}
                className="rounded p-0.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <ChevronUp size={14} />
              </button>
              <button
                type="button"
                disabled={index === items.length - 1}
                onClick={() => move(index, index + 1)}
                aria-label={`Move ${item.label} down`}
                className="rounded p-0.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <ChevronDown size={14} />
              </button>
            </div>
          )}
          <div className="min-w-0 flex-1">{renderItem(item, index)}</div>
        </li>
      ))}
    </ul>
  );
}
