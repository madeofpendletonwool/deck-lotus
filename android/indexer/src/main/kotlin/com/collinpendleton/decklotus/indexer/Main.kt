package com.collinpendleton.decklotus.indexer

import com.collinpendleton.decklotus.core.Border
import com.collinpendleton.decklotus.core.CardHasher
import com.collinpendleton.decklotus.core.CardIndex
import com.collinpendleton.decklotus.core.GrayImage
import com.collinpendleton.decklotus.core.Identifier
import com.collinpendleton.decklotus.core.IndexEntry
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import java.io.ByteArrayInputStream
import java.io.File
import java.util.concurrent.atomic.AtomicInteger
import javax.imageio.ImageIO
import kotlin.random.Random

private const val USAGE = """
Usage:
  indexer build [--out FILE] [--sets neo,one] [--cache DIR] [--jobs N] [--refresh] [--reuse FILE]
      Fingerprint every paper printing on Scryfall (or just --sets) into FILE
      (default app/src/main/assets/card-index.bin). With --reuse, printings
      already in that index keep their fingerprint and only new ones are
      downloaded; an index from another hash version is ignored.

  indexer eval --index FILE [--sets neo,one] [--samples N] [--seed S] [--cache DIR]
      Take Scryfall's larger images of cards in --sets, degrade them the way a
      phone camera would (crop error, blur, glare, noise, lighting), and report
      how often the picture match alone finds the right card and printing.
"""

fun main(args: Array<String>) {
    if (args.isEmpty()) return println(USAGE.trimIndent())
    val opts = parseOpts(args.drop(1))
    val cache = File(opts["cache"] ?: "indexer-cache")
    when (args[0]) {
        "build" -> build(cache, opts)
        "eval" -> eval(cache, opts)
        "bench" -> bench(File(opts["index"] ?: "app/src/main/assets/card-index.bin"))
        else -> println(USAGE.trimIndent())
    }
}

/** How long the phone's startup work takes (on this machine; a phone is several times slower). */
private fun bench(file: File) {
    repeat(5) {
        val t0 = System.nanoTime()
        val idx = file.inputStream().use { CardIndex.read(it) }
        val t1 = System.nanoTime()
        idx.printingsOfCard("")
        val t2 = System.nanoTime()
        idx.nameMatcher
        val t3 = System.nanoTime()
        println("read %4d ms   card lookup %4d ms   OCR name table %4d ms".format((t1 - t0) / 1_000_000, (t2 - t1) / 1_000_000, (t3 - t2) / 1_000_000))
    }
}

private fun parseOpts(rest: List<String>): Map<String, String> {
    val m = mutableMapOf<String, String>()
    var i = 0
    while (i < rest.size) {
        val k = rest[i].removePrefix("--")
        if (i + 1 < rest.size && !rest[i + 1].startsWith("--")) { m[k] = rest[i + 1]; i += 2 } else { m[k] = "true"; i++ }
    }
    return m
}

private fun sets(opts: Map<String, String>) = opts["sets"]?.split(',')?.map { it.trim().lowercase() }?.filter { it.isNotEmpty() }?.toSet()

fun decode(bytes: ByteArray): GrayImage {
    val img = ImageIO.read(ByteArrayInputStream(bytes)) ?: error("undecodable image")
    val rgb = img.getRGB(0, 0, img.width, img.height, null, 0, img.width)
    return GrayImage.fromRgb(img.width, img.height, rgb)
}

private fun build(cache: File, opts: Map<String, String>) {
    val sc = Scryfall(cache)
    val faces = sc.faces(sc.defaultCards(opts["refresh"] == "true"), sets(opts))
    val reused = reusableHashes(opts["reuse"])
    log("${faces.size} faces to fingerprint" + if (reused.isEmpty()) "" else ", ${faces.count { (it.id to it.face) in reused }} already in the reused index")
    val jobs = opts["jobs"]?.toInt() ?: 8
    val done = AtomicInteger()
    val failed = AtomicInteger()
    val started = System.currentTimeMillis()
    val builder = CardIndex.Builder()
    runBlocking(Dispatchers.IO) {
        val gate = Semaphore(jobs)
        faces.map { f ->
            async {
                gate.withPermit {
                    try {
                        // Names, finishes and the rest come fresh from Scryfall either way
                        val hash = reused[f.id to f.face] ?: CardHasher.hash(decode(sc.image(f.smallUrl, "small/${f.id}-${f.face}.jpg")))
                        synchronized(builder) {
                            builder.add(IndexEntry(f.id, f.face, f.cardName, f.faceName, f.setCode, f.collectorNumber, f.finishes, f.border, hash))
                        }
                    } catch (e: Exception) {
                        failed.incrementAndGet()
                        log("skip ${f.cardName} (${f.setCode} ${f.collectorNumber}) face ${f.face}: ${e.message}")
                    }
                    val n = done.incrementAndGet()
                    if (n % 2000 == 0) {
                        val rate = n * 1000.0 / (System.currentTimeMillis() - started)
                        log("  $n / ${faces.size}  (%.0f/s)".format(rate))
                    }
                }
            }
        }.awaitAll()
    }
    val index = builder.build()
    val out = File(opts["out"] ?: "app/src/main/assets/card-index.bin")
    out.parentFile?.mkdirs()
    out.outputStream().use { index.write(it) }
    log("Wrote ${index.size} entries (${failed.get()} failed) to $out, ${out.length() / 1024} KiB")
}

