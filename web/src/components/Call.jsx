import { useEffect, useReducer, useRef, useState } from 'react';
import { Room as LKRoom, RoomEvent, Track } from 'livekit-client';
import Avatar from './Avatar.jsx';
import Icon from './Icon.jsx';
import { rtcToken, errorText, ApiError } from '../lib/api.js';

const EVENTS = [
  RoomEvent.ParticipantConnected,
  RoomEvent.ParticipantDisconnected,
  RoomEvent.TrackSubscribed,
  RoomEvent.TrackUnsubscribed,
  RoomEvent.TrackMuted,
  RoomEvent.TrackUnmuted,
  RoomEvent.LocalTrackPublished,
  RoomEvent.LocalTrackUnpublished,
  RoomEvent.ActiveSpeakersChanged,
  RoomEvent.ConnectionStateChanged,
];

function AudioSink({ track }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!track || !el) return undefined;
    track.attach(el);
    return () => { track.detach(el); };
  }, [track]);
  return <audio ref={ref} autoPlay />;
}

function VideoView({ track, mirror }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!track || !el) return undefined;
    track.attach(el);
    return () => { track.detach(el); };
  }, [track]);
  return <video ref={ref} autoPlay playsInline muted className={mirror ? 'mirror' : ''} />;
}

function Tile({ p, name, local }) {
  const cam = p.getTrackPublication(Track.Source.Camera);
  const camTrack = cam && cam.track && !cam.isMuted ? cam.track : null;
  return (
    <div className={`tile${p.isSpeaking ? ' speaking' : ''}`}>
      {camTrack ? (
        <VideoView track={camTrack} mirror={local} />
      ) : (
        <div className="tile-avatar">
          <Avatar id={p.identity} name={name} size={72} speaking={p.isSpeaking} />
        </div>
      )}
      <div className="tile-name">
        {!p.isMicrophoneEnabled && <Icon name="micOff" size={16} label="میکروفون خاموش" />}
        <span>{local ? `${name} (تو)` : name}</span>
      </div>
    </div>
  );
}

export default function Call({ accessToken, roomId, roomName, nameOf, hidden, onLeave, onJoined }) {
  const [status, setStatus] = useState('connecting'); // connecting | connected | error | ended
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [, bump] = useReducer((x) => x + 1, 0);
  const lkRef = useRef(null);
  const joinedRef = useRef(onJoined);
  joinedRef.current = onJoined;

  useEffect(() => {
    let cancelled = false;
    setStatus('connecting');
    setError('');
    const lk = new LKRoom({ adaptiveStream: true, dynacast: true });
    lkRef.current = lk;
    EVENTS.forEach((e) => lk.on(e, bump));
    lk.on(RoomEvent.Disconnected, () => { if (!cancelled) setStatus('ended'); });

    (async () => {
      try {
        const { token } = await rtcToken(accessToken, roomId);
        if (cancelled) return;
        // آدرس را از خود صفحه می‌سازیم تا با عوض شدن دامنه یا سرور هیچ تنظیمی لازم نباشد
        const url = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/livekit`;
        await lk.connect(url, token);
        if (cancelled) { lk.disconnect(); return; }
        setStatus('connected');
        joinedRef.current?.();
        lk.startAudio().catch(() => {});
        try {
          await lk.localParticipant.setMicrophoneEnabled(true);
        } catch (e) {
          setNote(e?.name === 'NotAllowedError'
            ? 'اجازه میکروفون داده نشد. در تنظیمات مرورگر آن را فعال کن.'
            : 'میکروفونی پیدا نشد. فقط می‌توانی بشنوی.');
        }
        bump();
      } catch (e) {
        if (cancelled) return;
        setStatus('error');
        setError(e instanceof ApiError
          ? errorText(e.code)
          : 'اتصال به سرور تماس برقرار نشد. اگر روی سرور هستی، پورت‌های 7881 و 7882 باید باز باشند.');
      }
    })();

    return () => {
      cancelled = true;
      lk.disconnect();
    };
  }, [accessToken, roomId, attempt]);

  const lk = lkRef.current;
  const local = lk?.localParticipant;
  const remotes = lk ? [...lk.remoteParticipants.values()] : [];
  const micOn = !!local?.isMicrophoneEnabled;
  const camOn = !!local?.isCameraEnabled;

  async function toggle(kind) {
    setNote('');
    try {
      if (kind === 'mic') await local.setMicrophoneEnabled(!micOn);
      else await local.setCameraEnabled(!camOn);
    } catch (e) {
      setNote(e?.name === 'NotAllowedError'
        ? 'اجازه دسترسی داده نشد. در تنظیمات مرورگر آن را فعال کن.'
        : kind === 'mic' ? 'میکروفونی پیدا نشد.' : 'دوربینی پیدا نشد.');
    }
    bump();
  }

  return (
    <section className="call" hidden={hidden} aria-label={`تماس گروهی ${roomName}`}>
      {remotes.map((p) => {
        const mic = p.getTrackPublication(Track.Source.Microphone);
        return mic?.track ? <AudioSink key={p.identity} track={mic.track} /> : null;
      })}

      <div className="call-top">
        <span className="live-dot" aria-hidden="true" />
        <strong>تماس گروهی</strong>
        <span className="call-sub">
          {status === 'connecting' && 'در حال اتصال…'}
          {status === 'connected' && `${(remotes.length + 1).toLocaleString('fa-IR')} نفر در تماس`}
          {status === 'ended' && 'تماس قطع شد'}
        </span>
      </div>

      {status === 'error' && (
        <div className="call-msg">
          <p role="alert">{error}</p>
          <div className="row">
            <button className="btn" onClick={onLeave}>بستن</button>
            <button className="btn primary" onClick={() => setAttempt((a) => a + 1)}>تلاش دوباره</button>
          </div>
        </div>
      )}

      {status === 'ended' && (
        <div className="call-msg">
          <p>اتصال تماس قطع شد.</p>
          <div className="row">
            <button className="btn" onClick={onLeave}>بستن</button>
            <button className="btn primary" onClick={() => setAttempt((a) => a + 1)}>وصل شدن دوباره</button>
          </div>
        </div>
      )}

      {status === 'connected' && local && (
        <>
          <div className="tiles">
            <Tile p={local} name={nameOf(local.identity)} local />
            {remotes.map((p) => <Tile key={p.identity} p={p} name={nameOf(p.identity)} />)}
          </div>
          {remotes.length === 0 && <p className="call-wait">هنوز کسی نیامده. به بقیه بگو وارد تماس شوند.</p>}
          {note && <p className="call-note" role="status">{note}</p>}
          <div className="call-bar">
            <button className={`round${micOn ? '' : ' off'}`} onClick={() => toggle('mic')} aria-pressed={!micOn} aria-label={micOn ? 'خاموش کردن میکروفون' : 'روشن کردن میکروفون'}>
              <Icon name={micOn ? 'mic' : 'micOff'} />
            </button>
            <button className={`round${camOn ? ' on' : ''}`} onClick={() => toggle('cam')} aria-pressed={camOn} aria-label={camOn ? 'خاموش کردن دوربین' : 'روشن کردن دوربین'}>
              <Icon name={camOn ? 'video' : 'videoOff'} />
            </button>
            <button className="btn danger" onClick={onLeave}>ترک تماس</button>
          </div>
        </>
      )}
    </section>
  );
}
