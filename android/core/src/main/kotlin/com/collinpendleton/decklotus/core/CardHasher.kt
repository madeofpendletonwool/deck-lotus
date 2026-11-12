package com.collinpendleton.decklotus.core

import kotlin.math.PI
import kotlin.math.cos

/**
 * Perceptual fingerprint of an upright, straightened card image.
 *
 * Two DCT hashes: one of the art box (most of what tells printings apart)
 * and one of the whole card (frame style, text box, set symbol position,
 * which separates e.g. a borderless reprint from the regular one with the
 * same art). Each bit says whether a low-frequency DCT coefficient is above
 * the median, so overall brightness and contrast don't matter.
 *
 * The phone and the indexer both go through this one function; any change
 * here must bump [VERSION] so stale indexes are refused rather than
 * silently matching badly.
 */
object CardHasher {
    const val VERSION = 1

    const val ART_WORDS = 2 // 128 bits
    const val FULL_WORDS = 1 // 64 bits
    const val WORDS = ART_WORDS + FULL_WORDS
    const val BITS = WORDS * 64

    // Art box of the modern (M15+) frame, as fractions of the card. Older and
    // borderless frames put the art elsewhere, but the same crop is taken on
    // both sides of the comparison, so it only has to be consistent.
    private const val ART_X0 = 0.08; private const val ART_X1 = 0.92
    private const val ART_Y0 = 0.115; private const val ART_Y1 = 0.55
    // Whole card, inset past the rounded corners and any background slop.
    private const val FULL_X0 = 0.04; private const val FULL_X1 = 0.96
    private const val FULL_Y0 = 0.03; private const val FULL_Y1 = 0.97

    private const val N = 32

    private val cosTable: Array<DoubleArray> = Array(N) { u ->
        DoubleArray(N) { x -> cos((2 * x + 1) * u * PI / (2 * N)) }
    }

    /** Low-frequency coefficients in zig-zag order, DC excluded. */
    private val zigzag: List<Pair<Int, Int>> = buildList {
        for (s in 1 until 2 * N - 1) {
            val range = if (s % 2 == 0) (0..s) else (s downTo 0)
            for (u in range) {
                val v = s - u
                if (u < N && v < N) add(u to v)
            }
        }
    }

    fun hash(card: GrayImage): LongArray {
        val out = LongArray(WORDS)
        val art = card.areaResample(ART_X0, ART_Y0, ART_X1, ART_Y1, N, N)
        pack(dctBits(art, ART_WORDS * 64), out, 0)
        val full = card.areaResample(FULL_X0, FULL_Y0, FULL_X1, FULL_Y1, N, N)
        pack(dctBits(full, FULL_WORDS * 64), out, ART_WORDS)
        return out
    }

    fun distance(a: LongArray, aOff: Int, b: LongArray, bOff: Int = 0): Int {
        var d = 0
        for (i in 0 until WORDS) d += java.lang.Long.bitCount(a[aOff + i] xor b[bOff + i])
        return d
    }

    /**
     * Variance of a 3x3 Laplacian over the art box. Low means the frame is
     * blurry (card still moving, or out of focus).
     */
    fun sharpness(card: GrayImage): Double {
        val w = 160; val h = 90
        val p = card.areaResample(ART_X0, ART_Y0, ART_X1, ART_Y1, w, h)
        var sum = 0.0; var sumSq = 0.0; var n = 0
        for (y in 1 until h - 1) for (x in 1 until w - 1) {
            val i = y * w + x
            val l = 4 * p[i] - p[i - 1] - p[i + 1] - p[i - w] - p[i + w]
            sum += l; sumSq += l * l; n++
        }
        val mean = sum / n
        return sumSq / n - mean * mean
    }

    private fun dctBits(px: FloatArray, bits: Int): BooleanArray {
        // Separable 2D DCT-II, only the coefficients we keep matter but N is
        // tiny so computing the full block is cheaper than being clever.
        val rows = Array(N) { DoubleArray(N) }
        for (y in 0 until N) for (u in 0 until N) {
            var s = 0.0
            val c = cosTable[u]
            for (x in 0 until N) s += c[x] * px[y * N + x]
            rows[y][u] = s
        }
        val coeffs = DoubleArray(bits)
        for (k in 0 until bits) {
            val (u, v) = zigzag[k]
            var s = 0.0
            val c = cosTable[v]
            for (y in 0 until N) s += c[y] * rows[y][u]
            coeffs[k] = s
        }
        val median = coeffs.sortedArray().let { (it[bits / 2 - 1] + it[bits / 2]) / 2 }
        return BooleanArray(bits) { coeffs[it] > median }
    }

    private fun pack(bits: BooleanArray, out: LongArray, wordOffset: Int) {
        for (i in bits.indices) if (bits[i]) {
            out[wordOffset + i / 64] = out[wordOffset + i / 64] or (1L shl (i % 64))
        }
    }
}
