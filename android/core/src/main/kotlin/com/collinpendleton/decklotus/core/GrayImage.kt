package com.collinpendleton.decklotus.core

import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/** Luminance raster, values 0..255, row-major. */
class GrayImage(val width: Int, val height: Int, val data: FloatArray) {
    init {
        require(data.size == width * height) { "data size ${data.size} != $width x $height" }
    }

    operator fun get(x: Int, y: Int): Float = data[y * width + x]

    fun rotated180(): GrayImage {
        val out = FloatArray(data.size)
        val last = data.size - 1
        for (i in data.indices) out[i] = data[last - i]
        return GrayImage(width, height, out)
    }

    /**
     * Box-filter the region [x0,x1)×[y0,y1) (fractions of width/height, may
     * fall slightly outside 0..1; edges are clamped) down to outW×outH.
     * Every source pixel contributes in proportion to its overlap, so the
     * result barely depends on the source resolution, which is what lets a
     * 146px Scryfall thumbnail and a 1360px phone warp hash the same.
     */
    fun areaResample(x0: Double, y0: Double, x1: Double, y1: Double, outW: Int, outH: Int): FloatArray {
        val hw = axisWeights(x0 * width, x1 * width, outW, width)
        val vw = axisWeights(y0 * height, y1 * height, outH, height)
        val rowLo = vw.minOf { it.start }
        val rowHi = vw.maxOf { it.start + it.weights.size }
        // Horizontal pass over the rows we need.
        val tmp = Array(rowHi - rowLo) { FloatArray(outW) }
        for (r in rowLo until rowHi) {
            val row = tmp[r - rowLo]
            val base = r * width
            for (ox in 0 until outW) {
                val w = hw[ox]
                var s = 0.0
                for (k in w.weights.indices) s += w.weights[k] * data[base + w.start + k]
                row[ox] = s.toFloat()
            }
        }
        val out = FloatArray(outW * outH)
        for (oy in 0 until outH) {
            val w = vw[oy]
            for (ox in 0 until outW) {
                var s = 0.0
                for (k in w.weights.indices) s += w.weights[k] * tmp[w.start + k - rowLo][ox]
                out[oy * outW + ox] = s.toFloat()
            }
        }
        return out
    }

    private class AxisWeight(val start: Int, val weights: DoubleArray)

    private fun axisWeights(a0: Double, a1: Double, n: Int, limit: Int): Array<AxisWeight> {
        val step = (a1 - a0) / n
        return Array(n) { k ->
            // Clamp the cell into the image so out-of-range jitter samples the edge.
            var s = (a0 + k * step).coerceIn(0.0, limit - 1e-6)
            var e = (a0 + (k + 1) * step).coerceIn(0.0, limit.toDouble())
            if (e - s < 1e-6) {
                s = min(s, limit - 1.0)
                e = s + 1.0
            }
            val i0 = floor(s).toInt().coerceAtLeast(0)
            val i1 = ceil(e).toInt().coerceAtMost(limit)
            val ws = DoubleArray(max(1, i1 - i0))
            var sum = 0.0
            for (i in i0 until i1) {
                val w = max(0.0, min(e, i + 1.0) - max(s, i.toDouble()))
                ws[i - i0] = w
                sum += w
            }
            if (sum <= 0) ws[0] = 1.0 else for (i in ws.indices) ws[i] /= sum
            AxisWeight(i0, ws)
        }
    }

    companion object {
        fun fromRgb(width: Int, height: Int, rgb: IntArray): GrayImage {
            val out = FloatArray(width * height)
            for (i in out.indices) {
                val p = rgb[i]
                out[i] = luma((p shr 16) and 0xff, (p shr 8) and 0xff, p and 0xff)
            }
            return GrayImage(width, height, out)
        }

        fun fromBytes(width: Int, height: Int, gray: ByteArray, rowStride: Int = width): GrayImage {
            val out = FloatArray(width * height)
            for (y in 0 until height) for (x in 0 until width) {
                out[y * width + x] = (gray[y * rowStride + x].toInt() and 0xff).toFloat()
            }
            return GrayImage(width, height, out)
        }

        fun luma(r: Int, g: Int, b: Int): Float = 0.299f * r + 0.587f * g + 0.114f * b
    }
}
