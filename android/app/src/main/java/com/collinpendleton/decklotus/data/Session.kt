package com.collinpendleton.decklotus.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File

@Serializable
data class ScannedCard(
    val key: Long,
    val scryfallId: String,
    val face: Int,
    val cardName: String,
    val setCode: String,
    val collectorNumber: String,
    val finishes: Int,
    val foil: Boolean,
    /** HIGH / MEDIUM / LOW from the identifier. */
    val confidence: String,
    /** False when several printings share the art and the collector line didn't settle it. */
    val printingCertain: Boolean,
    val distance: Int,
    val hash: List<Long>,
    val scannedAt: Long,
    /** Chosen in the printing picker; background collector reads leave it alone. */
    val pickedByHand: Boolean = false,
) {
    val imageUrl: String
        get() = "https://cards.scryfall.io/normal/${if (face == 1) "back" else "front"}/${scryfallId[0]}/${scryfallId[1]}/$scryfallId.jpg"
    val needsReview get() = !printingCertain || confidence == "LOW"
}

/** Scans survive the app being killed; this is the only copy until inventory sync exists. */
class SessionStore(private val file: File) {
    private val json = Json { ignoreUnknownKeys = true }

    fun load(): List<ScannedCard> = try {
        if (file.exists()) json.decodeFromString<List<ScannedCard>>(file.readText()) else emptyList()
    } catch (_: Exception) {
        emptyList()
    }

    fun save(cards: List<ScannedCard>) {
        val tmp = File(file.path + ".tmp")
        tmp.writeText(json.encodeToString(cards))
        tmp.renameTo(file)
    }

    companion object {
        /** "4 Lightning Bolt (M10) 146" lines, foils marked *F*. Deck Lotus / Moxfield style. */
        fun exportText(cards: List<ScannedCard>): String =
            cards.groupBy { Triple(it.scryfallId, it.face, it.foil) }.values
                .sortedBy { it.first().cardName }
                .joinToString("\n") { g ->
                    val c = g.first()
                    "${g.size} ${c.cardName} (${c.setCode}) ${c.collectorNumber}${if (c.foil) " *F*" else ""}"
                }
    }
}
