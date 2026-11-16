package com.kiranavoicebill.app

import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(ClassicPrinterPlugin::class.java) // KB-408: our own plugin, not an npm one - registered by hand, before super
        registerPlugin(FileSharePlugin::class.java) // KB-414: Share / PDF / WhatsApp - the WebView has no share sheet, drops downloads
        super.onCreate(savedInstanceState)
    }
}
