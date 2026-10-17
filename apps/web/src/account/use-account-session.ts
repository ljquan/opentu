import { useCallback, useEffect, useState } from 'react';

export type AccountSession = {
  id: string;
  username: string;
  role: number;
};

type AccountSessionState = {
  account: AccountSession | null;
  checking: boolean;
};

async function readAccountSession(): Promise<AccountSession | null> {
  const response = await fetch('/api/session-status', {
    credentials: 'include',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('Account service unavailable');
  const payload = await response.json();
  const account = payload?.data;
  if (account === null) return null;
  if (!account?.id || typeof account.username !== 'string') {
    throw new Error('Invalid account response');
  }
  return {
    id: String(account.id),
    username: account.username,
    role: Number(account.role) || 0,
  };
}

export function useAccountSession(): AccountSessionState {
  const [state, setState] = useState<AccountSessionState>({
    account: null,
    checking: true,
  });

  const refresh = useCallback(() => {
    void readAccountSession()
      .then((account) => setState({ account, checking: false }))
      .catch(() => setState({ account: null, checking: false }));
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener('focus', refresh);
    const channel =
      typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel('opentu-account')
        : null;
    if (channel) channel.onmessage = refresh;
    return () => {
      window.removeEventListener('focus', refresh);
      channel?.close();
    };
  }, [refresh]);

  return state;
}
