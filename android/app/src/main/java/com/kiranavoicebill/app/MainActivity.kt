package com.kiranavoicebill.app

import android.graphics.Color
import android.os.Bundle
import android.os.SystemClock
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import com.getcapacitor.BridgeActivity

/** KB-425 (owner, 20 Nov 2026): the splash never stays longer than this, even if the first screen is slow. */
const val SPLASH_MAX_MS = 5_000L

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // KB-425 (D123): the blue splash stays until the web app says its first real screen is drawn (AppShell.ready), or 5 s at most -
        // so no cream "Loading" screen and no white flash in between. A fresh start waits for a fresh signal (the process may outlive
        // an earlier screen); a restored activity keeps the page it had.
        if (savedInstanceState == null) AppShellState.ready = false
        val shown = SystemClock.uptimeMillis()
        installSplashScreen().setKeepOnScreenCondition { !AppShellState.ready && SystemClock.uptimeMillis() - shown < SPLASH_MAX_MS }
        registerPlugin(ClassicPrinterPlugin::class.java) // KB-408: our own plugin, not an npm one - registered by hand, before super
        registerPlugin(FileSharePlugin::class.java) // KB-414: Share / PDF / WhatsApp - the WebView has no share sheet, drops downloads
        registerPlugin(AppShellPlugin::class.java) // KB-425: the splash's "ready", the permission state, Open Settings
        super.onCreate(savedInstanceState)
        // the WebView's own colour before the page paints: the splash blue, never white
        bridge.webView.setBackgroundColor(Color.parseColor("#2563D9"))
    }
}
