import { tr } from './i18n.js';
import { useEffect, useRef, useState } from 'react';
import { Dialog } from './ui.jsx';
import { Icon } from './icons.jsx';

// Avatar crop editor: drag to move, wheel / slider / pinch to zoom, rotate 90°. Output is a square JPEG (EXIF-free, drawn on canvas).
const STAGE = 288;

function rotate90(src) {
  const c = document.createElement('canvas');
  c.width = src.height; c.height = src.width;
  const g = c.getContext('2d');
  g.translate(c.width, 0); g.rotate(Math.PI / 2);
  g.drawImage(src, 0, 0);
  return c;
}

export default function CropDialog({ file, shape = 'circle', out = 512, title, onDone, onCancel }) {
  const canvasRef = useRef(null);
  const [img, setImg] = useState(null); // ImageBitmap | canvas
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const pts = useRef(new Map());
  const pinch = useRef(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        let bmp;
        try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { bmp = await createImageBitmap(file); }
        if (!dead) setImg(bmp);
      } catch { if (!dead) setErr(tr('این فایل عکس معتبر نیست.')); }
    })();
    return () => { dead = true; };
  }, [file]);

  const base = img ? STAGE / Math.min(img.width, img.height) : 1;
  const scale = base * zoom;
  const clamp = (o, z = zoom) => {
    if (!img) return o;
    const s = base * z;
    const mx = Math.max(0, (img.width * s - STAGE) / 2), my = Math.max(0, (img.height * s - STAGE) / 2);
    return { x: Math.min(mx, Math.max(-mx, o.x)), y: Math.min(my, Math.max(-my, o.y)) };
  };

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !img) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = STAGE * dpr; c.height = STAGE * dpr;
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#000'; g.fillRect(0, 0, STAGE, STAGE);
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, STAGE / 2 + off.x - (img.width * scale) / 2, STAGE / 2 + off.y - (img.height * scale) / 2, img.width * scale, img.height * scale);
  }, [img, scale, off]);

  const setZ = (z) => { const nz = Math.min(4, Math.max(1, z)); setZoom(nz); setOff(o => clamp(o, nz)); };

  function down(e) {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.current.size === 2) { const [a, b] = [...pts.current.values()]; pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), z: zoom }; }
  }
  function move(e) {
    const p = pts.current.get(e.pointerId);
    if (!p) return;
    const nx = e.clientX, ny = e.clientY;
    pts.current.set(e.pointerId, { x: nx, y: ny });
    if (pts.current.size === 2 && pinch.current) {
      const [a, b] = [...pts.current.values()];
      setZ(pinch.current.z * (Math.hypot(a.x - b.x, a.y - b.y) / (pinch.current.d || 1)));
      return;
    }
    if (pts.current.size === 1) setOff(o => clamp({ x: o.x + (nx - p.x), y: o.y + (ny - p.y) }));
  }
  function up(e) { pts.current.delete(e.pointerId); if (pts.current.size < 2) pinch.current = null; }
  function wheel(e) { e.preventDefault?.(); setZ(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)); }

  function rotate() {
    if (!img) return;
    setImg(rotate90(img)); setZoom(1); setOff({ x: 0, y: 0 });
  }

  async function done() {
    if (!img) return;
    setBusy(true);
    try {
      const k = out / STAGE;
      const c = document.createElement('canvas');
      c.width = out; c.height = out;
      const g = c.getContext('2d');
      g.fillStyle = '#000'; g.fillRect(0, 0, out, out);
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, (STAGE / 2 + off.x - (img.width * scale) / 2) * k, (STAGE / 2 + off.y - (img.height * scale) / 2) * k, img.width * scale * k, img.height * scale * k);
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.88));
      if (!blob) throw new Error('blob');
      await onDone(blob);
    } catch { setErr(tr('برش عکس انجام نشد.')); }
    setBusy(false);
  }

  return (
    <Dialog title={title || tr('برش عکس')} onClose={onCancel}>
      <div className="crop" data-testid="crop">
        <div className={`crop-stage ${shape}`} style={{ width: STAGE, height: STAGE }}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel}>
          <canvas ref={canvasRef} style={{ width: STAGE, height: STAGE }} />
          <span className="crop-mask" aria-hidden="true" />
        </div>
        <div className="crop-ctl">
          <button type="button" className="icon" onClick={() => setZ(zoom / 1.2)} aria-label={tr('کوچک‌نمایی')}>−</button>
          <input type="range" min="1" max="4" step="0.01" value={zoom} onChange={e => setZ(Number(e.target.value))} aria-label={tr('بزرگ‌نمایی')} data-testid="crop-zoom" />
          <button type="button" className="icon" onClick={() => setZ(zoom * 1.2)} aria-label={tr('بزرگ‌نمایی')}>+</button>
          <button type="button" className="icon" onClick={rotate} aria-label={tr('چرخش')} data-testid="crop-rotate"><Icon n="rotate" size={18} /></button>
        </div>
        <p className="muted small-note">{tr('عکس را بکش و با اسلایدر یا دو انگشت اندازه‌اش را تنظیم کن.')}</p>
        {err && <p className="error" role="alert">{err}</p>}
        <div className="row">
          <button type="button" className="ghost" onClick={onCancel}>{tr('انصراف')}</button>
          <button type="button" className="primary" disabled={!img || busy} onClick={done} data-testid="crop-ok">{busy ? '…' : tr('تأیید')}</button>
        </div>
      </div>
    </Dialog>
  );
}
