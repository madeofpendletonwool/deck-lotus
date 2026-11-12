package com.collinpendleton.decklotus.core

import java.text.Normalizer
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/** Fuzzy lookup of OCR'd name-bar text against every face name. */
class NameMatcher(names: Collection<String>) {
    private val byLength: Map<Int, List<String>> = names.filter { it.isNotEmpty() }.groupBy { it.length }

    data class Hit(val normalizedName: String, val similarity: Double)

    fun best(ocr: String): Hit? {
        val q = normalize(ocr)
        if (q.length < 3) return null
        val slack = max(2, q.length * 35 / 100)
        var best: Hit? = null
        for (len in (q.length - slack)..(q.length + slack)) {
            val bucket = byLength[len] ?: continue
            for (name in bucket) {
                val maxLen = max(len, q.length)
                // Can't beat the current best? Skip the O(n·m) work.
                val floor = best?.similarity ?: 0.0
                if (1.0 - abs(len - q.length).toDouble() / maxLen <= floor) continue
                val sim = 1.0 - levenshtein(q, name).toDouble() / maxLen
                if (sim > floor) best = Hit(name, sim)
            }
        }
        return best
    }

    companion object {
        /**
         * Lowercase a-z/0-9 words separated by single spaces; accents dropped
         * ("Lim-Dûl's Vault" -> "limduls vault"). Hand-rolled because this
         * runs for every name in the index at startup.
         */
        fun normalize(s: String): String {
            val src = if (s.all { it.code < 128 }) s else Normalizer.normalize(s, Normalizer.Form.NFD)
            val out = StringBuilder(src.length)
            var pendingSpace = false
            for (ch in src) {
                val c = ch.lowercaseChar()
                when {
                    c in 'a'..'z' || c in '0'..'9' -> {
                        if (pendingSpace && out.isNotEmpty()) out.append(' ')
                        pendingSpace = false
                        out.append(c)
                    }
                    c.isWhitespace() -> pendingSpace = true
                    // Punctuation and combining accents vanish without splitting words.
                }
            }
            return out.toString()
        }

        fun levenshtein(a: String, b: String): Int {
            var prev = IntArray(b.length + 1) { it }
            var cur = IntArray(b.length + 1)
            for (i in 1..a.length) {
                cur[0] = i
                for (j in 1..b.length) {
                    val cost = if (a[i - 1] == b[j - 1]) 0 else 1
                    cur[j] = min(min(cur[j - 1] + 1, prev[j] + 1), prev[j - 1] + cost)
                }
                val t = prev; prev = cur; cur = t
            }
            return prev[b.length]
        }
    }
}
