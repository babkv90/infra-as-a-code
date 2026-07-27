import { CheckCircle2, XCircle } from 'lucide-react';
import { useEffect, useRef } from 'react';

const AUTO_DISMISS_MS = 5000;

type PageAlertProps = {
  message: string;
  tone?: 'success' | 'error';
  onDismiss: () => void;
};

export function PageAlert({ message, tone = 'success', onDismiss }: PageAlertProps) {
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    const timer = window.setTimeout(() => onDismissRef.current(), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [message]);

  const Icon = tone === 'error' ? XCircle : CheckCircle2;

  return (
    <div className={`page-alert page-alert--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon size={18} />
      <span>{message}</span>
    </div>
  );
}
