package dev.mantel.calendar.device

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStoreFile
import kotlinx.coroutines.flow.first
import java.security.KeyStore
import java.util.concurrent.ConcurrentHashMap
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class SavedConnection(val origin: String?, val token: String?)

/**
 * The server address is not a secret. The device token is: an AES key that
 * never leaves the Android Keystore encrypts it before it is written.
 *
 * The TV already stores under "mantel_tv". A phone passes its own file name.
 * The keystore alias stays per app, because each app has its own keystore.
 */
class SecureTokenStore(
    context: Context,
    private val preferencesName: String = "mantel_tv",
    private val keyAlias: String = "mantel_device_token",
) {
    private val app = context.applicationContext
    private val store = dataStore(app, preferencesName)
    private val originKey = stringPreferencesKey("origin")
    private val tokenKey = stringPreferencesKey("token")

    suspend fun read(): SavedConnection {
        val prefs = store.data.first()
        val token = prefs[tokenKey]?.let { runCatching { decrypt(it) }.getOrNull() }
        return SavedConnection(prefs[originKey], token)
    }

    suspend fun saveOrigin(origin: String) {
        store.edit { it[originKey] = origin }
    }

    suspend fun saveToken(token: String?) {
        store.edit { prefs ->
            if (token.isNullOrBlank()) prefs.remove(tokenKey) else prefs[tokenKey] = encrypt(token)
        }
    }

    suspend fun clear() {
        store.edit { it.clear() }
    }

    private fun encrypt(plain: String): String {
        val cipher = Cipher.getInstance(TRANSFORM)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val iv = Base64.encodeToString(cipher.iv, Base64.NO_WRAP)
        val body = Base64.encodeToString(cipher.doFinal(plain.toByteArray()), Base64.NO_WRAP)
        return "$iv:$body"
    }

    private fun decrypt(stored: String): String {
        val (iv, body) = stored.split(":", limit = 2)
        val cipher = Cipher.getInstance(TRANSFORM)
        cipher.init(
            Cipher.DECRYPT_MODE,
            key(),
            GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)),
        )
        return String(cipher.doFinal(Base64.decode(body, Base64.NO_WRAP)))
    }

    private fun key(): SecretKey {
        val keystore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (keystore.getKey(keyAlias, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(keyAlias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    private companion object {
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val TRANSFORM = "AES/GCM/NoPadding"
        val stores = ConcurrentHashMap<String, DataStore<Preferences>>()

        fun dataStore(context: Context, name: String): DataStore<Preferences> =
            stores.getOrPut(name) {
                PreferenceDataStoreFactory.create(
                    produceFile = { context.preferencesDataStoreFile(name) },
                )
            }
    }
}
