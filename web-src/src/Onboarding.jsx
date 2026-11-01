import { tr } from './i18n.js';
import { useState } from 'react';
import { Icon } from './icons.jsx';
import { Logo, LangSwitch } from './ui.jsx';
import { getItem, setItem } from './storage.js';
const KEY = 'tikootak.onboarded';
export const seenOnboarding = () => {
  try {
    return !!getItem(KEY);
  } catch {
    return true;
  }
};
const SLIDES = [{
  icon: 'chat',
  title: tr("با دوستات در ارتباط باش"),
  text: tr("چت، تماس صوتی و تصویری، گروه‌های خصوصی و پیام‌های رمزنگاری‌شده؛ همه‌چیز در یک جا.")
}, {
  icon: 'film',
  title: tr("لحظه‌هات رو به اشتراک بذار"),
  text: tr("ویدیو و عکس بذار، استوری ۲۴ ساعته بساز و ببین دوستات چه خبرن.")
}, {
  icon: 'music',
  title: tr("موسیقی همیشه با توست"),
  text: tr("پلی‌لیست شخصی یا عمومی بساز و با دوستانت به اشتراک بذار.")
}];
export default function Onboarding({
  onDone
}) {
  const [i, setI] = useState(0);
  const last = i === SLIDES.length - 1;
  const finish = () => {
    setItem(KEY, '1');
    onDone();
  };
  const s = SLIDES[i];
  return <main className="onb">
      <header>
        <Logo size={26} /><LangSwitch />
        <button className="ghost small" onClick={finish}>{tr("رد کردن")}</button>
      </header>
      <div className="onb-art" key={i} aria-hidden="true">
        <span className="orb o1" /><span className="orb o2" /><span className="orb o3" />
        <div className="onb-icon"><Icon n={s.icon} size={72} /></div>
      </div>
      <section className="onb-text">
        <h1>{s.title}</h1>
        <p>{s.text}</p>
      </section>
      <footer>
        <div className="dots" aria-hidden="true">{SLIDES.map((_, k) => <i key={k} className={k === i ? 'on' : ''} />)}</div>
        <div className="onb-btns">
          {i > 0 && <button className="round ghost-round" onClick={() => setI(i - 1)} aria-label={tr("قبلی")}><Icon n="back" /></button>}
          <button className="round" onClick={() => last ? finish() : setI(i + 1)} aria-label={last ? tr("شروع") : tr("بعدی")}>
            <span style={{
            display: 'inline-flex',
            transform: 'scaleX(-1)'
          }}><Icon n="back" /></span>
          </button>
        </div>
      </footer>
    </main>;
}