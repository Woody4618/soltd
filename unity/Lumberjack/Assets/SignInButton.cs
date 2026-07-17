using System;
using Solana.Unity.SDK;
using UnityEngine;
using UnityEngine.UI;

[RequireComponent(typeof(Button))]
public class SignInButton : MonoBehaviour
{
    private Button _button;
    
    private void Awake()
    {
        _button = GetComponent<Button>();
        _button.onClick.AddListener(OnClick);
            
        OnWalletStateChanged();
            
        Web3.OnWalletChangeState -= OnWalletStateChanged;
        Web3.OnWalletChangeState += OnWalletStateChanged;
    }

    private void OnDestroy()
    {
        Web3.OnWalletChangeState -= OnWalletStateChanged;
    }

    private async void OnWalletStateChanged()
    {
        bool hasCachedSession;
        try
        {
            hasCachedSession = await MwaSession.HasCachedSession();
        }
        catch (Exception e)
        {
            Debug.LogException(e);
            hasCachedSession = false;
        }

        _button.interactable = !hasCachedSession;
        gameObject.SetActive(!hasCachedSession);
    }

    private async void OnClick()
    {
        try
        {
            var payload = new SignInPayload
            {
                Domain = "lumberjack.game",
                Statement = "Sign in to Lumberjack (MWA SIWS test)",
                Uri = "https://lumberjack.game",
                Version = "1",
                Nonce = Guid.NewGuid().ToString("N").Substring(0, 8),
                IssuedAt = DateTime.UtcNow.ToString("o")
            };

            // SIWS is the login itself (one authorize); no prior connect needed.
            var (account, siws) = await Web3.Instance.LoginWalletAdapter(payload);
            Debug.Log($"[MWA] SIWS ok: account={account?.PublicKey}, " +
                      $"sigType={siws?.SignatureType ?? "<none>"}, " +
                      $"address={siws?.Address ?? "<none>"}, " +
                      $"signature={siws?.Signature ?? "<none>"}");
        }
        catch (Exception e)
        {
            Debug.Log(e);
        }
    }
}
