/**
 * Zero-dependency Web Push (VAPID ES256 JWT + RFC 8291 aes128gcm) sender.
 *
 * Uses Node's built-in `crypto` + `fetch`, avoiding extra third-party runtime
 * dependencies while staying 100% compatible with iOS Safari 16.4+ Home Screen
 * Web Push and desktop/Android Chromium push endpoints.
 */

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

export interface VapidKeyPair {
  publicKey: string // base64url uncompressed 65-byte P-256 point
  privateKeyPem: string
  subject: string
}

let cachedKeys: VapidKeyPair | null = null

function base64UrlEncode(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlDecode(str: string): Buffer {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4))
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

export function generateVapidKeyPair(subject = 'mailto:camp@vanilla-srs.local'): VapidKeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwkPub = publicKey.export({ format: 'jwk' }) as { x: string; y: string }
  const uncompressed = Buffer.concat([
    Buffer.from([0x04]),
    base64UrlDecode(jwkPub.x),
    base64UrlDecode(jwkPub.y),
  ])
  const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }) as string
  return {
    publicKey: base64UrlEncode(uncompressed),
    privateKeyPem,
    subject,
  }
}

export function getVapidKeys(): VapidKeyPair {
  if (cachedKeys) return cachedKeys

  const envPub = process.env.VAPID_PUBLIC_KEY?.trim()
  const envPriv = process.env.VAPID_PRIVATE_KEY?.trim()
  const subject = process.env.VAPID_SUBJECT?.trim() || 'mailto:camp@vanilla-srs.local'
  if (envPub && envPriv) {
    // Support either PEM or base64url raw 32-byte private key
    let privateKeyPem = envPriv
    if (!envPriv.includes('BEGIN')) {
      const pubBytes = base64UrlDecode(envPub)
      const privBytes = base64UrlDecode(envPriv)
      const keyObj = crypto.createPrivateKey({
        key: {
          kty: 'EC',
          crv: 'P-256',
          x: base64UrlEncode(pubBytes.subarray(1, 33)),
          y: base64UrlEncode(pubBytes.subarray(33, 65)),
          d: base64UrlEncode(privBytes),
        },
        format: 'jwk',
      })
      privateKeyPem = keyObj.export({ format: 'pem', type: 'pkcs8' }) as string
    }
    cachedKeys = { publicKey: envPub, privateKeyPem, subject }
    return cachedKeys
  }

  // Development / test fallback persisted in logs/vapid-dev.json (gitignored)
  const devFile = path.resolve(process.cwd(), 'logs', 'vapid-dev.json')
  try {
    if (fs.existsSync(devFile)) {
      const parsed = JSON.parse(fs.readFileSync(devFile, 'utf8')) as VapidKeyPair
      if (parsed.publicKey && parsed.privateKeyPem) {
        cachedKeys = parsed
        return cachedKeys
      }
    }
  } catch {
    /* ignore */
  }

  cachedKeys = generateVapidKeyPair(subject)
  try {
    fs.mkdirSync(path.dirname(devFile), { recursive: true })
    fs.writeFileSync(devFile, JSON.stringify(cachedKeys), 'utf8')
  } catch {
    /* ignore in read-only environments */
  }
  return cachedKeys
}

function buildVapidJwt(audience: string, subject: string, privateKeyPem: string): string {
  const header = base64UrlEncode(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600
  const payload = base64UrlEncode(Buffer.from(JSON.stringify({ aud: audience, exp, sub: subject })))
  const signingInput = `${header}.${payload}`
  const sig = crypto.sign('sha256', Buffer.from(signingInput), {
    key: privateKeyPem,
    dsaEncoding: 'ieee-p1363',
  })
  return `${signingInput}.${base64UrlEncode(sig)}`
}

function hkdfExpand(prk: Buffer, info: Buffer, length: number): Buffer {
  const hmac = crypto.createHmac('sha256', prk)
  hmac.update(Buffer.concat([info, Buffer.from([1])]))
  return hmac.digest().subarray(0, length)
}

function encryptWebPushPayload(
  payloadText: string,
  userPublicKeyB64: string,
  userAuthB64: string,
): { body: Buffer; salt: Buffer; serverPublicKey: Buffer } {
  const uaPublic = base64UrlDecode(userPublicKeyB64)
  const authSecret = base64UrlDecode(userAuthB64)

  const ecdh = crypto.createECDH('prime256v1')
  ecdh.generateKeys()
  const serverPublicKey = ecdh.getPublicKey()
  const sharedSecret = ecdh.computeSecret(uaPublic)

  const salt = crypto.randomBytes(16)

  // RFC 8291 key derivation
  const prkKey = crypto.createHmac('sha256', authSecret).update(sharedSecret).digest()
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'utf8'), uaPublic, serverPublicKey])
  const ikm = hkdfExpand(prkKey, keyInfo, 32)

  const prk = crypto.createHmac('sha256', salt).update(ikm).digest()
  const cek = hkdfExpand(prk, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16)
  const nonce = hkdfExpand(prk, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12)

  // Pad plaintext with 0x02 delimiter (RFC 8188 last record)
  const plaintext = Buffer.concat([Buffer.from(payloadText, 'utf8'), Buffer.from([2])])
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce)
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])

  // RFC 8188 aes128gcm header: salt(16) || rs(4) || idlen(1) || keyid(65)
  const rsBuf = Buffer.alloc(4)
  rsBuf.writeUInt32BE(4096, 0)
  const header = Buffer.concat([salt, rsBuf, Buffer.from([serverPublicKey.length]), serverPublicKey])

  return {
    body: Buffer.concat([header, encrypted]),
    salt,
    serverPublicKey,
  }
}

export async function sendWebPushNotification(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: Record<string, unknown>,
  keys: VapidKeyPair = getVapidKeys(),
): Promise<{ ok: boolean; status: number; gone?: boolean }> {
  const endpointUrl = new URL(subscription.endpoint)
  const audience = `${endpointUrl.protocol}//${endpointUrl.host}`
  const jwt = buildVapidJwt(audience, keys.subject, keys.privateKeyPem)
  const encrypted = encryptWebPushPayload(JSON.stringify(payload), subscription.p256dh, subscription.auth)

  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      TTL: '86400',
      Authorization: `vapid t=${jwt}, k=${keys.publicKey}`,
    },
    body: new Uint8Array(encrypted.body),
  })

  return {
    ok: res.ok,
    status: res.status,
    gone: res.status === 404 || res.status === 410,
  }
}
