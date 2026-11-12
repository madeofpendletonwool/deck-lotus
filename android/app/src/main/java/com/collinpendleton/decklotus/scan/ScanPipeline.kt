package com.collinpendleton.decklotus.scan

import android.graphics.Bitmap
import android.os.SystemClock
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import com.collinpendleton.decklotus.core.Border
import com.collinpendleton.decklotus.core.CardHasher
import com.collinpendleton.decklotus.core.CardIndex
import com.collinpendleton.decklotus.core.CollectorLine
import com.collinpendleton.decklotus.core.GrayImage
import com.collinpendleton.decklotus.core.Identifier
import org.opencv.android.Utils
import org.opencv.core.Core
import org.opencv.core.CvType
import org.opencv.core.Mat
import org.opencv.core.Rect
import org.opencv.core.Size
import org.opencv.imgproc.Imgproc
import kotlin.math.hypot

enum class Phase { NO_INDEX, SEARCHING, STEADYING, BLURRY, READING, CHECKING_PRINTING, HOLDING, UNKNOWN }

/** What the overlay needs each frame. Corners are 0..1 in the upright frame. */
data class FrameState(
    val phase: Phase,
    val corners: List<Pair<Float, Float>>? = null,
    val frameAspect: Float = 9f / 16f,
    val fps: Float = 0f,
    val sharpness: Int = 0,
)

/** A new card. [key] ties later [PrintingUpdate]s to it. */
data class ScanEvent(
    val key: Long,
    val entry: Int,
    val confidence: Identifier.Confidence,
    val printingCertain: Boolean,
    val hash: LongArray,
    val debug: String,
    val nameText: String,
    val warped: Bitmap,
)

/** The collector line (read over the frames after a scan) settled or changed the printing. */
data class PrintingUpdate(val key: Long, val entry: Int, val certain: Boolean, val collectorText: List<String>, val why: String)

/**
 * The continuous scan loop, run on every camera frame.
 *
 * A new card is reported as soon as one sharp frame identifies it, usually
 * from the picture alone with no OCR, so the beep comes within a frame or
 * two of the card landing. If several printings share its art, the loop
 * keeps reading the collector line on the following frames while the card
 * sits there, pooling what each frame reads, and sends a [PrintingUpdate]
 * once that settles it.
 *
 * The card currently under the camera isn't counted again. Once no card has
 * been seen for a few frames the loop re-arms, so a second copy of the same
 * card counts.
 */
