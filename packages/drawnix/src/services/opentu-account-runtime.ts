export interface EmbeddedOpenTuAccountRuntimeSession {
  mode: 'embedded';
  credentialId: string;
  userId: number;
  parentOrigin: string;
  channel: string;
}

export interface StandaloneOpenTuAccountRuntimeSession {
  mode: 'standalone';
}

export type OpenTuAccountRuntimeSession =
  | EmbeddedOpenTuAccountRuntimeSession
  | StandaloneOpenTuAccountRuntimeSession;

type RuntimeSessionListener = () => void;

const STANDALONE_SESSION: StandaloneOpenTuAccountRuntimeSession = {
  mode: 'standalone',
};

let runtimeSession: OpenTuAccountRuntimeSession = STANDALONE_SESSION;
const listeners = new Set<RuntimeSessionListener>();

function notifyListeners(): void {
  listeners.forEach((listener) => listener());
}

export function setOpenTuAccountRuntimeSession(
  session: EmbeddedOpenTuAccountRuntimeSession
): void {
  const credentialId = session.credentialId.trim();
  const parentOrigin = session.parentOrigin.trim();
  const channel = session.channel.trim();
  if (
    session.mode !== 'embedded' ||
    !credentialId ||
    !Number.isSafeInteger(session.userId) ||
    session.userId <= 0 ||
    !parentOrigin ||
    !channel
  ) {
    throw new Error('Invalid embedded OpenTu account runtime session');
  }

  runtimeSession = {
    mode: 'embedded',
    credentialId,
    userId: session.userId,
    parentOrigin,
    channel,
  };
  notifyListeners();
}

export function clearOpenTuAccountRuntimeSession(): void {
  if (runtimeSession.mode === 'standalone') return;
  runtimeSession = STANDALONE_SESSION;
  notifyListeners();
}

export function getOpenTuAccountRuntimeSession(): OpenTuAccountRuntimeSession {
  return runtimeSession;
}

export function subscribeOpenTuAccountRuntimeSession(
  listener: RuntimeSessionListener
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
