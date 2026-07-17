using System;
using Solana.Unity.SDK;
using UnityEngine;
using UnityEngine.UI;

[RequireComponent(typeof(Button))]
public class GetCapabilitiesButton : MonoBehaviour
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
            
            var caps = await adapter.GetCapabilities();
            Debug.Log($"[MWA] Get capabilities -> [{string.Join(", ", caps.Features ?? new[] { "<none>" })}]");
        }
        catch (Exception e)
        {
            Debug.Log(e);
        }
    }
}
