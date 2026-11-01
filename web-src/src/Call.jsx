import { tr, locale } from './i18n.js';
import { useEffect, useRef } from 'react';
import { Track } from 'livekit-client';
import { Icon } from './icons.jsx';
import { Avatar } from './ui.jsx';
function Tile({
  p,
  source,
  label,
  local
}) {
  const videoRef = useRef(null);
  const pub = p.getTrackPublication(source);
  const track = pub?.track;
  const showVideo = !!track && !pub.isMuted;
  const isScreen = source === Track.Source.ScreenShare;
  const micOff = !isScreen && !p.isMicrophoneEnabled;
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !track) return undefined;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track, showVideo]);
  return <div className={`tile ${p.isSpeaking && !isScreen ? 'speaking' : ''} ${isScreen ? 'screen' : ''}`} data-testid="tile">
      {showVideo ? <video ref={videoRef} autoPlay playsInline muted className={local && !isScreen ? 'mirror' : ''} /> : <div className="tile-avatar"><Avatar name={label} id={p.identity} size={72} /></div>}
      <span className="tile-name">
        {micOff && <Icon n="micoff" size={14} />}
        {isScreen ? tr("صفحه {0}", [label]) : label}{local && !isScreen ? tr(" (تو)") : ''}
      </span>
    </div>;
}
function Ctl({
  on,
  off,
  soft,
  label,
  onClick,
  danger
}) {
  return <button className={`ctl ${off && !soft ? 'is-off' : ''} ${danger ? 'danger' : ''}`} onClick={onClick} aria-label={label} title={label}>
      {danger ? <Icon n="phone" size={22} /> : <Icon n={off ? `${on}off` : on} size={22} />}
    </button>;
}
export default function CallView({
  call,
  nameOf,
  onClose
}) {
  const {
    info,
    room
  } = call;
  const lp = room?.localParticipant;
  const parts = room ? [room.localParticipant, ...room.remoteParticipants.values()] : [];
  const canScreen = !!navigator.mediaDevices?.getDisplayMedia;
  const audioBlocked = room && !room.canPlaybackAudio;
  const tiles = [];
  for (const p of parts) {
    const local = p === room.localParticipant;
    const label = nameOf(p.identity);
    tiles.push(<Tile key={p.identity} p={p} source={Track.Source.Camera} label={label} local={local} />);
    if (p.getTrackPublication(Track.Source.ScreenShare)?.track) {
      tiles.push(<Tile key={`${p.identity}-screen`} p={p} source={Track.Source.ScreenShare} label={label} local={local} />);
    }
  }
  return <section className="call" aria-label={tr("تماس گروهی")}>
      <header className="call-head">
        <button className="ghost" onClick={onClose}>{tr("بازگشت به چت")}</button>
        <strong>{info.title}</strong>
        <span className="muted">{info.status === 'connecting' ? tr("در حال اتصال…") : tr("{0} نفر در تماس", [parts.length.toLocaleString(locale)])}</span>
      </header>

      {info.status === 'error' && <div className="call-note error" role="alert">{info.error}</div>}
      {info.micError && <div className="call-note" role="status">{info.micError}</div>}
      {audioBlocked && <div className="call-note">
          {tr("مرورگر پخش صدا را مسدود کرده.")}
          <button className="small primary" onClick={call.startAudio}>{tr("فعال‌سازی صدا")}</button>
        </div>}

      <div className="grid" data-count={tiles.length}>
        {tiles}
        {info.status === 'connecting' && <p className="muted center">{tr("در حال اتصال به تماس…")}</p>}
      </div>

      <footer className="call-controls">
        {info.status === 'error' ? <button className="primary" onClick={() => call.join(info.roomId, info.title)}>{tr("تلاش دوباره")}</button> : <>
            <Ctl on="mic" off={!lp?.isMicrophoneEnabled} label={lp?.isMicrophoneEnabled ? tr("خاموش کردن میکروفون") : tr("روشن کردن میکروفون")} onClick={() => call.toggle('mic')} />
            <Ctl on="cam" soft off={!lp?.isCameraEnabled} label={lp?.isCameraEnabled ? tr("خاموش کردن دوربین") : tr("روشن کردن دوربین")} onClick={() => call.toggle('cam')} />
            {canScreen && <button className={`ctl ${lp?.isScreenShareEnabled ? 'is-live' : ''}`} aria-label={lp?.isScreenShareEnabled ? tr("توقف اشتراک صفحه") : tr("اشتراک صفحه")} title={tr("اشتراک صفحه")} onClick={() => call.toggle('screen')}>
                <Icon n="screen" size={22} />
              </button>}
            <Ctl danger label={tr("قطع تماس")} onClick={call.leave} />
          </>}
      </footer>
    </section>;
}