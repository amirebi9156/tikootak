import { tr } from './i18n.js';
import { useCallback, useEffect, useRef, useState } from 'react';

// پخش‌کننده سراسری: یک تگ audio در Shell، صف و شماره آهنگ فعلی. با تمام شدن آهنگ، آهنگ بعدی پخش می‌شود.
export function usePlayer() {
  const audio = useRef(null);
  const [queue, setQueue] = useState([]);
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState({
    t: 0,
    d: 0
  });
  const [error, setError] = useState('');
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState('off'); // off | all | one

  const track = index >= 0 ? queue[index] : null;
  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    if (!track) {
      a.pause();
      a.removeAttribute('src');
      return;
    }
    setError('');
    a.src = track.url;
    a.play().catch(() => {});
  }, [track?.id, track?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  const play = useCallback((list, i = 0) => {
    setQueue(list);
    setIndex(i);
  }, []);
  const next = useCallback(() => setIndex(i => {
    if (shuffle && queue.length > 1) {
      let j = i;
      while (j === i) j = Math.floor(Math.random() * queue.length);
      return j;
    }
    if (i + 1 < queue.length) return i + 1;
    return repeat === 'all' ? 0 : -1;
  }), [queue.length, shuffle, repeat]);
  const onEnded = useCallback(() => {
    const a = audio.current;
    if (repeat === 'one' && a) {
      a.currentTime = 0;
      a.play().catch(() => {});
      return;
    }
    next();
  }, [repeat, next]);
  const toggleShuffle = useCallback(() => setShuffle(x => !x), []);
  const cycleRepeat = useCallback(() => setRepeat(r => r === 'off' ? 'all' : r === 'all' ? 'one' : 'off'), []);
  const prev = useCallback(() => {
    const a = audio.current;
    if (a && a.currentTime > 3) {
      a.currentTime = 0;
      return;
    }
    setIndex(i => i > 0 ? i - 1 : i);
  }, []);
  const toggle = useCallback(() => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {});else a.pause();
  }, []);
  const seek = useCallback(t => {
    if (audio.current) audio.current.currentTime = t;
  }, []);
  const stop = useCallback(() => {
    setIndex(-1);
    setQueue([]);
  }, []);
  const handlers = {
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded,
    onTimeUpdate: e => setTime({
      t: e.currentTarget.currentTime,
      d: e.currentTarget.duration || 0
    }),
    onError: () => {
      setError(tr("این آهنگ پخش نشد."));
    }
  };

  // کنترل از قفل‌صفحه/هدفون
  useEffect(() => {
    if (!('mediaSession' in navigator)) return undefined;
    if (track) navigator.mediaSession.metadata = new window.MediaMetadata({
      title: track.title,
      artist: track.artist || track.owner,
      artwork: track.cover ? [{
        src: new URL(track.cover, location.origin).href
      }] : []
    });
    navigator.mediaSession.setActionHandler('nexttrack', next);
    navigator.mediaSession.setActionHandler('previoustrack', prev);
    return undefined;
  }, [track, next, prev]);
  return {
    audio,
    handlers,
    queue,
    index,
    track,
    playing,
    time,
    error,
    shuffle,
    repeat,
    toggleShuffle,
    cycleRepeat,
    play,
    next,
    prev,
    toggle,
    seek,
    stop
  };
}