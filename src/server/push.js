'use strict';

const webpush = require('web-push');

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

const enabled = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (enabled) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

function isEnabled() {
  return enabled;
}

function getPublicKey() {
  return VAPID_PUBLIC_KEY;
}

async function sendPush(subscription, payload) {
  if (!enabled) return { ok: false, reason: 'disabled' };
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return { ok: true };
  } catch (err) {
    const statusCode = Number(err?.statusCode || 0);
    return {
      ok: false,
      statusCode,
      reason: err?.message || 'send failed',
      shouldDelete: statusCode === 404 || statusCode === 410,
    };
  }
}

module.exports = {
  isEnabled,
  getPublicKey,
  sendPush,
};
