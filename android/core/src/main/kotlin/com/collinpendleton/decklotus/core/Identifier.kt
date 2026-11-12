package com.collinpendleton.decklotus.core

/**
 * Turns a fingerprint, plus whatever else could be read, into one printing.
 * It works in two steps so the phone can answer fast:
 *
 * 1. [identifyCard]: which card is it? The picture match usually settles it
 *    alone, in a few ms. Name-bar OCR is only needed when the picture is
 *    unsure (heavy glare, odd frame).
 * 2. [pickPrinting]: which printing? New art means a new printing, so the
 *    picture often settles this too. Reprints that share art are separated
 *    by border colour (free) and then the collector line (OCR), which the
 *    phone can keep reading over the next few frames while the scan already
 *    shows up in the list.
 */
class Identifier(private val index: CardIndex, private val t: Thresholds = Thresholds()) {

    /** Bit distances out of [CardHasher.BITS]. Tuned with `indexer eval`. */
    data class Thresholds(
        /** At or below this the picture match is trusted outright. */
        val sure: Int = 40,
        /** Picture match trusted if it also beats the runner-up card by [margin]. */
        val likely: Int = 58,
        val margin: Int = 14,
        /** Printings within this many bits of the best are treated as "same art". */
        val sameArt: Int = 10,
        /** Minimum name-bar similarity to use OCR at all. */
        val nameOk: Double = 0.80,
        /** Name-bar similarity at which OCR alone can name the card. */
        val nameSure: Double = 0.92,
    )

    enum class Confidence { HIGH, MEDIUM, LOW }

    /** Step 1's answer: the card, and every printing of it ranked by picture distance. */
    data class CardMatch(
        val cardName: String,
        val confidence: Confidence,
        val printings: List<Match>,
        /** Printings close enough to the best that the picture can't separate them. */
        val sameArt: List<Match>,
        val bestDistance: Int,
        val runnerUpDistance: Int,
        val reason: String,
    )

    data class Printing(val entry: Int, val certain: Boolean, val why: String)

    /** Convenience for one-shot use (tests, eval): both steps, all evidence at once. */
    data class Result(
        val entry: Int,
        val confidence: Confidence,
        val printingCertain: Boolean,
        val alternatives: List<Match>,
        val bestDistance: Int,
        val runnerUpDistance: Int,
        val reason: String,
    )

    /** True when the picture alone is good enough to name the card without OCR. */
    fun pictureIsEnough(nearest: List<Match>): Boolean {
        val top = nearest.firstOrNull() ?: return false
        if (top.distance <= t.sure) return true
        val name = index.cardName(top.entry)
        val runnerUp = nearest.firstOrNull { index.cardName(it.entry) != name }?.distance ?: CardHasher.BITS
        return top.distance <= t.likely && runnerUp - top.distance >= t.margin
    }

    fun identifyCard(hash: LongArray, nameOcr: String?, nearest: List<Match> = index.nearest(hash, 40)): CardMatch? {
        if (nearest.isEmpty()) return null
        val top = nearest[0]
        val topName = index.cardName(top.entry)
        val runnerUp = nearest.firstOrNull { index.cardName(it.entry) != topName }?.distance ?: CardHasher.BITS
        val margin = runnerUp - top.distance

        val nameHit = nameOcr?.takeIf { it.isNotBlank() }?.let { index.nameMatcherOrNull?.best(it) }
            ?.takeIf { it.similarity >= t.nameOk }
        val ocrCardNames: Set<String> = nameHit?.let { hit ->
            index.entriesForFaceName(hit.normalizedName).map { index.cardName(it) }.toSet()
        } ?: emptySet()

        val (cardName, confidence, reason) = when {
            top.distance <= t.sure ->
                Triple(topName, Confidence.HIGH, "picture d=${top.distance}")
            top.distance <= t.likely && margin >= t.margin ->
                Triple(topName, if (topName in ocrCardNames) Confidence.HIGH else Confidence.MEDIUM, "picture d=${top.distance} margin=$margin")
            // Picture unsure; does OCR agree with one of the close candidates?
            ocrCardNames.isNotEmpty() && nearest.any { index.cardName(it.entry) in ocrCardNames && it.distance <= t.likely + t.margin } -> {
                val m = nearest.first { index.cardName(it.entry) in ocrCardNames }
                Triple(index.cardName(m.entry), Confidence.MEDIUM, "name+picture d=${m.distance}")
            }
            nameHit != null && nameHit.similarity >= t.nameSure && ocrCardNames.size == 1 ->
                Triple(ocrCardNames.first(), Confidence.LOW, "name only (${"%.2f".format(nameHit.similarity)})")
            else -> return null
        }

        val printings = index.printingsOfCard(cardName)
            .map { Match(it, index.distance(it, hash)) }
            .sortedBy { it.distance }
        val best = printings.first()
        return CardMatch(
            cardName = cardName,
            confidence = confidence,
            printings = printings,
            sameArt = printings.filter { it.distance <= best.distance + t.sameArt },
            bestDistance = top.distance,
            runnerUpDistance = runnerUp,
            reason = reason,
        )
    }

    /**
     * Narrow [m] to one printing. [border] is what the camera saw (BLACK,
     * WHITE or UNKNOWN); [collector] is everything OCR has read from the
     * bottom of the card so far, possibly pooled over several frames.
     */
    fun pickPrinting(m: CardMatch, border: Border, collector: CollectorLine.Parsed): Printing {
        // 1. Collector line. A solid read (set and number) can even overrule the
        //    picture, e.g. when glare skewed which art looked closest.
        if (!collector.isEmpty) {
            val scored = m.printings.map { it to CollectorLine.score(collector, index.setCode(it.entry), index.collectorNumber(it.entry)) }
            val topScore = scored.maxOf { it.second }
            val winners = scored.filter { it.second == topScore }.map { it.first }
            if (topScore >= 4) return Printing(winners.minBy { it.distance }.entry, true, "collector line")
            if (topScore >= 2) {
                // Only half a read (just the number or just the set): trust it inside the same-art group.
                val inGroup = winners.filter { w -> m.sameArt.any { it.entry == w.entry } }
                if (inGroup.size == 1) return Printing(inGroup[0].entry, true, "collector (partial)")
            }
        }
        // 2. Border colour, among printings that share the art.
        var group = m.sameArt
        var why = "picture"
        val tone = border.tone
        if (tone != Border.UNKNOWN) {
            val matching = group.filter { index.border(it.entry).tone == tone }
            if (matching.isNotEmpty() && matching.size < group.size) {
                group = matching
                why = "picture + ${tone.name.lowercase()} border"
            }
        }
        val certain = group.size == 1 && m.confidence != Confidence.LOW
        return Printing(group.first().entry, certain, why)
    }

    fun identify(
        hash: LongArray,
        nameOcr: String?,
        collectorOcr: List<String>,
        nearest: List<Match> = index.nearest(hash, 40),
        border: Border = Border.UNKNOWN,
    ): Result? {
        val m = identifyCard(hash, nameOcr, nearest) ?: return null
        val p = pickPrinting(m, border, CollectorLine.parse(collectorOcr))
        return Result(p.entry, m.confidence, p.certain, m.printings.take(60), m.bestDistance, m.runnerUpDistance, "${m.reason}; ${p.why}")
    }
}
