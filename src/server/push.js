'use strict';

const webpush = require('web-push');
const db = require('./db');

const DEFAULT_VAPID_SUBJECT = 'mailto:admin@example.com';
const envPublicKey = String(process.env.VAPID_PUBLIC_KEY || '').trim();
const envPrivateKey = String(process.env.VAPID_PRIVATE_KEY || '').trim();
const envSubject = String(process.env.VAPID_SUBJECT || '').trim();

let VAPID_PUBLIC_KEY = envPublicKey;
let VAPID_PRIVATE_KEY = envPrivateKey;
let VAPID_SUBJECT = envSubject || DEFAULT_VAPID_SUBJECT;

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  const stored = db.getVapidConfig();
  if (stored.publicKey && stored.privateKey) {
    VAPID_PUBLIC_KEY = stored.publicKey;
    VAPID_PRIVATE_KEY = stored.privateKey;
    VAPID_SUBJECT = envSubject || stored.subject || DEFAULT_VAPID_SUBJECT;
  }
}

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  const generated = webpush.generateVAPIDKeys();
  VAPID_PUBLIC_KEY = generated.publicKey;
  VAPID_PRIVATE_KEY = generated.privateKey;
  VAPID_SUBJECT = envSubject || DEFAULT_VAPID_SUBJECT;
  db.setVapidConfig({
    publicKey: VAPID_PUBLIC_KEY,
    privateKey: VAPID_PRIVATE_KEY,
    subject: VAPID_SUBJECT,
  });
}

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
