using System;
using Solana.Unity.SDK;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

[RequireComponent(typeof(Button))]
public class ConnectButton : MonoBehaviour
{
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
