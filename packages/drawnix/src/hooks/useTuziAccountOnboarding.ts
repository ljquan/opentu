import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { DrawnixState } from './use-drawnix';
import {
  getTuziBridgeContext,
  requestTuziParentContext,
  TUZI_BRIDGE_EVENT,
} from '../services/tuzi-postmessage-bridge';
import { syncTuziSessionProviders } from '../services/tuzi-session-provider-sync';

// Lives with the canvas: the settings dialog is only mounted after it opens.
export function useTuziAccountOnboarding(
  setAppState: Dispatch<SetStateAction<DrawnixState>>
): void {
  const promptedAccount = useRef('');
  useEffect(() => {
    let active = true;
    const sync = () => {
      if (!active) return;
      const context = getTuziBridgeContext();
      if (context?.status === 'ready') {
        promptedAccount.current = '';
        // The app can start before the iframe handshake completes. Re-run the
        // provider sync after the account identity is known so persisted
        // groups and model catalogs are restored on reload.
        void syncTuziSessionProviders();
      }
      if (
        context?.status !== 'need_system_token' ||
        promptedAccount.current === context.userId
      )
        return;
      promptedAccount.current = context.userId;
      setAppState((current) => ({ ...current, openSettings: true }));
    };
    window.addEventListener(TUZI_BRIDGE_EVENT, sync);
    const handleFocus = () => {
      if (getTuziBridgeContext()?.status === 'ready') sync();
    };
    window.addEventListener('focus', handleFocus);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') handleFocus();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    if (window.parent !== window) void requestTuziParentContext().then(sync);
    sync();
    return () => {
      active = false;
      window.removeEventListener(TUZI_BRIDGE_EVENT, sync);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [setAppState]);
}
