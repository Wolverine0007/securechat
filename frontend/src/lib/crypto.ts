import _sodium from 'libsodium-wrappers'

async function getSodium() {
  await _sodium.ready
  return _sodium
}

export async function generateKeyPair() {
  const sodium = await getSodium()
  const keyPair = sodium.crypto_box_keypair()
  return {
    publicKey:  sodium.to_base64(keyPair.publicKey),
    privateKey: sodium.to_base64(keyPair.privateKey),
  }
}

export async function encryptMessage(
  plaintext: string,
  recipientPublicKeyB64: string,
  senderPrivateKeyB64: string
): Promise<string> {
  const sodium = await getSodium()
  const recipientPublicKey = sodium.from_base64(recipientPublicKeyB64)
  const senderPrivateKey   = sodium.from_base64(senderPrivateKeyB64)
  const nonce              = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES)
  const messageBytes       = sodium.from_string(plaintext)
  const encrypted = sodium.crypto_box_easy(messageBytes, nonce, recipientPublicKey, senderPrivateKey)
  const combined = new Uint8Array(nonce.length + encrypted.length)
  combined.set(nonce)
  combined.set(encrypted, nonce.length)
  return sodium.to_base64(combined)
}

export async function decryptMessage(
  ciphertextB64: string,
  otherPartyPublicKeyB64: string,
  myPrivateKeyB64: string
): Promise<string> {
  const sodium = await getSodium()
  const combined       = sodium.from_base64(ciphertextB64)
  const otherPublicKey = sodium.from_base64(otherPartyPublicKeyB64)
  const myPrivateKey   = sodium.from_base64(myPrivateKeyB64)
  const nonce      = combined.slice(0, sodium.crypto_box_NONCEBYTES)
  const ciphertext = combined.slice(sodium.crypto_box_NONCEBYTES)
  const decrypted  = sodium.crypto_box_open_easy(ciphertext, nonce, otherPublicKey, myPrivateKey)
  return sodium.to_string(decrypted)
}

export function savePrivateKey(privateKey: string) {
  localStorage.setItem('privateKey', privateKey)
}

export function getPrivateKey(): string | null {
  return localStorage.getItem('privateKey')
}

export function clearPrivateKey() {
  localStorage.removeItem('privateKey')
}