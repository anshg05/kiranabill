package com.kiranavoicebill.app

import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(ClassicPrinterPlugin::class.java) // KB-408: our own plugin, not an npm one - registered by hand, before super
        super.onCreate(savedInstanceState)
    }
}
