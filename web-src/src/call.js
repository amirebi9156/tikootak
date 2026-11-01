import { tr } from './i18n.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Room, RoomEvent } from 'livekit-client';
import { rtcToken } from './api.js';
const IDLE = {
  status: 'idle',
  roomId: null,
  title: '',
  error: null,
  micError: null
};

// صدای شرکت‌کنندگان در یک div مخفی پخش می‌شود تا با عوض شدن صفحه قطع نشود
function audioHost() {
  let el = document.getElementById('tikootak-audio');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tikootak-audio';
    el.style.display = 'none';
    document.body.appendChild(el);
  }
  return el;
}
const REFRESH_ON = [RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.TrackPublished, RoomEvent.TrackUnpublished, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.ActiveSpeakersChanged, RoomEvent.AudioPlaybackStatusChanged, RoomEvent.ConnectionStateChanged];
function mediaErrorText(e) {
  const n = e?.name || '';
  if (n === 'NotAllowedError' || n === 'PermissionDeniedError') return tr("اجازه دسترسی به میکروفون یا دوربین داده نشد.");
  if (n === 'NotFoundError') return tr("میکروفون یا دوربین پیدا نشد.");
  if (!window.isSecureContext) return tr("برای میکروفون و دوربین باید سایت با HTTPS باز شود.");
  return tr("میکروفون یا دوربین روشن نشد.");
}
export function useCall(session) {
  const roomRef = useRef(null);
  const [info, setInfo] = useState(IDLE);
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick(t => t + 1), []);
  const leave = useCallback(async () => {
    const r = roomRef.current;
    roomRef.current = null;
    if (r) {
      try {
        await r.disconnect();
      } catch {/* ignore */}
    }
    audioHost().replaceChildren();
    setInfo(IDLE);
  }, []);
  const join = useCallback(async (roomId, title) => {
    if (roomRef.current) await leave();
    setInfo({
      ...IDLE,
      status: 'connecting',
      roomId,
      title
    });
    try {
      const {
        url,
        token
      } = await rtcToken(session.access_token, roomId);
      const room = new Room({
        adaptiveStream: true,
        dynacast: true
      });
      roomRef.current = room;
      const host = audioHost();
      room.on(RoomEvent.TrackSubscribed, track => {
        if (track.kind === 'audio') host.appendChild(track.attach());
      });
      room.on(RoomEvent.TrackUnsubscribed, track => {
        track.detach().forEach(el => el.remove());
      });
      room.on(RoomEvent.Disconnected, () => {
        if (roomRef.current === room) {
          roomRef.current = null;
          host.replaceChildren();
          setInfo(IDLE);
        }
      });
      REFRESH_ON.forEach(ev => room.on(ev, bump));
      await room.connect(url, token);
      if (roomRef.current !== room) return; // کاربر قبل از اتصال قطع کرد
      setInfo(i => ({
        ...i,
        status: 'connected'
      }));
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
      } catch (e) {
        setInfo(i => ({
          ...i,
          micError: mediaErrorText(e)
        }));
      }
      bump();
    } catch (e) {
      const r = roomRef.current;
      roomRef.current = null;
      if (r) {
        try {
          await r.disconnect();
        } catch {/* ignore */}
      }
      const msg = e?.code === 'not_a_member' ? tr("برای تماس باید عضو این اتاق باشی.") : e?.status === 429 ? tr("درخواست‌های زیاد. چند لحظه صبر کن.") : tr("به تماس وصل نشد. دوباره امتحان کن.");
      setInfo(i => ({
        ...i,
        status: 'error',
        error: msg
      }));
    }
  }, [session.access_token, leave, bump]);
  const toggle = useCallback(async kind => {
    const room = roomRef.current;
    if (!room) return;
    const lp = room.localParticipant;
    try {
      if (kind === 'mic') await lp.setMicrophoneEnabled(!lp.isMicrophoneEnabled);
      if (kind === 'cam') await lp.setCameraEnabled(!lp.isCameraEnabled);
      if (kind === 'screen') await lp.setScreenShareEnabled(!lp.isScreenShareEnabled);
      setInfo(i => ({
        ...i,
        micError: null
      }));
    } catch (e) {
      // لغو انتخاب صفحه در اشتراک‌گذاری خطا نیست
      if (kind === 'screen' && e?.name === 'NotAllowedError') return;
      setInfo(i => ({
        ...i,
        micError: mediaErrorText(e)
      }));
    }
    bump();
  }, [bump]);
  const startAudio = useCallback(async () => {
    try {
      await roomRef.current?.startAudio();
    } catch {/* ignore */}
    bump();
  }, [bump]);
  // اگر Shell بسته شود (خروج یا تغییر حساب) تماس و میکروفون/دوربین آزاد شوند
  useEffect(() => () => {
    const r = roomRef.current;
    roomRef.current = null;
    if (r) {
      try { r.disconnect(); } catch {/* ignore */}
    }
    audioHost().replaceChildren();
  }, []);

  return {
    info,
    room: roomRef.current,
    join,
    leave,
    toggle,
    startAudio
  };
}