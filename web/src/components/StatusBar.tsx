import { useEffect, useState } from 'react';

interface Toast {
  id: string;
  message: string;
  type: 'default' | 'success' | 'error';
}

interface Props {
  message: string;
  type?: 'default' | 'success' | 'error';
}

const ICONS: Record<string, string> = {
  default: 'ℹ️',
  success: '✅',
  error:   '❌',
};

/**
 * Persistent status bar that converts the `message` prop into a sliding toast.
 * Dismisses automatically after 3 s, or immediately when a new message arrives.
 */
export function StatusBar({ message, type = 'default' }: Props) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    if (!message || message === 'Ready') return;

    const id = crypto.randomUUID();
    const toast: Toast = { id, message, type };

    setToasts((prev) => [...prev.slice(-2), toast]); // keep at most 3

    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);

    return () => clearTimeout(timer);
  }, [message, type]);

  if (toasts.length === 0) return null;

  return (
    <div className="status-bar" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`status-toast${toast.type !== 'default' ? ` ${toast.type}` : ''}`}
        >
          <span aria-hidden="true">{ICONS[toast.type]}</span>
          {toast.message}
        </div>
      ))}
    </div>
  );
}
