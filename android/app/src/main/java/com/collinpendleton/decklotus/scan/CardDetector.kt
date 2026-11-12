package com.collinpendleton.decklotus.scan

import org.opencv.core.Core
import org.opencv.core.Mat
import org.opencv.core.MatOfPoint
import org.opencv.core.MatOfPoint2f
import org.opencv.core.Point
import org.opencv.core.Size
import org.opencv.imgproc.Imgproc
import kotlin.math.atan2
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/**
 * Four corners of a card in frame pixel coordinates, ordered clockwise
 * starting at a short edge, so warping p0..p3 onto a portrait rectangle
 * gives the card either upright or upside down (never mirrored or sideways).
 */
class Quad(val p: Array<Point>) {
    val center get() = Point(p.sumOf { it.x } / 4, p.sumOf { it.y } / 4)
    fun maxShift(other: Quad) = p.indices.maxOf { hypot(p[it].x - other.p[it].x, p[it].y - other.p[it].y) }
}

/**
 * Finds the biggest card-shaped quadrilateral in a frame. Works on a
 * downscaled copy (~640px) for speed, then scales the corners back up so
 * the warp samples the full-resolution frame.
 *
 * Needs the card to contrast with what it's lying on: a mid-tone or
 * coloured mat works for both black- and white-bordered cards.
 */
class CardDetector {
    private val small = Mat()
    private val gray = Mat()
    private val edges = Mat()
    private val hierarchy = Mat()
    private val kernel = Imgproc.getStructuringElement(Imgproc.MORPH_RECT, Size(3.0, 3.0))

    fun detect(rgba: Mat): Quad? {
        val scale = 640.0 / max(rgba.cols(), rgba.rows())
        Imgproc.resize(rgba, small, Size(), scale, scale, Imgproc.INTER_AREA)
        Imgproc.cvtColor(small, gray, Imgproc.COLOR_RGBA2GRAY)
        Imgproc.GaussianBlur(gray, gray, Size(5.0, 5.0), 0.0)

        val area = (gray.cols() * gray.rows()).toDouble()
        val m = Core.mean(gray).`val`[0]
        Imgproc.Canny(gray, edges, max(10.0, 0.5 * m), min(255.0, 1.2 * m + 20))
        Imgproc.dilate(edges, edges, kernel)
        val q = bestQuad(edges, area)
            ?: run {
                // Fallback for soft edges: split card from background by brightness.
                Imgproc.threshold(gray, edges, 0.0, 255.0, Imgproc.THRESH_BINARY + Imgproc.THRESH_OTSU)
                bestQuad(edges, area)
            }
            ?: return null
        return order(q.map { Point(it.x / scale, it.y / scale) }.toTypedArray())
    }

    private fun bestQuad(binary: Mat, imageArea: Double): Array<Point>? {
        val contours = ArrayList<MatOfPoint>()
        Imgproc.findContours(binary, contours, hierarchy, Imgproc.RETR_LIST, Imgproc.CHAIN_APPROX_SIMPLE)
        var best: Array<Point>? = null
        var bestArea = 0.0
        for (c in contours) {
            val a = Imgproc.contourArea(c)
            if (a < imageArea * 0.06 || a > imageArea * 0.97 || a <= bestArea) { c.release(); continue }
            val c2f = MatOfPoint2f(*c.toArray())
            val peri = Imgproc.arcLength(c2f, true)
            val approx = MatOfPoint2f()
            Imgproc.approxPolyDP(c2f, approx, 0.025 * peri, true)
            var pts: Array<Point>? = null
            if (approx.rows() == 4 && Imgproc.isContourConvex(MatOfPoint(*approx.toArray()))) {
                pts = approx.toArray()
            } else {
                // Rounded corners sometimes approximate to 5-8 points; accept the
                // contour if it fills its minimum-area rectangle.
                val rect = Imgproc.minAreaRect(c2f)
                if (a / (rect.size.width * rect.size.height) > 0.88) {
                    pts = arrayOfNulls<Point>(4).also { rect.points(it) }.requireNoNulls()
                }
            }
            if (pts != null && cardShaped(pts) && clearOfEdges(pts, binary.cols(), binary.rows())) {
                best = pts; bestArea = a
            }
            approx.release(); c2f.release(); c.release()
        }
        return best
    }

    /**
     * A card sliding into view gets cut off by the frame edge, and that edge
     * then reads as the card's fourth side: a bogus outline hugging a corner.
     * Only accept cards fully inside the frame.
     */
    private fun clearOfEdges(p: Array<Point>, w: Int, h: Int): Boolean {
        val m = 0.015 * minOf(w, h)
        return p.all { it.x > m && it.y > m && it.x < w - m && it.y < h - m }
    }

    /** MTG cards are 63×88mm; allow for perspective. */
    private fun cardShaped(p: Array<Point>): Boolean {
        fun d(i: Int, j: Int) = hypot(p[i].x - p[j].x, p[i].y - p[j].y)
        val a = (d(0, 1) + d(2, 3)) / 2
        val b = (d(1, 2) + d(3, 0)) / 2
        val ratio = min(a, b) / max(a, b)
        return ratio in 0.60..0.84
    }

    private fun order(pts: Array<Point>): Quad {
        val cx = pts.sumOf { it.x } / 4; val cy = pts.sumOf { it.y } / 4
        // Increasing angle in image space (y down) is clockwise on screen.
        val cw = pts.sortedBy { atan2(it.y - cy, it.x - cx) }
        fun d(i: Int, j: Int) = hypot(cw[i].x - cw[j].x, cw[i].y - cw[j].y)
        val startOnShortEdge = if (d(0, 1) <= d(1, 2)) 0 else 1
        return Quad(Array(4) { cw[(it + startOnShortEdge) % 4] })
    }

    /** Straighten the card into a portrait [w]×[h] RGBA image. */
    fun warp(rgba: Mat, q: Quad, w: Int, h: Int, out: Mat) {
        val src = MatOfPoint2f(*q.p)
        val dst = MatOfPoint2f(Point(0.0, 0.0), Point(w.toDouble(), 0.0), Point(w.toDouble(), h.toDouble()), Point(0.0, h.toDouble()))
        val m = Imgproc.getPerspectiveTransform(src, dst)
        Imgproc.warpPerspective(rgba, out, m, Size(w.toDouble(), h.toDouble()), Imgproc.INTER_LINEAR)
        m.release(); src.release(); dst.release()
    }
}
