package com.collinpendleton.decklotus.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.Authenticator
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.Route
import java.io.IOException
import java.util.concurrent.TimeUnit

// ---- Wire models (the server speaks snake_case) ----

@Serializable
data class LoginResponse(val accessToken: String, val refreshToken: String, val user: ApiUser)

@Serializable
data class ApiUser(val id: Int, val username: String, val email: String? = null)

@Serializable
data class Tokens(val accessToken: String, val refreshToken: String)

@Serializable
data class InventoryPage(val cards: List<InventoryCard>, val pagination: Pagination)

@Serializable
data class Pagination(val page: Int, val totalPages: Int, val totalCards: Int)

@Serializable
data class InventoryCard(
    @SerialName("card_id") val cardId: Int,
    val name: String,
    @SerialName("mana_cost") val manaCost: String? = null,
    @SerialName("type_line") val typeLine: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("total_owned") val totalOwned: Int = 0,
    @SerialName("total_in_decks") val totalInDecks: Int = 0,
    val available: Int = 0,
    val printings: List<OwnedPrinting> = emptyList(),
)

@Serializable
data class OwnedPrinting(
    @SerialName("printing_id") val printingId: Int,
    val quantity: Int,
    val finish: String = "nonfoil",
    @SerialName("set_code") val setCode: String,
    @SerialName("collector_number") val collectorNumber: String? = null,
    val rarity: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("set_name") val setName: String? = null,
    val price: Double? = null,
)

@Serializable
data class InventoryStats(
    val uniqueCards: Int = 0,
    val totalCopies: Int = 0,
    val inDecks: Int = 0,
    val available: Int = 0,
    val estimatedValue: Double = 0.0,
)

@Serializable
data class DeckUsage(val id: Int, val name: String, val format: String? = null, @SerialName("total_quantity") val quantity: Int = 0)

@Serializable
data class OwnershipUsage(val deckUsage: List<DeckUsage> = emptyList())

@Serializable
data class ScanItem(val scryfallId: String, val finish: String, val quantity: Int)

@Serializable
data class ScanBatchRequest(val batchId: String, val items: List<ScanItem>)

@Serializable
data class ScanFailure(val scryfallId: String? = null, val error: String)

@Serializable
data class ScanBatchResult(val added: Int, val failed: List<ScanFailure> = emptyList(), val duplicate: Boolean = false)

@Serializable
private data class LoginRequest(val username: String, val password: String)

@Serializable
private data class RefreshRequest(val refreshToken: String)

@Serializable
private data class QuantityRequest(val quantity: Int, val finish: String)

@Serializable
private data class ErrorBody(val error: String? = null)

/** HTTP-level failure with the server's message when it sent one. */
class ApiException(val code: Int, message: String) : IOException(message)

/**
 * The Deck Lotus server API. Requests carry the access token; a 401 swaps the
 * refresh token for new tokens once and retries. If that fails too, the
 * account is signed out and [signedOut] fires.
 */
class Api(private val auth: AuthStore) {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
    private val jsonType = "application/json".toMediaType()

    private val _signedOut = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val signedOut: SharedFlow<Unit> = _signedOut

    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .addInterceptor { chain ->
            val req = chain.request()
            val token = auth.account?.accessToken
            val withAuth = if (token != null && req.header("Authorization") == null && req.tag(NoAuth::class.java) == null) {
                req.newBuilder().header("Authorization", "Bearer $token").build()
            } else req
            chain.proceed(withAuth.newBuilder().header("User-Agent", USER_AGENT).build())
        }
        .authenticator(TokenRefresher())
        .build()

    private object NoAuth

