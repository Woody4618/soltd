using System.Collections;
using UnityEngine;

public class AndroidSafeZone : MonoBehaviour
{
    /// <summary>
    /// Forces the screen to adapt to the android safe zone,
    /// preventing UI to be drawn behind the camera or soft corners etc.
    /// </summary>
    /// <returns></returns>
    private IEnumerator Start()
    {
        yield return null;
        
        var rectTransform = GetComponent<RectTransform>();
        var safeArea = Screen.safeArea;
        var minAnchor = safeArea.position;
        var maxAnchor = minAnchor + safeArea.size;
        minAnchor.x /= Screen.width;
        minAnchor.y /= Screen.height;
        maxAnchor.x /= Screen.width;
        maxAnchor.y /= Screen.height;
        rectTransform.anchorMin = minAnchor;
        rectTransform.anchorMax = maxAnchor;
    }
}
