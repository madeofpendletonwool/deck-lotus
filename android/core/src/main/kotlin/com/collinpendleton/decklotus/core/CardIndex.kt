package com.collinpendleton.decklotus.core

import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.nio.ByteBuffer
import java.util.UUID
import java.util.zip.GZIPInputStream
import java.util.zip.GZIPOutputStream

/** One scannable face of one printing. */
data class IndexEntry(
    val scryfallId: UUID,
    /** 0 = front, 1 = back of a double-faced card. */
    val face: Int,
    /** Full card name, "Front // Back" for multi-face cards. */
    val cardName: String,
    /** The name printed on this face. */
    val faceName: String,
    val setCode: String,
    val collectorNumber: String,
    val finishes: Int,
    val border: Border,
    val hash: LongArray,
) {
    val imageUrl: String
        get() {
            val id = scryfallId.toString()
            val side = if (face == 1) "back" else "front"
            return "https://cards.scryfall.io/normal/$side/${id[0]}/${id[1]}/$id.jpg"
        }

    companion object {
        const val FINISH_NONFOIL = 1
        const val FINISH_FOIL = 2
        const val FINISH_ETCHED = 4
    }
}

data class Match(val entry: Int, val distance: Int)

/**
 * Every printing's fingerprint plus the metadata needed to name it. Kept as
 * parallel arrays because the phone holds ~115k of these in memory and
 * scans the whole hash array on each identification.
 */
