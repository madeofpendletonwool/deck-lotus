package com.collinpendleton.decklotus.data

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File
import java.io.IOException
import java.util.UUID

/**
 * Where scanned cards go besides (or instead of) the collection: a deck's board.
 * [collection] false is for cards pulled out of a binder, which are already counted.
 */
@Serializable
data class DeckTarget(val deckId: Int, val deckName: String, val board: String = "mainboard", val collection: Boolean = false)

/** Scanned cards on their way to the server, with the id that makes retries safe. */
@Serializable
data class PendingBatch(
    val batchId: String,
    val cards: List<ScannedCard>,
    val createdAt: Long,
    /** Null: the collection only. Batches saved before decks existed have none. */
    val target: DeckTarget? = null,
)

/** Copies that went into one deck's board during a flush. */
data class DeckDelivery(val deckName: String, val board: String, val count: Int)

sealed interface UploadOutcome {
    /**
     * [added] copies went into the collection, [decks] into decks. [returned] are cards the
     * server couldn't take (card data older than the phone's, or the deck was deleted).
     */
    data class Done(val added: Int, val decks: List<DeckDelivery>, val returned: List<ScannedCard>, val reasons: List<String>) : UploadOutcome
    data class Offline(val message: String) : UploadOutcome
    data object SignedOut : UploadOutcome
}

/**
 * Moving scans into the collection. A batch is written to disk with its id
 * before the first attempt and only deleted once the server answers, so a
 * dropped connection, a killed app or a reboot never loses cards, and a
 * retry after a lost response can't add them twice (the server remembers
 * batch ids).
 */
class UploadQueue(private val file: File, private val api: Api) {
    private val json = Json { ignoreUnknownKeys = true }
    private val lock = Mutex()

    fun pending(): List<PendingBatch> = try {
        if (file.exists()) json.decodeFromString<List<PendingBatch>>(file.readText()) else emptyList()
    } catch (_: Exception) {
        emptyList()
    }

    private fun write(batches: List<PendingBatch>) {
        val tmp = File(file.path + ".tmp")
        tmp.writeText(json.encodeToString(batches))
        tmp.renameTo(file)
    }

    suspend fun enqueue(cards: List<ScannedCard>, target: DeckTarget? = null) = lock.withLock {
        write(pending() + PendingBatch(UUID.randomUUID().toString(), cards, System.currentTimeMillis(), target))
    }

    /** Sends every waiting batch, oldest first. Stops at the first network failure. */
    suspend fun flush(): UploadOutcome = lock.withLock {
        var added = 0
        val decks = mutableListOf<DeckDelivery>()
        val returned = mutableListOf<ScannedCard>()
        val reasons = mutableListOf<String>()
        for (b in pending()) {
            val items = b.cards.groupBy { it.scryfallId to finishOf(it) }
                .map { (k, v) -> ScanItem(k.first, k.second, v.size) }
            val result = try {
                val t = b.target
                api.uploadScans(
                    if (t == null) ScanBatchRequest(b.batchId, items)
                    else ScanBatchRequest(b.batchId, items, deckId = t.deckId, board = t.board, collection = t.collection),
                )
            } catch (e: ApiException) {
                if (e.code == 401) return UploadOutcome.SignedOut
                // 503 while the server refreshes card data, 5xx, etc.: try later.
                return UploadOutcome.Offline(e.message ?: "Server error")
            } catch (e: IOException) {
                return UploadOutcome.Offline("Can't reach the server")
            }
            added += result.added
            if (result.deckAdded > 0) {
                decks += DeckDelivery(result.deck?.name ?: b.target?.deckName.orEmpty(), result.deck?.board ?: b.target?.board ?: "mainboard", result.deckAdded)
            }
            val failedIds = result.failed.mapNotNull { it.scryfallId }.toSet()
            returned += b.cards.filter { it.scryfallId in failedIds }
            reasons += result.failed.map { it.error }.distinct()
            write(pending().filterNot { it.batchId == b.batchId })
        }
        UploadOutcome.Done(added, decks, returned, reasons.distinct())
    }

    private fun finishOf(c: ScannedCard) = if (c.foil) "foil" else "nonfoil"
}
