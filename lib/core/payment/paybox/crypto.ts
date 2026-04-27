import crypto from 'crypto';
import path from 'path';
import fs from 'fs';

export function createHMAC(value: string, secret: string) {
  if (!(value && secret)) return;

  const hmac = crypto.createHmac('sha512', Buffer.from(secret, 'hex'));
  hmac.update(value, 'utf-8');
  return hmac.digest('hex').toUpperCase();
}

export function verifySignature(
  message: string,
  signature: string,
  publicKeyPem: string,
) {
  const verifier = crypto.createVerify('SHA1');
  verifier.update(message);
  verifier.end();

  const signatureBuffer = Buffer.from(signature, 'base64');

  return verifier.verify(publicKeyPem, signatureBuffer);
}

export function readPEMFile(): string {
  try {
    const filePath = path.join(
      process.cwd(),
      'certs',
      'paybox',
      'public-key.pem',
    );
    const absolutePath = path.resolve(filePath);
    const pemContent = fs.readFileSync(absolutePath, 'utf8');
    return pemContent;
  } catch (error) {
    console.error('Error reading PEM file:', error);
    return '';
  }
}