class CardIndex private constructor(
    val builtAt: Long,
    private val idHi: LongArray,
    private val idLo: LongArray,
    private val faces: ByteArray,
    private val cardNames: Array<String>,
    private val faceNames: Array<String>,
    private val setCodes: Array<String>,
    private val numbers: Array<String>,
    private val finishes: ByteArray,
    private val borders: ByteArray,
    private val hashes: LongArray,
) {
    val size: Int get() = idHi.size

    /**
     * Normalised face name -> entries, for the OCR fallback. Built off the
     * scanning path by [buildNameTables]; until then name OCR is skipped
     * rather than making the first scan wait.
     */
    @Volatile private var byFaceName: Map<String, IntArray>? = null
    @Volatile var nameMatcherOrNull: NameMatcher? = null
        private set

    fun buildNameTables() {
        if (nameMatcherOrNull != null) return
        val normalized = HashMap<String, String>()
        val m = HashMap<String, MutableList<Int>>()
        for (i in 0 until size) {
            // ~33k distinct face names across ~108k entries: normalise each once.
            val key = normalized.getOrPut(faceNames[i]) { NameMatcher.normalize(faceNames[i]) }
            m.getOrPut(key) { ArrayList(4) }.add(i)
        }
        byFaceName = m.mapValues { it.value.toIntArray() }
        nameMatcherOrNull = NameMatcher(m.keys)
    }

    val nameMatcher: NameMatcher get() { buildNameTables(); return nameMatcherOrNull!! }

    fun entry(i: Int) = IndexEntry(
        scryfallId = UUID(idHi[i], idLo[i]),
        face = faces[i].toInt(),
        cardName = cardNames[i],
        faceName = faceNames[i],
        setCode = setCodes[i],
        collectorNumber = numbers[i],
        finishes = finishes[i].toInt(),
        border = Border.of(borders[i].toInt()),
        hash = hashes.copyOfRange(i * CardHasher.WORDS, (i + 1) * CardHasher.WORDS),
    )

    fun cardName(i: Int) = cardNames[i]
    fun setCode(i: Int) = setCodes[i]
    fun collectorNumber(i: Int) = numbers[i]
    fun border(i: Int) = Border.of(borders[i].toInt())

    fun distance(i: Int, hash: LongArray) = CardHasher.distance(hashes, i * CardHasher.WORDS, hash)

    /** Brute-force nearest neighbours. ~115k × 3 popcounts is a millisecond or two. */
    fun nearest(hash: LongArray, k: Int): List<Match> {
        val bestD = IntArray(k) { Int.MAX_VALUE }
        val bestI = IntArray(k) { -1 }
        val w = CardHasher.WORDS
        val h0 = hash[0]; val h1 = hash[1]; val h2 = hash[2]
        for (i in 0 until size) {
            val o = i * w
            val d = java.lang.Long.bitCount(hashes[o] xor h0) +
                java.lang.Long.bitCount(hashes[o + 1] xor h1) +
                java.lang.Long.bitCount(hashes[o + 2] xor h2)
            if (d < bestD[k - 1]) {
                var j = k - 1
                while (j > 0 && bestD[j - 1] > d) {
                    bestD[j] = bestD[j - 1]; bestI[j] = bestI[j - 1]; j--
                }
                bestD[j] = d; bestI[j] = i
            }
        }
        return (0 until k).filter { bestI[it] >= 0 }.map { Match(bestI[it], bestD[it]) }
    }

    /** Entries are sorted by card name, so a card's printings are one contiguous run. */
    fun printingsOfCard(cardName: String): IntArray {
        var lo = 0; var hi = size
        while (lo < hi) {
            val mid = (lo + hi) ushr 1
            if (cardNames[mid] < cardName) lo = mid + 1 else hi = mid
        }
        var end = lo
        while (end < size && cardNames[end] == cardName) end++
        return IntArray(end - lo) { lo + it }
    }

    fun entriesForFaceName(normalized: String): IntArray = byFaceName?.get(normalized) ?: IntArray(0)

    /**
     * Format 3 is columnar: every distinct string once, then each field as
     * one block of ints/bytes/longs. The phone reads it with a handful of
     * bulk copies instead of ~400k small reads.
     */
    fun write(out: OutputStream) {
        val pool = LinkedHashMap<String, Int>()
        fun ref(str: String) = pool.getOrPut(str) { pool.size }
        val cardRefs = IntArray(size) { ref(cardNames[it]) }
        val faceRefs = IntArray(size) { if (faceNames[it] == cardNames[it]) -1 else ref(faceNames[it]) }
        val setRefs = IntArray(size) { ref(setCodes[it]) }
        val numRefs = IntArray(size) { ref(numbers[it]) }
        DataOutputStream(BufferedOutputStream(GZIPOutputStream(out), 1 shl 16)).use { d ->
            d.writeInt(MAGIC)
            d.writeInt(FORMAT_VERSION)
            d.writeInt(CardHasher.VERSION)
            d.writeLong(builtAt)
            d.writeInt(size)
            d.writeInt(pool.size)
            for (str in pool.keys) d.writeUTF(str)
            for (col in listOf(cardRefs, faceRefs, setRefs, numRefs)) d.write(ints(col))
            d.write(faces); d.write(finishes); d.write(borders)
            d.write(longs(idHi)); d.write(longs(idLo)); d.write(longs(hashes))
        }
    }

    class Builder {
        private val entries = mutableListOf<IndexEntry>()
        fun add(e: IndexEntry) {
            require(e.hash.size == CardHasher.WORDS)
            entries += e
        }

        fun build(builtAt: Long = System.currentTimeMillis()): CardIndex {
            val sorted = entries.sortedWith(compareBy({ it.cardName }, { it.setCode }, { it.collectorNumber }, { it.face }))
            val n = sorted.size
            val hashes = LongArray(n * CardHasher.WORDS)
            sorted.forEachIndexed { i, e -> e.hash.copyInto(hashes, i * CardHasher.WORDS) }
            return CardIndex(
                builtAt,
                LongArray(n) { sorted[it].scryfallId.mostSignificantBits },
                LongArray(n) { sorted[it].scryfallId.leastSignificantBits },
                ByteArray(n) { sorted[it].face.toByte() },
                Array(n) { sorted[it].cardName },
                Array(n) { sorted[it].faceName },
                Array(n) { sorted[it].setCode },
                Array(n) { sorted[it].collectorNumber },
                ByteArray(n) { sorted[it].finishes.toByte() },
                ByteArray(n) { sorted[it].border.code.toByte() },
                hashes,
            )
        }
    }

    companion object {
        private const val MAGIC = 0x444C4349 // "DLCI"
        private const val FORMAT_VERSION = 3

        fun read(input: InputStream): CardIndex {
            DataInputStream(BufferedInputStream(GZIPInputStream(input, 1 shl 16), 1 shl 16)).use { d ->
                require(d.readInt() == MAGIC) { "Not a Deck Lotus card index" }
                val fmt = d.readInt()
                require(fmt == FORMAT_VERSION) { "Card index format $fmt, expected $FORMAT_VERSION. Rebuild the index." }
                val hv = d.readInt()
                require(hv == CardHasher.VERSION) {
                    "Card index was built with hash version $hv, this build uses ${CardHasher.VERSION}. Rebuild the index."
                }
                val builtAt = d.readLong()
                val n = d.readInt()
                val pool = Array(d.readInt()) { d.readUTF() }
                val cardRefs = readInts(d, n); val faceRefs = readInts(d, n)
                val setRefs = readInts(d, n); val numRefs = readInts(d, n)
                val faces = ByteArray(n).also { d.readFully(it) }
                val fin = ByteArray(n).also { d.readFully(it) }
                val bord = ByteArray(n).also { d.readFully(it) }
                val idHi = readLongs(d, n); val idLo = readLongs(d, n)
                val hashes = readLongs(d, n * CardHasher.WORDS)
                val cardNames = Array(n) { pool[cardRefs[it]] }
                return CardIndex(
                    builtAt, idHi, idLo, faces,
                    cardNames,
                    Array(n) { if (faceRefs[it] < 0) cardNames[it] else pool[faceRefs[it]] },
                    Array(n) { pool[setRefs[it]] },
                    Array(n) { pool[numRefs[it]] },
                    fin, bord, hashes,
                )
            }
        }

        private fun ints(a: IntArray) = ByteBuffer.allocate(a.size * 4).also { it.asIntBuffer().put(a) }.array()
        private fun longs(a: LongArray) = ByteBuffer.allocate(a.size * 8).also { it.asLongBuffer().put(a) }.array()
        private fun readInts(d: DataInputStream, n: Int): IntArray {
            val b = ByteArray(n * 4); d.readFully(b)
            return IntArray(n).also { ByteBuffer.wrap(b).asIntBuffer().get(it) }
        }
        private fun readLongs(d: DataInputStream, n: Int): LongArray {
            val b = ByteArray(n * 8); d.readFully(b)
            return LongArray(n).also { ByteBuffer.wrap(b).asLongBuffer().get(it) }
        }
    }
}
