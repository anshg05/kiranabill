package com.kiranavoicebill.app

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothClass
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.os.Build
import android.util.Base64
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.io.IOException
import java.util.UUID
import java.util.concurrent.Executors

/**
 * KB-408 S4 (D111): Bluetooth Classic thermal printers - the phone's PAIRED devices, the serial-port profile (SPP), chunked writes,
 * a clean close. The web side (src/data/printerClassic.ts) sends the print job in base64 chunks and maps the error codes:
 * NO_BLUETOOTH, NO_PERMISSION, BT_OFF, UNREACHABLE, DISCONNECTED.
 */
@CapacitorPlugin(
    name = "ClassicPrinter",
    permissions = [Permission(alias = "nearby", strings = [Manifest.permission.BLUETOOTH_CONNECT])],
)
class ClassicPrinterPlugin : Plugin() {
    private val spp: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    private val io = Executors.newSingleThreadExecutor() // one socket, one thread: writes stay in order
    private var socket: BluetoothSocket? = null

    private fun adapter(): BluetoothAdapter? = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

    /** Android 12+ needs "Nearby devices" (BLUETOOTH_CONNECT); older Android has it at install (BLUETOOTH, max SDK 30). */
    private fun permitted(): Boolean = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || getPermissionState("nearby") == PermissionState.GRANTED

    @PluginMethod
    fun ensureReady(call: PluginCall) {
        if (adapter() == null) return call.reject("This phone has no Bluetooth", "NO_BLUETOOTH")
        if (!permitted()) return requestPermissionForAlias("nearby", call, "afterPermission")
        if (adapter()?.isEnabled != true) return call.reject("Bluetooth is off", "BT_OFF")
        call.resolve()
    }

    @PermissionCallback
    private fun afterPermission(call: PluginCall) {
        if (!permitted()) return call.reject("Nearby devices permission refused", "NO_PERMISSION")
        ensureReady(call)
    }

    @SuppressLint("MissingPermission") // checked by permitted()
    @PluginMethod
    fun listPaired(call: PluginCall) {
        val a = adapter() ?: return call.reject("This phone has no Bluetooth", "NO_BLUETOOTH")
        if (!permitted()) return call.reject("Nearby devices permission refused", "NO_PERMISSION")
        if (!a.isEnabled) return call.reject("Bluetooth is off", "BT_OFF")
        val devices = JSArray()
        for (d in a.bondedDevices) {
            if (d.type == BluetoothDevice.DEVICE_TYPE_LE) continue // BLE-only devices are found by the BLE search
            devices.put(
                JSObject()
                    .put("address", d.address)
                    .put("name", d.name ?: "")
                    .put("printer", d.bluetoothClass?.majorDeviceClass == BluetoothClass.Device.Major.IMAGING),
            )
        }
        call.resolve(JSObject().put("devices", devices))
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    fun connect(call: PluginCall) {
        val address = call.getString("address") ?: return call.reject("No printer address", "UNREACHABLE")
        val a = adapter() ?: return call.reject("This phone has no Bluetooth", "NO_BLUETOOTH")
        if (!permitted()) return call.reject("Nearby devices permission refused", "NO_PERMISSION")
        if (!a.isEnabled) return call.reject("Bluetooth is off", "BT_OFF")
        if (!BluetoothAdapter.checkBluetoothAddress(address)) return call.reject("Not a Bluetooth address", "UNREACHABLE")
        io.execute {
            closeQuietly()
            try {
                if (a.isDiscovering) a.cancelDiscovery() // discovery slows a connect down
                val device = a.getRemoteDevice(address)
                socket = try {
                    device.createRfcommSocketToServiceRecord(spp).also { it.connect() }
                } catch (secure: IOException) {
                    // some cheap printers only accept an insecure RFCOMM socket
                    device.createInsecureRfcommSocketToServiceRecord(spp).also { it.connect() }
                }
                call.resolve()
            } catch (e: Exception) {
                closeQuietly()
                call.reject("Printer not reachable: ${e.message}", "UNREACHABLE")
            }
        }
    }

    @PluginMethod
    fun write(call: PluginCall) {
        val data = call.getString("data") ?: return call.reject("No data", "DISCONNECTED")
        io.execute {
            val s = socket
            if (s == null || !s.isConnected) return@execute call.reject("Not connected", "DISCONNECTED")
            try {
                s.outputStream.write(Base64.decode(data, Base64.DEFAULT))
                s.outputStream.flush()
                call.resolve()
            } catch (e: Exception) {
                closeQuietly()
                call.reject("Printer disconnected: ${e.message}", "DISCONNECTED")
            }
        }
    }

    @PluginMethod
    fun disconnect(call: PluginCall) {
        io.execute {
            closeQuietly()
            call.resolve()
        }
    }

    private fun closeQuietly() {
        try {
            socket?.close()
        } catch (_: IOException) {
        }
        socket = null
    }

    override fun handleOnDestroy() {
        io.execute { closeQuietly() }
        io.shutdown()
    }
}
