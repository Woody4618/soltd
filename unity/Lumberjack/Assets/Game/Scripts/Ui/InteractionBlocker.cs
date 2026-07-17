using System;
using TMPro;
using UnityEngine;

public class InteractionBlocker : MonoBehaviour
{
    public static InteractionBlocker Instance;
    
    public GameObject BlockingSpinner;
    public GameObject NonBlocking;
    
    public TextMeshProUGUI CurrentTransactionsInProgress;
    public TextMeshProUGUI LastTransactionTimeText;
    public TextMeshProUGUI LastError;

    private bool _showBlocker;
    
    private void Start()
    {
        Instance = this;
    }

    void Update()
    {
        if (AnchorService.Instance == null)
        {
            return;
        }
        
        BlockingSpinner.gameObject.SetActive(_showBlocker || AnchorService.Instance.IsAnyBlockingTransactionInProgress);
        NonBlocking.gameObject.SetActive(AnchorService.Instance.IsAnyNonBlockingTransactionInProgress);
        
        CurrentTransactionsInProgress.text = (AnchorService.Instance.BlockingTransactionsInProgress +
                                             AnchorService.Instance.NonBlockingTransactionsInProgress).ToString();
        
        LastTransactionTimeText.text = $"Last took: {AnchorService.Instance.LastTransactionTimeInMs}ms";
        LastError.text = AnchorService.Instance.LastError;
    }

    public void ShowBlocker()
    {
        BlockingSpinner.gameObject.SetActive(_showBlocker = true);
    }
}
