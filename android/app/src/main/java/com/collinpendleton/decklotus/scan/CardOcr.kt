package com.collinpendleton.decklotus.scan

import android.graphics.Bitmap
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import org.opencv.android.Utils
import org.opencv.core.Mat
import org.opencv.core.Rect
import org.opencv.core.Size
import org.opencv.imgproc.Imgproc
import java.util.concurrent.TimeUnit

/**
 * Reads small, fixed regions of an upright, straightened card, never the
 * whole frame. Small crops keep ML Kit at tens of ms and stop it wandering
 * into rules text or the table.
 */
class CardOcr {
    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)

    init {
        // ML Kit loads its model on the first call (~1 s). Pay that at launch,
        // not on the first card.
        Thread {
            recognize(Bitmap.createBitmap(128, 32, Bitmap.Config.ARGB_8888))
        }.apply { isDaemon = true }.start()
    }

    /** The name bar's longest line (stray mana-symbol reads are short). */
    fun readName(card: Mat): String = recognize(crop(card, NAME, 1.0)).maxByOrNull { it.length }.orEmpty()

    /**
     * The whole bottom strip. Modern frames (2015+) print the collector line
     * bottom-left; the 2003 frame puts the number bottom-right next to the
     * copyright, so read the full width.
     */
    fun readCollector(card: Mat): List<String> = recognize(crop(card, BOTTOM, 1.6))

    private fun crop(card: Mat, r: FloatArray, upscale: Double): Bitmap {
        val x = (r[0] * card.cols()).toInt(); val y = (r[1] * card.rows()).toInt()
        val w = ((r[2] - r[0]) * card.cols()).toInt(); val h = ((r[3] - r[1]) * card.rows()).toInt()
        val sub = card.submat(Rect(x, y, w, h))
        val scaled = Mat()
        // Collector text is ~1% of card height; ML Kit reads bigger glyphs better.
        if (upscale != 1.0) Imgproc.resize(sub, scaled, Size(), upscale, upscale, Imgproc.INTER_CUBIC) else sub.copyTo(scaled)
        val bmp = Bitmap.createBitmap(scaled.cols(), scaled.rows(), Bitmap.Config.ARGB_8888)
        Utils.matToBitmap(scaled, bmp)
        scaled.release(); sub.release()
        return bmp
    }

    private fun recognize(bmp: Bitmap): List<String> = try {
        val text = Tasks.await(recognizer.process(InputImage.fromBitmap(bmp, 0)), 2, TimeUnit.SECONDS)
        text.textBlocks.flatMap { b -> b.lines.map { it.text.trim() } }.filter { it.isNotEmpty() }
    } catch (_: Exception) {
        emptyList()
    }

    fun close() = recognizer.close()

    companion object {
        // x0, y0, x1, y1 as fractions of the card. Mana cost sits right of NAME.
        private val NAME = floatArrayOf(0.06f, 0.035f, 0.80f, 0.10f)
        private val BOTTOM = floatArrayOf(0.03f, 0.905f, 0.97f, 0.988f)
    }
}