/**
 * Fingerprints from an earlier index, by (Scryfall id, face). Empty when there's no file, or it
 * was built with another hash version, in which case everything is fingerprinted again.
 */
private fun reusableHashes(path: String?): Map<Pair<java.util.UUID, Int>, LongArray> {
    val file = path?.let(::File)?.takeIf { it.exists() } ?: return emptyMap()
    val index = try {
        file.inputStream().use { CardIndex.read(it) }
    } catch (e: IllegalArgumentException) {
        log("Not reusing $file: ${e.message}")
        return emptyMap()
    }
    return (0 until index.size).associate { i -> index.entry(i).let { (it.scryfallId to it.face) to it.hash } }
}

private fun eval(cache: File, opts: Map<String, String>) {
    val indexFile = File(opts["index"] ?: "app/src/main/assets/card-index.bin")
    val index = indexFile.inputStream().use { CardIndex.read(it) }
    val identifier = Identifier(index)
    val sc = Scryfall(cache)
    val rnd = Random(opts["seed"]?.toInt() ?: 1)
    val pool = sc.faces(sc.defaultCards(false), sets(opts)).filter { it.face == 0 }
    val samples = pool.shuffled(rnd).take(opts["samples"]?.toInt() ?: 300)
    log("Evaluating ${samples.size} cards against ${index.size} index entries")

    var nameOk = 0; var printingOk = 0; var rejected = 0; var wrong = 0
    var exactAcceptedAndCertain = 0; var exactCertainWrong = 0
    val correctD = mutableListOf<Int>(); val runnerD = mutableListOf<Int>()
    val sharp = mutableListOf<Double>(); val blurred = mutableListOf<Double>()
    var borderTotal = 0; var borderRight = 0; var borderUnsure = 0; var borderWrong = 0; var borderFalse = 0
    val ids = (0 until index.size).associateBy { index.entry(it).let { e -> e.scryfallId to e.face } }
    for (s in samples) {
        val clean = try { decode(sc.image(s.normalUrl, "normal/${s.id}-${s.face}.jpg")) } catch (e: Exception) { continue }
        // Cards land either way up; the phone hashes both and keeps the closer one.
        val photo = Degrade.camera(clean, rnd).let { if (rnd.nextBoolean()) it.rotated180() else it }
        sharp += CardHasher.sharpness(photo)
        val seen = Border.measure(photo)
        if (s.border.tone != Border.UNKNOWN) {
            borderTotal++
            when (seen) {
                s.border.tone -> borderRight++
                Border.UNKNOWN -> borderUnsure++
                else -> borderWrong++
            }
        } else if (seen != Border.UNKNOWN) borderFalse++
        blurred += CardHasher.sharpness(GrayImage(photo.width, photo.height, Degrade.boxBlur(photo.data, photo.width, photo.height, 8)))
        val (hash, nearest) = listOf(photo, photo.rotated180())
            .map { CardHasher.hash(it) }
            .map { it to index.nearest(it, 40) }
            .minBy { it.second.firstOrNull()?.distance ?: Int.MAX_VALUE }
        val truth = ids[s.id to s.face]
        val r = identifier.identify(hash, null, emptyList(), nearest, seen)
        if (truth != null) correctD += index.distance(truth, hash)
        nearest.firstOrNull { index.cardName(it.entry) != s.cardName }?.let { runnerD += it.distance }
        when {
            r == null -> rejected++
            index.cardName(r.entry) != s.cardName -> {
                wrong++
                log("  WRONG ${s.cardName} (${s.setCode}) -> ${index.cardName(r.entry)} (${index.setCode(r.entry)}) ${r.reason}")
            }
            else -> {
                nameOk++
                if (r.entry == truth) printingOk++
                if (r.printingCertain) { if (r.entry == truth) exactAcceptedAndCertain++ else exactCertainWrong++ }
            }
        }
    }
    val n = (nameOk + wrong + rejected).coerceAtLeast(1)
    fun pct(x: Int) = "%.1f%%".format(100.0 * x / n)
    fun dist(xs: List<Int>): String {
        if (xs.isEmpty()) return "-"
        val s = xs.sorted()
        return "p5=${s[s.size * 5 / 100]} p50=${s[s.size / 2]} p95=${s[s.size * 95 / 100]} max=${s.last()}"
    }
    println("cards evaluated:     $n")
    println("right card:          $nameOk (${pct(nameOk)})")
    println("  right printing:    $printingOk (${pct(printingOk)})")
    println("  claimed certain:   ${exactAcceptedAndCertain + exactCertainWrong}, of which wrong printing: $exactCertainWrong")
    println("wrong card:          $wrong (${pct(wrong)})")
    println("rejected (unknown):  $rejected (${pct(rejected)})")
    println("distance to truth:   ${dist(correctD)}   (of ${CardHasher.BITS} bits)")
    println("nearest other card:  ${dist(runnerD)}")
    println("border (black/white cards): $borderTotal, read right $borderRight, unsure $borderUnsure, WRONG $borderWrong")
    println("border on borderless/gold:  claimed a tone $borderFalse times (harmless unless the group mixes)")
    println("sharpness, usable:   ${dist(sharp.map { it.toInt() })}")
    println("sharpness, smeared:  ${dist(blurred.map { it.toInt() })}   (8px box blur, like a card still sliding)")
}

