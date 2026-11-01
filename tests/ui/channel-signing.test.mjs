// تست منطق state event «امضای پیام‌ها» در کانال. UI واقعی Playwright در این محیط اجرا نشد.
import test from 'node:test';
import assert from 'node:assert/strict';
import { channelSigning, CHANNEL_SIGNING_EVENT } from '../../web-src/src/roomtype.js';

function roomWith(type, content) {
  return {
    currentState: {
      getStateEvents(t, key) {
        if (t !== type || key !== '') return null;
        return { getContent: () => content };
      },
    },
  };
}

test('channel signing defaults off', () => {
  assert.equal(channelSigning({ currentState: { getStateEvents: () => null } }), false);
  assert.equal(channelSigning(roomWith(CHANNEL_SIGNING_EVENT, {})), false);
  assert.equal(channelSigning(roomWith(CHANNEL_SIGNING_EVENT, { enabled: false })), false);
});

test('channel signing honors the current state event and legacy name', () => {
  assert.equal(channelSigning(roomWith(CHANNEL_SIGNING_EVENT, { enabled: true })), true);
  assert.equal(channelSigning(roomWith('ir.tikotak.channel_signing', { enabled: true })), true);
});
