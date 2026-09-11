package com.nuvio.drive

import android.os.Bundle
import android.view.View
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  private var appWebView: WebView? = null

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    appWebView = webView
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Resize the whole WebView for system bars, cutouts and the keyboard.
    // Consuming these insets prevents a second CSS safe-area padding.
    ViewCompat.setOnApplyWindowInsetsListener(findViewById<View>(android.R.id.content)) { view, insets ->
      val safe = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime())
      view.setPadding(safe.left, safe.top, safe.right, safe.bottom)
      WindowInsetsCompat.CONSUMED
    }

    // When pressing back at root, move task to background so operations continue smoothly
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        if (appWebView?.canGoBack() == true) {
          appWebView?.goBack()
        } else {
          moveTaskToBack(true)
        }
      }
    })
  }

  override fun onPause() {
    super.onPause()
    if (NuvioForegroundService.isWorking) {
      appWebView?.onResume()
    }
  }

  override fun onStop() {
    super.onStop()
    if (NuvioForegroundService.isWorking) {
      appWebView?.onResume()
    }
  }
}

