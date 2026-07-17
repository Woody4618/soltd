using System;
using System.Text;
using Solana.Unity.SDK;
using UnityEngine;
using UnityEngine.UI;

[RequireComponent(typeof(Button))]
public class SignMessageButton : MonoBehaviour
{
    private const string Message = "Hello from Lumberjack (MWA v2)";

    private void Awake()
    {
        var button = GetComponent<Button>();
        button.onClick.AddListener(OnClick);
    }

    private async void OnClick()
    {
        try
        {
            var signature = await Web3.Wallet.SignMessage(Encoding.UTF8.GetBytes(Message));
            Debug.Log($"[MWA] SignMessage -> {Convert.ToBase64String(signature)}");
        }
        catch (Exception e)
        {
            Debug.Log(e);
        }
    }
}
