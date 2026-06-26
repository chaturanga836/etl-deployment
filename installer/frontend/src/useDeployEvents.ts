import { useEffect, useRef, useState } from 'react';

export type DeployPhase = {
  key: string;
  label: string;
  progress: number;
};

const EMPTY_PHASE: DeployPhase = { key: '', label: '', progress: 0 };

function parsePhase(raw: string): DeployPhase {
  try {
    const data = JSON.parse(raw) as DeployPhase;
    if (data.label && typeof data.progress === 'number') {
      return data;
    }
  } catch {
    // legacy plain-text phase
  }
  return { key: raw, label: raw.replace(/_/g, ' '), progress: 0 };
}

export function useDeployEvents(
  jobId: string | null,
  onComplete: (loginUrl: string) => void,
  onError: (msg: string) => void,
) {
  const [logs, setLogs] = useState<string[]>([]);
  const [phase, setPhase] = useState<DeployPhase>(EMPTY_PHASE);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);

  useEffect(() => {
    if (!jobId) return;
    setLogs([]);
    setPhase(EMPTY_PHASE);
    const es = new EventSource(`/api/deploy/${jobId}/events`);

    es.addEventListener('log', (e) => {
      setLogs((prev) => [...prev, e.data]);
    });
    es.addEventListener('phase', (e) => {
      setPhase(parsePhase(e.data));
    });
    es.addEventListener('complete', (e) => {
      setPhase({ key: 'complete', label: 'Installation complete', progress: 100 });
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

  return {
    logs,
    phase,
    bottomRef,
    setPaused: (v: boolean) => {
      pausedRef.current = v;
    },
  };
}
