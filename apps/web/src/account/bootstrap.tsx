import { createRoot } from 'react-dom/client';
import { AccountPage } from './AccountPage';
const root = document.getElementById('root');
if (!root) throw new Error('Missing account root');
createRoot(root).render(<AccountPage />);
(window as Window & { __OPENTU_BOOT__?: { markReady(): void } }).__OPENTU_BOOT__?.markReady();
