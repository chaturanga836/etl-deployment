import { useEffect, useRef, useState } from 'react';

export function useDeployEvents(jobId: string | null, onComplete: (loginUrl: string) => void, onError: (msg: string) => void) {
  const [logs, setLogs] = useState<string[]>([]);
  const [phase, setPhase] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);

  useEffect(() => {
    if (!jobId) return;
    setLogs([]);
    const es = new EventSource(`/api/deploy/${jobId}/events`);

    es.addEventListener('log', (e) => {
      setLogs((prev) => [...prev, e.data]);
    });
    es.addEventListener('phase', (e) => {
      setPhase(e.data);
    });
    es.addEventListener('complete', (e) => {
      try {
        const data = JSON.parse(e.data);
        onComplete(data.login_url);
      } catch {
        onComplete('');
      }
      es.close();
    });
    es.addEventListener('error', (e) => {
      if ((e as MessageEvent).data) {
        onError((e as MessageEvent).data);
      }
      es.close();
    });

    return () => es.close();
  }, [jobId, onComplete, onError]);

  useEffect(() => {
    if (!pausedRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  return { logs, phase, bottomRef, setPaused: (v: boolean) => { pausedRef.current = v; } };
}
