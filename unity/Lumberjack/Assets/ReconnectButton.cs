using System;
using Solana.Unity.SDK;
using TMPro;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

[RequireComponent(typeof(Button))]
public class ReconnectButton : MonoBehaviour
{
    [SerializeField] private TextMeshProUGUI _pubkey;
    
    private Button _button;
    
    private void Start()
    {
        _button = GetComponent<Button>();
        _button.onClick.AddListener(OnButtonClick);
            
        OnWalletStateChanged();
            
        Web3.OnWalletChangeState -= OnWalletStateChanged;
        Web3.OnWalletChangeState += OnWalletStateChanged;
    }

    private void OnDestroy()
    {
        Web3.OnWalletChangeState -= OnWalletStateChanged;
    }

    // async void: await resumes on the main thread (ContinueWith would not).
    private async void OnWalletStateChanged()
    {
        _pubkey.SetText(string.Empty);

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

        _button.interactable = hasCachedSession;
        Debug.Log($"[MWA] ReconnectButton has cached session: {hasCachedSession}");
        gameObject.SetActive(hasCachedSession);

        var accountAddress = MwaSession.CachedAccountAddress();
        if (!string.IsNullOrEmpty(accountAddress))
        {
            _pubkey.SetText($"{accountAddress[..4]}...{accountAddress[^4..]}");
        }
    }

    private async void OnButtonClick()
    {
        try
        {
            await Web3.Instance.LoginWalletAdapter();
        }
        catch (Exception e)
        {
            Debug.LogException(e);
        }
    }
}
