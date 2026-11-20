package com.kiranavoicebill.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/** KB-425 (D123): set once the web app has drawn its first real screen; MainActivity holds the splash until then (at most 5 s). */
object AppShellState {
    @Volatile
    var ready = false
}

/**
 * KB-425 (owner, 20 Nov 2026; D123) - the web side is src/data/appShell.ts.
 * - ready: the first real screen (Home, Sign in, setup) is on screen - the splash may go.
 * - permissionState: microphone / nearby (Android 12+'s "Nearby devices": scan + connect; nothing on Android 11 and older) - granted,
 *   and whether Android would still show its prompt (canAsk). Asked only after an action FAILED because Android refused: cannot ask =
 *   "Don't allow" for good, and the app offers Open Settings.
 * - openSettings: this app's own page in Android's Settings.
 * It asks for nothing itself: the mic prompt still comes from the recording, the Bluetooth one from the printer search.
 */
@CapacitorPlugin(name = "AppShell")
class AppShellPlugin : Plugin() {
    @PluginMethod
    fun ready(call: PluginCall) {
        AppShellState.ready = true
        call.resolve()
    }

    private fun permissionsFor(name: String?): Array<String>? = when (name) {
        "microphone" -> arrayOf(Manifest.permission.RECORD_AUDIO)
        // Android 12+: the "Nearby devices" switch (Choose printer asks for connect, the search for scan). Android 11 and older have no
        // such permission - nothing to explain (the Bluetooth search asks for location itself).
        "nearby" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
        } else {
            emptyArray()
        }
        // KB-416 (owner, 20 Nov 2026): may Choose printer search for new printers by itself? Only when Android already allows the
        // Bluetooth search - then the search shows no prompt. Android 11 and older: the search needs location.
        "scan" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
        } else {
            arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
        }
        else -> null
    }

    @PluginMethod
    fun permissionState(call: PluginCall) {
        val perms = permissionsFor(call.getString("name")) ?: return call.reject("unknown permission")
        val missing = perms.filter { ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED }
        val granted = missing.isEmpty()
        // judged on the missing parts only (owner's phone test, 20 Nov 2026); the web side asks this only after a real refusal
        val canAsk = missing.any { ActivityCompat.shouldShowRequestPermissionRationale(activity, it) }
        call.resolve(JSObject().put("granted", granted).put("canAsk", canAsk))
    }

    /** KB-416: "Not listed?" - Android's Bluetooth settings, to pair a printer. */
    @PluginMethod
    fun openBluetoothSettings(call: PluginCall) {
        context.startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        call.resolve()
    }

    @PluginMethod
    fun openSettings(call: PluginCall) {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        call.resolve()
    }
}
