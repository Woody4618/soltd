using Solana.Unity.SDK;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

[RequireComponent(typeof(Button))]
public class LogoutButton : MonoBehaviour
{
    private Button _button;
    
    private void Start()
    {
        _button = GetComponent<Button>();
        _button.onClick.AddListener(OnButtonClick);
    }
    
    private void OnButtonClick()
    {
        // Soft logout: detach but keep the cached session (login screen offers reconnect).
        Web3.Instance.WalletBase = null;

        SceneManager.LoadScene("LoginScene");
    }
}
