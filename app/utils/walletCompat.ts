// Compatibility layer between the web3.js v3 wallet adapter (@solana/wallet-adapter)
// and this app, which stays on web3.js v1 because @anchor-lang/core and the
// @magicblock-labs/gum-* SDKs both depend on v1 and have no v3 build yet.
//
// The bridge is cheap because the adapter itself round-trips transactions through
// wire bytes: it serializes whatever you hand it, signs the decoded Kit transaction,
// and re-encodes. Wire bytes are identical across v1 and v3, so converting at this
// boundary is lossless — signatures included.
//
// Import `useWallet` / `useConnection` / `useAnchorWallet` from here rather than
// from "@solana/wallet-adapter" directly; everything you get back is v1-typed.

import { useCallback, useMemo } from "react"
import {
  useWallet as useWalletV3,
  type SendTransactionOptions as SendTransactionOptionsV3,
} from "@solana/wallet-adapter"
import {
  Transaction as TransactionV3,
  VersionedTransaction as VersionedTransactionV3,
} from "@solana/web3.js"
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js-v1"
import { CONNECTION } from "./anchor"

type AnyTransaction = Transaction | VersionedTransaction
type AnyTransactionV3 = TransactionV3 | VersionedTransactionV3

/** Options we accept at the v1 boundary. `signers` are applied before conversion. */
export type SendTransactionOptions = Omit<SendTransactionOptionsV3, "signers"> & {
  signers?: Keypair[]
}

/**
 * The app's single v1 connection.
 *
 * The adapter publishes a v3 `Connection` through its own `useConnection`, but
 * Anchor, the gum SDKs and every `simulateTransaction`/`confirmTransaction` call
 * in this app expect the v1 class, so we hand out the shared `CONNECTION` instead.
 */
export function useConnection(): { connection: Connection } {
  return useMemo(() => ({ connection: CONNECTION as Connection }), [])
}

function isVersioned(tx: AnyTransaction): tx is VersionedTransaction {
  return "version" in tx
}

function isVersionedV3(tx: AnyTransactionV3): tx is VersionedTransactionV3 {
  return "version" in tx
}

/** v1 -> v3, through the wire bytes both versions agree on. */
export function toV3(tx: AnyTransaction): AnyTransactionV3 {
  if (isVersioned(tx)) return VersionedTransactionV3.deserialize(tx.serialize())
  return TransactionV3.from(
    new Uint8Array(
      tx.serialize({ requireAllSignatures: false, verifySignatures: false })
    )
  )
}

/** v3 -> v1, the same way. v3's legacy `serialize` is async, hence the Promise. */
export async function toV1(tx: AnyTransactionV3): Promise<AnyTransaction> {
  if (isVersionedV3(tx)) return VersionedTransaction.deserialize(tx.serialize())
  return Transaction.from(
    await tx.serialize({ requireAllSignatures: false, verifySignatures: false })
  )
}

function toV1PublicKey(key: { toBase58(): string } | null): PublicKey | null {
  return key ? new PublicKey(key.toBase58()) : null
}

/**
 * `useWallet()` with every value converted to web3.js v1.
 *
 * Mirrors the shape the app used with @solana/wallet-adapter-react, so call sites
 * only change their import.
 */
export function useWallet() {
  const wallet = useWalletV3()

  const publicKey = useMemo(
    () => toV1PublicKey(wallet.publicKey),
    [wallet.publicKey]
  )

  const sendTransaction = useCallback(
    async (
      tx: AnyTransaction,
      connection: Connection,
      options: SendTransactionOptions = {}
    ): Promise<string> => {
      const { signers, ...sendOptions } = options
      // The adapter would fill these in itself, but it needs a v3 Connection to
      // do it and v1 `serialize()` refuses to compile a transaction without them.
      if (!isVersioned(tx)) {
        tx.feePayer = tx.feePayer ?? publicKey ?? undefined
        if (
          !tx.recentBlockhash ||
          tx.recentBlockhash === "11111111111111111111111111111111"
        ) {
          tx.recentBlockhash = (
            await connection.getLatestBlockhash("confirmed")
          ).blockhash
        }
      }
      // Sign with extra keypairs on the v1 side. Their signatures survive the
      // conversion in the wire bytes, so the adapter never sees a v1 `Keypair`
      // (its `signers` option expects a v3/Kit signer).
      if (signers?.length) {
        if (isVersioned(tx)) tx.sign(signers)
        else tx.partialSign(...signers)
      }
      return wallet.sendTransaction(
        toV3(tx),
        // Only ever used for `getLatestBlockhash` and `sendRawTransaction`, both
        // of which v1's Connection provides with the same shape.
        connection as never,
        sendOptions
      )
    },
    [wallet, publicKey]
  )

  const signTransaction = useMemo(() => {
    const sign = wallet.signTransaction
    if (!sign) return undefined
    return async <T extends AnyTransaction>(tx: T): Promise<T> =>
      (await toV1(await sign(toV3(tx)))) as T
  }, [wallet.signTransaction])

  const signAllTransactions = useMemo(() => {
    const signAll = wallet.signAllTransactions
    if (!signAll) return undefined
    return async <T extends AnyTransaction>(txs: T[]): Promise<T[]> => {
      const signed = await signAll(txs.map(toV3))
      return (await Promise.all(signed.map(toV1))) as T[]
    }
  }, [wallet.signAllTransactions])

  return {
    ...wallet,
    publicKey,
    sendTransaction,
    signTransaction,
    signAllTransactions,
  }
}

/** Anchor's `Wallet` shape, in v1 types — what the gum SDKs expect. */
export interface AnchorWallet {
  publicKey: PublicKey
  signTransaction<T extends AnyTransaction>(tx: T): Promise<T>
  signAllTransactions<T extends AnyTransaction>(txs: T[]): Promise<T[]>
}

/**
 * Replacement for the adapter's own `useAnchorWallet`, which is deprecated and
 * unusable: it hands out v3 classes and a Promise-returning `serialize`, neither
 * of which published Anchor accepts.
 */
export function useAnchorWallet(): AnchorWallet | undefined {
  const { publicKey, signTransaction, signAllTransactions } = useWallet()
  return useMemo(
    () =>
      publicKey && signTransaction && signAllTransactions
        ? { publicKey, signTransaction, signAllTransactions }
        : undefined,
    [publicKey, signTransaction, signAllTransactions]
  )
}
