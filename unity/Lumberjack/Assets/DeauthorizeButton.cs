using System;
using Solana.Unity.SDK;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

[RequireComponent(typeof(Button))]
public class DeauthorizeButton : MonoBehaviour
{
    private void Awake()
    {
        var button = GetComponent<Button>();
        button.onClick.AddListener(OnClick);
    }

    private async void OnClick()
    {
        try
        {
            if (Web3.Wallet is not SolanaWalletAdapter adapter)
                return;

            await adapter.DeauthorizeWallet();
        }
        catch (Exception e)
        {
            Debug.Log(e);
            return;
        }
        
        Debug.Log("[MWA] Deauthorize -> success");
        SceneManager.LoadScene("LoginScene");
    }
}
