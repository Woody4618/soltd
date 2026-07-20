// Bundled session creation.
//
// The Gum react-sdk's `createSession()` does two things: (1) sends the on-chain
// `create_session` instruction, and (2) persists the freshly-generated session
// keypair + token into IndexedDB (encrypted) so the app can later sign session
// transactions. It does NOT expose a way to get just the instruction while
// still persisting, so we can't bundle it into another transaction through the
// public API.
//
// This module reproduces both halves so the `create_session` instruction can be
// bundled into the SAME transaction as `init_board` (one wallet approval):
//   - buildCreateSessionIx(): builds the gpl_session `create_session` ix + the
//     ephemeral session Keypair (which must co-sign the transaction).
//   - persistSession(): writes the session into the EXACT IndexedDB stores /
//     encryption format the react-sdk reads from, so useSessionKeyManager picks
//     it up on its next load and `useSessionWallet().sessionToken` becomes valid.
//
// The IndexedDB layout, store names, crypto (crypto-js AES + SHA256(key) + random
// IV, `${cipher}.${iv}` base64) and record shapes are mirrored from
// @magicblock-labs/gum-react-sdk's useSessionKeyManager. If that SDK changes its
// storage format, this must be updated in lockstep.

// BN comes from the app's anchor (`@anchor-lang/core`) rather than
// `@coral-xyz/anchor` (which isn't hoisted to a resolvable top-level module).
// Both are `bn.js` instances, and coral's coder serializes i64/u64 args via
// duck-typed `bn.js` methods, so this BN works with gum-sdk's coral program.
import { BN } from "@anchor-lang/core"
import { SessionTokenManager } from "@magicblock-labs/gum-sdk"
import type { AnchorWallet } from "@solana/wallet-adapter-react"
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js"
import CryptoJS from "crypto-js"

// --- IndexedDB (mirrors gum-react-sdk/src/utils/indexedDB.ts) ---------------
const DB_NAME = "session_data"
const SESSION_OBJECT_STORE = "sessions"
const WALLET_PUBKEY_TO_SESSION_STORE = "walletPublicKeyToSessionData"
const ENCRYPTION_KEY_OBJECT_STORE = "user_preferences"

function openIndexedDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      db.createObjectStore(SESSION_OBJECT_STORE)
      db.createObjectStore(ENCRYPTION_KEY_OBJECT_STORE)
      db.createObjectStore(WALLET_PUBKEY_TO_SESSION_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function putItem(
  store: string,
  data: unknown,
  key: string
): Promise<void> {
  return openIndexedDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readwrite")
        const req = tx.objectStore(store).put(data, key)
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error)
      })
  )
}

// --- crypto (mirrors gum-react-sdk/src/utils/crypto.ts) ---------------------
const ENCRYPTION_KEY_LENGTH = 32

function generateEncryptionKey(): string {
  const key = CryptoJS.lib.WordArray.random(ENCRYPTION_KEY_LENGTH)
  return CryptoJS.enc.Base64.stringify(key)
}

function encrypt(data: string, password: string): string {
  const iv = CryptoJS.lib.WordArray.random(16)
  const passwordHash = CryptoJS.SHA256(password)
  const cipher = CryptoJS.AES.encrypt(data, passwordHash, { iv })
  const encryptedData = cipher.ciphertext.toString(CryptoJS.enc.Base64)
  return `${encryptedData}.${iv.toString(CryptoJS.enc.Base64)}`
}

export interface PreparedSession {
  ix: TransactionInstruction
  sessionKeypair: Keypair
  sessionToken: PublicKey
  validUntilTimestamp: number
}

// Build the gpl_session `create_session` instruction plus the ephemeral session
// keypair. Both the wallet authority AND this keypair must sign the transaction
// the instruction lands in. `topUpLamports` funds the session signer so it can
// pay fees for auto-advance transactions.
export async function buildCreateSessionIx(
  wallet: AnchorWallet,
  connection: Connection,
  targetProgram: PublicKey,
  topUpLamports: number,
  expiryInMinutes: number
): Promise<PreparedSession> {
  if (expiryInMinutes > 24 * 60) {
    throw new Error("Session expiry cannot be more than 24 hours.")
  }
  const sdk = new SessionTokenManager(wallet as never, connection)
  const sessionKeypair = Keypair.generate()

  const expiryTimestamp = Math.ceil(
    (Date.now() + expiryInMinutes * 60 * 1000) / 1000
  )
  const topUp = topUpLamports > 0
  const validUntilBN = new BN(expiryTimestamp)
  const lamportsBN = topUp ? new BN(topUpLamports) : null

  const builder = sdk.program.methods
    .createSession(topUp, validUntilBN, lamportsBN)
    .accounts({
      targetProgram,
      sessionSigner: sessionKeypair.publicKey,
      authority: wallet.publicKey,
    })

  const pubkeys = await builder.pubkeys()
  const sessionToken = pubkeys.sessionToken as PublicKey
  const ix = await builder.instruction()

  return {
    ix,
    sessionKeypair,
    sessionToken,
    validUntilTimestamp: expiryTimestamp,
  }
}

// Persist a created session into the SAME encrypted IndexedDB stores the
// gum-react-sdk reads, so useSessionKeyManager loads it as the active session.
// Call this only AFTER the bundled transaction has confirmed on-chain.
export async function persistSession(
  walletPublicKey: PublicKey,
  session: PreparedSession
): Promise<void> {
  const encryptionKey = generateEncryptionKey()
  const sessionTokenString = session.sessionToken.toBase58()
  const keypairSecretBase64 = Buffer.from(
    session.sessionKeypair.secretKey
  ).toString("base64")

  const encryptedToken = encrypt(sessionTokenString, encryptionKey)
  const encryptedKeypair = encrypt(keypairSecretBase64, encryptionKey)

  const encryptedSessionData = {
    encryptedToken,
    encryptedKeypair,
    validUntilTimestamp: session.validUntilTimestamp,
  }

  const walletKey = walletPublicKey.toBase58()
  await putItem(SESSION_OBJECT_STORE, encryptedSessionData, sessionTokenString)
  await putItem(
    WALLET_PUBKEY_TO_SESSION_STORE,
    sessionTokenString,
    walletKey
  )
  await putItem(
    ENCRYPTION_KEY_OBJECT_STORE,
    {
      userPreferences: encryptionKey,
      validUntilTimestamp: session.validUntilTimestamp,
    },
    walletKey
  )
}
