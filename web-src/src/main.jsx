import { createRoot } from 'react-dom/client';
import './tokens.css';
import './styles.css';
import './theme.css';
import './ui34.css';
import './tg.css';
import './q.css';
import './lg.css';
import './design.css';
import './polish.css';
import { initGlass } from './glass.js';
import { initAutoLens } from './lens.js';
import { initViewport } from './viewport.js';
import App from './App.jsx';
import { initTheme } from './ui.jsx';
import { applyLangAttrs } from './i18n.js';
import { migrateStorage } from './storage.js';

migrateStorage();
initTheme();
applyLangAttrs();
initGlass();
initAutoLens();
initViewport();

createRoot(document.getElementById('root')).render(<App />);

if ('serviceWorker' in navigator && import.meta.env.PROD && window.isSecureContext) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
