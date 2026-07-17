using System;
using System.Collections;
using Lumberjack.Accounts;
using Solana.Unity.SDK;
using Solana.Unity.Wallet.Bip39;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

/// <summary>
/// Handles the connection to the player's wallet.
/// </summary>
public class LoginScreen : MonoBehaviour
{
    public Button LoginButton;
    
    private void Start()
    {
        LoginButton.onClick.AddListener(OnEditorLoginClicked);
        AnchorService.OnPlayerDataChanged += OnPlayerDataChanged;
        AnchorService.OnInitialDataLoaded += UpdateContent;
    }

    private void OnDestroy()
    {
        AnchorService.OnPlayerDataChanged -= OnPlayerDataChanged;
        AnchorService.OnInitialDataLoaded -= UpdateContent;
    }

    private void OnPlayerDataChanged(PlayerData playerData)
    {
        UpdateContent();
    }

    private void UpdateContent()
    {
        if (Web3.Account == null)
            return;
        
        StartCoroutine(LoadScene());
    }

    private IEnumerator LoadScene()
    {
        InteractionBlocker.Instance.ShowBlocker();
        yield return null;
        SceneManager.LoadScene("GameScene");
    }

    private async void OnEditorLoginClicked()
    {
        // Don't use this one for production. It's only meant for editor login
        _ = await Web3.Instance.LoginInGameWallet("1234") ??
            await Web3.Instance.CreateAccount(new Mnemonic(WordList.English, WordCount.Twelve).ToString(), "1234");
    }
}
