package com.collinpendleton.decklotus.core

/**
 * Printed border colour. Reprints often share art but not border (Mystery
 * Booster's white-bordered playtest-style reprints vs the black-bordered
 * originals), and the fingerprint deliberately trims the border off, so this
 * is the tie-breaker that's cheap to read.
 */
enum class Border(val code: Int) {
    UNKNOWN(0), BLACK(1), WHITE(2), BORDERLESS(3), SILVER(4), GOLD(5), YELLOW(6);

    /** Collapse to what a camera can reliably tell apart: dark, light, or neither. */
    val tone: Border
        get() = when (this) {
            BLACK -> BLACK
            WHITE, SILVER -> WHITE
            else -> UNKNOWN
        }

    companion object {
        fun of(code: Int) = entries.firstOrNull { it.code == code } ?: UNKNOWN
        fun fromScryfall(s: String?) = when (s) {
            "black" -> BLACK
            "white" -> WHITE
            "borderless" -> BORDERLESS
            "silver" -> SILVER
            "gold" -> GOLD
            "yellow" -> YELLOW
            else -> UNKNOWN
        }

        /**
         * Reads the border band of a straightened card: compares the outer
         * ring against the card's interior so exposure doesn't matter.
         * Returns BLACK, WHITE or UNKNOWN (borderless, gold, glare, doubt).
         */
        fun measure(card: GrayImage): Border {
            // Ring between 0.8% and 2.6% in from the edge: inside the rounded
            // corners' slop, outside the frame's own coloured edge.
            val n = 64
            val top = card.areaResample(0.08, 0.008, 0.92, 0.026, n, 1)
            val bottom = card.areaResample(0.08, 0.974, 0.92, 0.992, n, 1)
            val left = card.areaResample(0.008, 0.08, 0.026, 0.92, 1, n)
            val right = card.areaResample(0.974, 0.08, 0.992, 0.92, 1, n)
            val ring = (top + bottom + left + right).sorted()
            // Median of the ring ignores a glare streak along one side.
            val band = ring[ring.size / 2]
            val inner = card.areaResample(0.1, 0.1, 0.9, 0.9, 16, 16).sorted()
            val innerMid = inner[inner.size / 2]
            val innerHi = inner[inner.size * 9 / 10]
            val innerLo = inner[inner.size / 10]
            return when {
                band < innerLo + 8 && band < innerMid - 25 -> BLACK
                band > innerHi - 8 && band > innerMid + 25 -> WHITE
                else -> UNKNOWN
            }
        }
    }
}
