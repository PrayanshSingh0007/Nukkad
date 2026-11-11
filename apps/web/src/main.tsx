import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Root } from './ui/Root.tsx';
import './ui/ui.css';

/**
 * The game page.  /          → home: pick a name, start a Nukkad (?lat=&lng= picks the spot)
 *                 /r/<room>  → an invite link: pick a name, join.   Option: ?q=low|medium|high
 */
createRoot(document.getElementById('ui') as HTMLElement).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
