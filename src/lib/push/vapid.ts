/**
 * VAPID key pair (P-256) made with WebCrypto — runs in the BROWSER on the platform owner's
 * "push keys" page, so the private key never reaches a server. Same format as web-push expects:
 * public = uncompressed point (65 bytes), private = the 32-byte scalar, both base64url.
 */
const b64url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export async function generateVapidKeys() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const publicKey = b64url(await crypto.subtle.exportKey("raw", pair.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKey, privateKey: jwk.d! };
}