    private inner class TokenRefresher : Authenticator {
        override fun authenticate(route: Route?, response: Response): Request? {
            if (response.request.tag(NoAuth::class.java) != null) return null
            // Only try once per request.
            if (response.priorResponse != null) { signOut(); return null }
            synchronized(this) {
                val account = auth.account ?: return null
                val sent = response.request.header("Authorization")?.removePrefix("Bearer ")
                // Another request already refreshed while this one was in flight.
                if (sent != account.accessToken) {
                    return response.request.newBuilder().header("Authorization", "Bearer ${account.accessToken}").build()
                }
                val refreshed = try {
                    val r = client.newCall(
                        Request.Builder().url(url(account.serverUrl, "/api/auth/refresh"))
                            .tag(NoAuth::class.java, NoAuth)
                            .post(json.encodeToString(RefreshRequest(account.refreshToken)).toRequestBody(jsonType))
                            .build(),
                    ).execute()
                    r.use { if (it.isSuccessful) json.decodeFromString<Tokens>(it.body!!.string()) else null }
                } catch (_: IOException) {
                    // Offline: don't sign out over a network blip.
                    return null
                }
                if (refreshed == null) { signOut(); return null }
                auth.updateTokens(refreshed.accessToken, refreshed.refreshToken)
                return response.request.newBuilder().header("Authorization", "Bearer ${refreshed.accessToken}").build()
            }
        }
    }

    private fun signOut() {
        auth.clear()
        _signedOut.tryEmit(Unit)
    }

    private fun server(): String = auth.account?.serverUrl ?: throw ApiException(401, "Not signed in")

    private fun url(base: String, path: String): String = base.trimEnd('/') + path

    private suspend inline fun <reified T> call(req: Request): T = withContext(Dispatchers.IO) {
        client.newCall(req).execute().use { r ->
            val body = r.body?.string().orEmpty()
            if (!r.isSuccessful) {
                val msg = runCatching { json.decodeFromString<ErrorBody>(body).error }.getOrNull()
                throw ApiException(r.code, msg ?: "Server returned ${r.code}")
            }
            json.decodeFromString<T>(body)
        }
    }

    private fun get(path: String) = Request.Builder().url(url(server(), path)).get().build()
    private inline fun <reified B> post(path: String, body: B) =
        Request.Builder().url(url(server(), path)).post(json.encodeToString(body).toRequestBody(jsonType)).build()

    /** Signs in and stores the account. [serverUrl] is normalised (https:// added if missing). */
    suspend fun login(serverUrl: String, username: String, password: String): Account {
        val base = normalizeServer(serverUrl) ?: throw ApiException(0, "That doesn't look like a server address")
        val res: LoginResponse = call(
            Request.Builder().url(url(base, "/api/auth/login"))
                .tag(NoAuth::class.java, NoAuth)
                .post(json.encodeToString(LoginRequest(username.trim(), password)).toRequestBody(jsonType))
                .build(),
        )
        return Account(base, res.user.username, res.accessToken, res.refreshToken).also(auth::save)
    }

    fun logout() = auth.clear()

    suspend fun inventory(name: String?, sort: String, page: Int, limit: Int = 50): InventoryPage {
        val u = url(server(), "/api/inventory").toHttpUrlOrNull()!!.newBuilder()
            .addQueryParameter("sort", sort)
            .addQueryParameter("page", page.toString())
            .addQueryParameter("limit", limit.toString())
            .apply { if (!name.isNullOrBlank()) addQueryParameter("name", name.trim()) }
            .build()
        return call(Request.Builder().url(u).get().build())
    }

    suspend fun stats(): InventoryStats = call(get("/api/inventory/stats"))

    suspend fun ownershipUsage(cardId: Int): OwnershipUsage = call(get("/api/cards/$cardId/ownership-usage"))

    suspend fun setQuantity(printingId: Int, quantity: Int, finish: String) {
        call<kotlinx.serialization.json.JsonObject>(post("/api/cards/printings/$printingId/quantity", QuantityRequest(quantity, finish)))
    }

    suspend fun uploadScans(batch: ScanBatchRequest): ScanBatchResult = call(post("/api/inventory/scans", batch))

    companion object {
        private const val USER_AGENT = "DeckLotus-Android"

        fun normalizeServer(input: String): String? {
            var s = input.trim().trimEnd('/')
            if (s.isEmpty()) return null
            if (!s.startsWith("http://") && !s.startsWith("https://")) s = "https://$s"
            // Someone pasting the web app URL with /api or a page path.
            s = s.removeSuffix("/api")
            return s.toHttpUrlOrNull()?.let { "${it.scheme}://${it.host}${if (it.port != defaultPort(it.scheme)) ":${it.port}" else ""}${it.encodedPath.trimEnd('/')}" }
        }

        private fun defaultPort(scheme: String) = if (scheme == "https") 443 else 80
    }
}
