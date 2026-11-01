// دکمهٔ برگشت گوشی / سوییپ از لبه: به‌جای بستن برنامه، لایهٔ بالایی (دیالوگ، چت، تب…) بسته می‌شود.
// هر لایهٔ باز یک ورودی history دارد. همگام‌سازی با تأخیر صفر انجام می‌شود تا «بستن یک لایه + باز شدن لایهٔ دیگر»
// در یک رندر، history را به‌هم نریزد.
import { useEffect, useRef } from 'react';

const stack = []; // { close }
let depth = 0; // تعداد ورودی‌هایی که خودمان در history گذاشته‌ایم
let busy = false; // یک history.go(-n) در راه است
let busyTimer = null;
let timer = null;
let wired = false;

function schedule() {
  if (timer) return;
  timer = setTimeout(sync, 0);
}
function sync() {
  timer = null;
  if (busy) return;
  try {
    if (stack.length > depth) {
      for (let i = depth + 1; i <= stack.length; i++) history.pushState({ tk: i }, '');
      depth = stack.length;
    } else if (stack.length < depth) {
      const n = depth - stack.length;
      depth = stack.length;
      busy = true;
      clearTimeout(busyTimer);
      busyTimer = setTimeout(() => { busy = false; schedule(); }, 500);
      history.go(-n);
    }
  } catch { busy = false; }
}
function onPop(e) {
  if (busy) { busy = false; clearTimeout(busyTimer); schedule(); return; }
  const target = Number(e.state?.tk || 0);
  if (target > stack.length) return; // ورودی قدیمی یا «جلو»: نادیده بگیر
  depth = target;
  while (stack.length > target) {
    const top = stack.pop();
    try { top.close(); } catch { /* ignore */ }
  }
}
function wire() {
  if (wired || typeof window === 'undefined') return;
  wired = true;
  try { if (history.state?.tk) history.replaceState(null, ''); } catch { /* ignore */ }
  window.addEventListener('popstate', onPop);
}

export function registerLayer(close) {
  wire();
  const layer = { close };
  stack.push(layer);
  schedule();
  return () => {
    const i = stack.indexOf(layer);
    if (i < 0) return; // قبلاً با دکمهٔ برگشت بسته شده
    stack.splice(i, 1);
    schedule();
  };
}
export const layerCount = () => stack.length;

// active=true یعنی این لایه باز است؛ onClose وقتی کاربر «برگشت» بزند صدا زده می‌شود.
export function useBackLayer(active, onClose) {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    if (!active) return undefined;
    return registerLayer(() => ref.current?.());
  }, [active]);
}
