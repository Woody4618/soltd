using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Solana.Unity.Programs;
using Solana.Unity.Rpc.Models;
using Solana.Unity.SDK;
using UnityEngine;
using UnityEngine.UI;

[RequireComponent(typeof(Button))]
public class SignAndSendButton : MonoBehaviour
{
    private const ulong Lamports = 1_000_000;

    private void Awake()
    {
        var button = GetComponent<Button>();
        button.onClick.AddListener(OnClick);
    }

    private async void OnClick()
    {
        try
        {
            var tx = await BuildSelfTransfer(Lamports);
            var result = await (Web3.Wallet as SolanaWalletAdapter).SignAndSendTransactions(new[] { tx });
            switch (result)
            {
                case SignAndSendTxResult.Success s:
                    Debug.Log($"[MWA] SignAndSend -> {s.Signatures.Length} signature(s); " +
                              $"first={Convert.ToBase64String(s.Signatures[0])}");
                    break;
                case SignAndSendTxResult.NotSupported:
                    Debug.Log("[MWA] SignAndSend not supported by this wallet");
                    break;
                case SignAndSendTxResult.UserDeclined:
                    Debug.Log("[MWA] SignAndSend: user declined");
                    break;
                case SignAndSendTxResult.NotSubmitted ns:
                    var landed = ns.PartialSignatures?.Count(x => x != null) ?? 0;
                    Debug.Log($"[MWA] SignAndSend: NOT submitted ({landed} landed)");
                    break;
                case SignAndSendTxResult.Failed f:
                    Debug.Log($"[MWA] SignAndSend failed ({f.Code}): {f.Message}");
                    break;
                default:
                    Debug.Log($"[MWA] SignAndSend result: {result.GetType().Name}");
                    break;
            }
        }
        catch (Exception e)
        {
            Debug.Log(e);
        }
    }

    private static async Task<Transaction> BuildSelfTransfer(ulong lamports)
    {
        var me = Web3.Account.PublicKey;
        return new Transaction
        {
            RecentBlockHash = await Web3.BlockHash(),
            FeePayer = me,
            Instructions = new List<TransactionInstruction> { SystemProgram.Transfer(me, me, lamports) },
            Signatures = new List<SignaturePubKeyPair>
            {
                new() { PublicKey = me, Signature = new byte[64] }
            }
        };
    }
}
