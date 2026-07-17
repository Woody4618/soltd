using System;
using Solana.Unity.SDK;
using UnityEngine;
using UnityEngine.UI;

[RequireComponent(typeof(Button))]
public class CloneAuthorizationButton : MonoBehaviour
{
    private void Awake()
    {
        GetComponent<Button>().onClick.AddListener(OnClick);
    }

    private async void OnClick()
    {
        try
        {
            if (Web3.Wallet is not SolanaWalletAdapter adapter)
            {
                Debug.Log("[MWA] Clone: not logged in (no wallet adapter)"); 
                return;
            }

            var token = await adapter.CloneAuthorization();
            Debug.Log($"[MWA] CloneAuthorization -> cloned auth_token (len {token?.Length})");
        }
        catch (NotSupportedException e)
        {
            Debug.Log($"[MWA] CloneAuthorization not supported by this wallet: {e.Message}");
        }
        catch (Exception e)
        {
            Debug.Log(e);
        }
    }
}
