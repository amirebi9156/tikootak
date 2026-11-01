import { useEffect, useState } from 'react';

// نصب برنامه / تمام‌صفحه: روی گوشی بدون نصب، نوار آدرس مرورگر دیده می‌شود.
let deferred = null;
const subs = new Set();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; subs.forEach(f => f()); });
  window.addEventListener('appinstalled', () => { deferred = null; subs.forEach(f => f()); });
}
export const isStandalone = () => {
  try { return window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches || window.navigator.standalone === true; } catch { return false; }
};
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent || '');
export const isMobile = () => /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent || '');
export const canFullscreen = () => !!(document.documentElement.requestFullscreen && document.fullscreenEnabled !== false) && !isIOS();
export function usePwa() {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick(n => n + 1);
    subs.add(f);
    document.addEventListener('fullscreenchange', f);
    return () => { subs.delete(f); document.removeEventListener('fullscreenchange', f); };
  }, []);
  return {
    standalone: isStandalone(),
    ios: isIOS(),
    canInstall: !!deferred,
    fullscreen: !!document.fullscreenElement,
    canFullscreen: canFullscreen(),
    async install() { if (!deferred) return false; deferred.prompt(); try { await deferred.userChoice; } catch { /* ignore */ } deferred = null; subs.forEach(f => f()); return true; },
    async toggleFullscreen() {
      try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch { /* ignore */ }
    }
  };
}