class ScanPipeline(
    private val ocr: CardOcr,
    private val onState: (FrameState) -> Unit,
    private val onCard: (ScanEvent) -> Unit,
    private val onPrinting: (PrintingUpdate) -> Unit,
    private val onUnknown: (Bitmap, String) -> Unit,
) : ImageAnalysis.Analyzer {

    @Volatile var index: CardIndex? = null
        set(value) { field = value; identifier = value?.let { Identifier(it) } }
    private var identifier: Identifier? = null

    private val detector = CardDetector()
    private val warpedRgba = Mat()
    private val orientedRgba = Mat()
    private val warpedGray = Mat()
    private val grayBytes = ByteArray(WARP_W * WARP_H)

    /** The card under the camera, once identified. */
    private class Current(
        val key: Long,
        val hash: LongArray,
        val match: Identifier.CardMatch,
        val border: Border,
        var printing: Identifier.Printing,
        val since: Long,
    ) {
        var collector = CollectorLine.Parsed.EMPTY
        val collectorLines = mutableListOf<String>()
        var reads = 0
        var settled = printing.certain
    }

    private var current: Current? = null
    private var prevQuad: Quad? = null
    private var seenFrames = 0
    private var lostFrames = 0
    private var unknownTries = 0
    private var frameNo = 0L
    private var lastFrameAt = 0L
    private var fps = 0f
    private var lastSharpness = 0

    override fun analyze(image: ImageProxy) {
        try {
            process(image)
        } finally {
            image.close()
        }
    }

    private fun process(image: ImageProxy) {
        frameNo++
        val now = SystemClock.elapsedRealtime()
        if (lastFrameAt > 0) fps = 0.9f * fps + 0.1f * (1000f / (now - lastFrameAt).coerceAtLeast(1))
        lastFrameAt = now

        val idx = index
        val id = identifier
        if (idx == null || id == null) {
            onState(FrameState(Phase.NO_INDEX, fps = fps))
            return
        }

        val plane = image.planes[0]
        val full = Mat(image.height, image.width, CvType.CV_8UC4, plane.buffer, plane.rowStride.toLong())
        // Only look at what the preview shows (the shared viewport), so the
        // scanner never chases a card that's off screen.
        val crop = image.cropRect
        val frame = full.submat(Rect(crop.left, crop.top, crop.width(), crop.height()))
        val fw = crop.width(); val fh = crop.height()
        try {
            val rotation = image.imageInfo.rotationDegrees
            val quad = detector.detect(frame)
            val corners = quad?.let { uprightCorners(it, fw, fh, rotation) }
            // Width / height of the frame as displayed.
            val aspect = if (rotation % 180 == 0) fw.toFloat() / fh else fh.toFloat() / fw
            fun state(p: Phase) = onState(FrameState(p, corners, aspect, fps, lastSharpness))

            if (quad == null) {
                prevQuad = null
                seenFrames = 0
                if (++lostFrames >= REARM_AFTER_LOST_FRAMES) { current = null; unknownTries = 0 }
                return state(Phase.SEARCHING)
            }
            lostFrames = 0
            // Hand tremor is fine; only a card mid-flight is skipped. Blur is
            // judged from the image itself below.
            val moved = prevQuad?.let { it.maxShift(quad) / hypot(fw.toDouble(), fh.toDouble()) } ?: 1.0
            prevQuad = quad
            seenFrames = if (moved < MAX_MOTION) seenFrames + 1 else 0
            val cur = current
            if (seenFrames < 1) return state(if (cur != null) Phase.HOLDING else Phase.STEADYING)

            // Pace the work by what's left to do for the card in view.
            when {
                cur != null && cur.settled && frameNo % 4 != 0L -> return state(Phase.HOLDING)
                cur != null && !cur.settled && frameNo % 2 != 0L -> return state(Phase.CHECKING_PRINTING)
                cur == null && unknownTries > 0 && frameNo % 5 != 0L -> return state(Phase.UNKNOWN)
            }

            val t0 = SystemClock.elapsedRealtime()
            detector.warp(frame, quad, WARP_W, WARP_H, warpedRgba)
            Imgproc.cvtColor(warpedRgba, warpedGray, Imgproc.COLOR_RGBA2GRAY)
            warpedGray.get(0, 0, grayBytes)
            val gray = GrayImage.fromBytes(WARP_W, WARP_H, grayBytes)
            lastSharpness = CardHasher.sharpness(gray).toInt()
            if (lastSharpness < MIN_SHARPNESS) return state(if (cur != null) Phase.HOLDING else Phase.BLURRY)

            val upright = CardHasher.hash(gray)
            val flipped = CardHasher.hash(gray.rotated180())

            if (cur != null) {
                val same = minOf(CardHasher.distance(upright, 0, cur.hash), CardHasher.distance(flipped, 0, cur.hash)) < SAME_CARD_BITS
                if (same) {
                    if (!cur.settled) refinePrinting(cur, id, upright, flipped)
                    return state(if (cur.settled) Phase.HOLDING else Phase.CHECKING_PRINTING)
                }
                // A different card landed on top of the last one.
                current = null
            }

            val nUp = idx.nearest(upright, 40)
            val nDown = idx.nearest(flipped, 40)
            val upIsBetter = (nUp.firstOrNull()?.distance ?: Int.MAX_VALUE) <= (nDown.firstOrNull()?.distance ?: Int.MAX_VALUE)
            var flip = !upIsBetter
            var hash = if (upIsBetter) upright else flipped
            var nearest = if (upIsBetter) nUp else nDown
            val tPicture = SystemClock.elapsedRealtime() - t0

            var nameText = ""
            var match: Identifier.CardMatch? = null
            if (id.pictureIsEnough(nearest)) {
                match = id.identifyCard(hash, null, nearest)
            } else {
                // Picture unsure: read the name bar, trying the other way up if needed.
                state(Phase.READING)
                for (attempt in 0..1) {
                    orient(flip)
                    nameText = ocr.readName(orientedRgba)
                    match = id.identifyCard(hash, nameText, nearest)
                    if (match != null || attempt == 1) break
                    flip = !flip
                    hash = if (flip) flipped else upright
                    nearest = if (flip) nDown else nUp
                }
            }
            val elapsed = SystemClock.elapsedRealtime() - t0
            orient(flip)
            val thumb = thumbnail()

            if (match == null) {
                unknownTries++
                if (unknownTries == 3) onUnknown(thumb, nameText)
                return state(Phase.UNKNOWN)
            }
            unknownTries = 0
            val border = Border.measure(gray)
            val printing = id.pickPrinting(match, border, CollectorLine.Parsed.EMPTY)
            val key = System.nanoTime()
            val c = Current(key, hash, match, border, printing, SystemClock.elapsedRealtime())
            current = c
            onCard(
                ScanEvent(
                    key, printing.entry, match.confidence, printing.certain, hash,
                    debug = "${match.reason} · ${printing.why} · border ${border.name.lowercase()} · " +
                        "next card d=${match.runnerUpDistance} · picture ${tPicture} ms, total $elapsed ms",
                    nameText = nameText,
                    warped = thumb,
                ),
            )
            state(if (c.settled) Phase.HOLDING else Phase.CHECKING_PRINTING)
        } finally {
            frame.release()
            full.release()
        }
    }

    /** One more read of the collector line for the card in view; reports if it settles the printing. */
    private fun refinePrinting(c: Current, id: Identifier, upright: LongArray, flipped: LongArray) {
        // The card may have been nudged round; orient it to match the scan.
        val flip = CardHasher.distance(flipped, 0, c.hash) < CardHasher.distance(upright, 0, c.hash)
        orient(flip)
        val lines = ocr.readCollector(orientedRgba)
        c.reads++
        c.collectorLines += lines
        c.collector = c.collector + CollectorLine.parse(lines)
        val p = id.pickPrinting(c.match, c.border, c.collector)
        if (p.entry != c.printing.entry || p.certain != c.printing.certain) {
            c.printing = p
            onPrinting(PrintingUpdate(c.key, p.entry, p.certain, c.collectorLines.distinct().takeLast(6), p.why))
        }
        if (p.certain || c.reads >= MAX_COLLECTOR_READS || SystemClock.elapsedRealtime() - c.since > MAX_REFINE_MS) {
            c.settled = true
        }
    }

    private fun orient(flip: Boolean) {
        if (flip) Core.rotate(warpedRgba, orientedRgba, Core.ROTATE_180) else warpedRgba.copyTo(orientedRgba)
    }

    private fun thumbnail(): Bitmap {
        val small = Mat()
        // Half size: enough to judge a failure (and re-hash it later), small enough to keep around.
        Imgproc.resize(orientedRgba, small, Size(WARP_W / 2.0, WARP_H / 2.0), 0.0, 0.0, Imgproc.INTER_AREA)
        val bmp = Bitmap.createBitmap(small.cols(), small.rows(), Bitmap.Config.ARGB_8888)
        Utils.matToBitmap(small, bmp)
        small.release()
        return bmp
    }

    /** Map frame-pixel corners into 0..1 coordinates of the upright (as displayed) frame. */
    private fun uprightCorners(q: Quad, w: Int, h: Int, rotation: Int): List<Pair<Float, Float>> = q.p.map { pt ->
        val x = pt.x.toFloat(); val y = pt.y.toFloat()
        when (rotation) {
            90 -> (h - y) / h to x / w
            180 -> (w - x) / w to (h - y) / h
            270 -> y / h to (w - x) / w
            else -> x / w to y / h
        }
    }

    companion object {
        /** Warp resolution: about what a 1080p frame holds of a card that fills it, so the collector line stays legible. */
        const val WARP_W = 976
        const val WARP_H = 1362
        /** Max corner movement between frames, as a fraction of the frame diagonal (~65 px at 1080p). */
        private const val MAX_MOTION = 0.03
        private const val REARM_AFTER_LOST_FRAMES = 4
        private const val SAME_CARD_BITS = 48
        // Laplacian variance of the art box. From `indexer eval`: usable frames
        // p5 ≈ 150, a card still sliding (8px smear) p50 ≈ 30.
        private const val MIN_SHARPNESS = 50
        private const val MAX_COLLECTOR_READS = 8
        private const val MAX_REFINE_MS = 4000L
    }
}
