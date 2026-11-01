import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// فونت‌ها از داخل خود برنامه می‌آیند، نه از اینترنت
import '@fontsource-variable/vazirmatn';
import '@fontsource/lalezar/arabic-400.css';
import './styles.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