/** Roughly what a phone does to a card between the table and the warp. */
object Degrade {
    fun camera(src: GrayImage, rnd: Random): GrayImage {
        // Corner-detection error: each edge off by up to ±2.5%.
        fun j() = rnd.nextDouble(-0.025, 0.025)
        val outH = rnd.nextInt(600, 1000)
        val outW = (outH * 0.716).toInt()
        var px = src.areaResample(j(), j(), 1 + j(), 1 + j(), outW, outH)
        // Motion / focus blur.
        val r = rnd.nextInt(0, 4)
        if (r > 0) px = boxBlur(px, outW, outH, r)
        val contrast = rnd.nextDouble(0.55, 1.2)
        val bright = rnd.nextDouble(-35.0, 35.0)
        val gx = rnd.nextDouble(-30.0, 30.0); val gy = rnd.nextDouble(-30.0, 30.0)
        // Sleeve glare: a soft bright blob, half the time.
        val glare = rnd.nextDouble() < 0.5
        val cx = rnd.nextDouble(0.2, 0.8) * outW; val cy = rnd.nextDouble(0.15, 0.7) * outH
        val rad = rnd.nextDouble(0.08, 0.22) * outH; val gAmp = rnd.nextDouble(60.0, 160.0)
        for (y in 0 until outH) for (x in 0 until outW) {
            val i = y * outW + x
            var v = px[i] * contrast + bright + gx * (x.toDouble() / outW - 0.5) + gy * (y.toDouble() / outH - 0.5)
            if (glare) {
                val dx = x - cx; val dy = y - cy
                v += gAmp * kotlin.math.exp(-(dx * dx + dy * dy) / (2 * rad * rad))
            }
            v += rnd.nextDouble(-1.0, 1.0) * 8
            px[i] = v.coerceIn(0.0, 255.0).toFloat()
        }
        return GrayImage(outW, outH, px)
    }

    fun boxBlur(px: FloatArray, w: Int, h: Int, r: Int): FloatArray {
        val tmp = FloatArray(px.size); val out = FloatArray(px.size)
        for (y in 0 until h) for (x in 0 until w) {
            var s = 0f; var n = 0
            for (k in -r..r) { val xx = x + k; if (xx in 0 until w) { s += px[y * w + xx]; n++ } }
            tmp[y * w + x] = s / n
        }
        for (y in 0 until h) for (x in 0 until w) {
            var s = 0f; var n = 0
            for (k in -r..r) { val yy = y + k; if (yy in 0 until h) { s += tmp[yy * w + x]; n++ } }
            out[y * w + x] = s / n
        }
        return out
    }
}
