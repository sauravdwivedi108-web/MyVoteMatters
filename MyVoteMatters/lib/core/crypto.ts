import {
  createCipheriv, createDecipheriv, createHash, createHmac, createPublicKey, createPrivateKey,
  diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, KeyObject,
} from 'node:crypto';

export const sha256Hex = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

/** Deterministic JSON: object keys sorted, so equal values always hash equally. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Voting credentials. The voter holds the secret; the database holds only
// values derived from it, so a database reader cannot recompute the links.
// ---------------------------------------------------------------------------

export const newCredentialSecret = () => randomBytes(32).toString('base64url');

export function credentialDerivations(secret: string, electionId: string, payloadHash: string) {
  const mac = (msg: string) => createHmac('sha256', secret).update(msg).digest('hex');
  const receiptCode = mac(`receipt:${electionId}`).slice(0, 24);
  return {
    credentialHash: sha256Hex(`credential:${secret}`),
    retryTag: mac(`retry:${electionId}:${payloadHash}`),
    receiptCode,
    receiptCommitment: receiptCommitment(receiptCode),
  };
}

export const credentialHash = (secret: string) => sha256Hex(`credential:${secret}`);
export const receiptCommitment = (receiptCode: string) => sha256Hex(`receipt:${receiptCode}`);

// ---------------------------------------------------------------------------
// Ballot encryption: X25519 ephemeral-static ECDH + HKDF-SHA256 + AES-256-GCM.
// Only the holder of the election's tally private key can decrypt. Plaintext
// is padded to a fixed size so ciphertext length does not hint at the choice.
// ---------------------------------------------------------------------------

const PADDED_SIZE = 2048;
const INFO = Buffer.from('votesphere-ballot-v1');

export function generateTallyKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

function deriveKey(shared: Buffer, ephPub: Buffer, electionId: string) {
  const salt = createHash('sha256').update(ephPub).update(electionId).digest();
  return Buffer.from(hkdfSync('sha256', shared, salt, INFO, 32));
}

export function encryptBallot(plaintext: string, tallyPublicKeyPem: string, electionId: string): Buffer {
  const body = Buffer.from(plaintext, 'utf8');
  if (body.length + 4 > PADDED_SIZE) throw new Error('ballot_too_large');
  const padded = Buffer.alloc(PADDED_SIZE);
  padded.writeUInt32BE(body.length, 0);
  body.copy(padded, 4);
  randomBytes(PADDED_SIZE - 4 - body.length).copy(padded, 4 + body.length);

  const eph = generateKeyPairSync('x25519');
  const ephPub = eph.publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: createPublicKey(tallyPublicKeyPem) });
  const key = deriveKey(shared, ephPub, electionId);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(electionId));
  const ct = Buffer.concat([cipher.update(padded), cipher.final()]);
  const len = Buffer.alloc(2);
  len.writeUInt16BE(ephPub.length);
  return Buffer.concat([len, ephPub, iv, cipher.getAuthTag(), ct]);
}

export function decryptBallot(payload: Buffer, tallyPrivateKey: string | KeyObject, electionId: string): string {
  const pubLen = payload.readUInt16BE(0);
  const ephPub = payload.subarray(2, 2 + pubLen);
  const iv = payload.subarray(2 + pubLen, 14 + pubLen);
  const tag = payload.subarray(14 + pubLen, 30 + pubLen);
  const ct = payload.subarray(30 + pubLen);
  const priv = typeof tallyPrivateKey === 'string' ? createPrivateKey(tallyPrivateKey) : tallyPrivateKey;
  const shared = diffieHellman({
    privateKey: priv,
    publicKey: createPublicKey({ key: ephPub, format: 'der', type: 'spki' }),
  });
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(shared, ephPub, electionId), iv);
  decipher.setAAD(Buffer.from(electionId));
  decipher.setAuthTag(tag);
  const padded = Buffer.concat([decipher.update(ct), decipher.final()]);
  return padded.subarray(4, 4 + padded.readUInt32BE(0)).toString('utf8');
}
