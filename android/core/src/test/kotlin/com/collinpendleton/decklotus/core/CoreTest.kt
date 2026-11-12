package com.collinpendleton.decklotus.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.UUID
import kotlin.math.sin
import kotlin.random.Random

class CoreTest {
    private fun synthetic(w: Int, h: Int, seed: Int): GrayImage {
        val r = Random(seed)
        val blobs = List(12) { Triple(r.nextDouble(), r.nextDouble(), r.nextDouble(20.0, 200.0)) }
        val px = FloatArray(w * h)
        for (y in 0 until h) for (x in 0 until w) {
            val fx = x.toDouble() / w; val fy = y.toDouble() / h
            var v = 60.0 + 40 * sin(fx * 7 + seed) * sin(fy * 5)
            for ((bx, by, a) in blobs) {
                val d = (fx - bx) * (fx - bx) + (fy - by) * (fy - by)
                v += a * kotlin.math.exp(-d * 60)
            }
            px[y * w + x] = v.coerceIn(0.0, 255.0).toFloat()
        }
        return GrayImage(w, h, px)
    }

    @Test fun hashIgnoresResolutionAndBrightness() {
        val small = synthetic(146, 204, 3)
        val big = synthetic(976, 1360, 3)
        val dim = GrayImage(big.width, big.height, FloatArray(big.data.size) { big.data[it] * 0.6f + 10 })
        val h = CardHasher.hash(small)
        assertTrue(CardHasher.distance(h, 0, CardHasher.hash(big)) <= 12)
        assertTrue(CardHasher.distance(h, 0, CardHasher.hash(dim)) <= 12)
        val other = CardHasher.hash(synthetic(146, 204, 9))
        assertTrue(CardHasher.distance(h, 0, other) > 50)
    }

    @Test fun indexRoundTripsAndFindsNearest() {
        val b = CardIndex.Builder()
        repeat(50) { i ->
            b.add(IndexEntry(UUID.randomUUID(), 0, "Card $i", "Card $i", "TST", "${i + 1}", 3, Border.BLACK, CardHasher.hash(synthetic(146, 204, i))))
        }
        val bytes = ByteArrayOutputStream().also { b.build().write(it) }.toByteArray()
        val index = CardIndex.read(ByteArrayInputStream(bytes))
        assertEquals(50, index.size)
        val probe = CardHasher.hash(synthetic(700, 980, 17))
        val top = index.nearest(probe, 3)
        assertEquals("Card 17", index.cardName(top[0].entry))
    }

    @Test fun collectorLineParsesModernAndOcrNoise() {
        val p = CollectorLine.parse(listOf("0123 R", "NEO • EN  Artist Name"))
        assertTrue("123" in p.numbers)
        assertTrue(CollectorLine.score(p, "NEO", "123") >= 4)
        val q = CollectorLine.parse(listOf("O45/28O U", "M2O EN"))
        assertTrue("45" in q.numbers)
        assertEquals(4, CollectorLine.score(q, "M20", "45"))
        assertEquals(0, CollectorLine.score(q, "DMU", "12"))
    }

    @Test fun collectorLineSeparatesReprintsWithTheSameArt() {
        val art = CardHasher.hash(synthetic(146, 204, 5))
        val b = CardIndex.Builder()
        b.add(IndexEntry(UUID.randomUUID(), 0, "Shock", "Shock", "M19", "156", 3, Border.BLACK, art))
        b.add(IndexEntry(UUID.randomUUID(), 0, "Shock", "Shock", "M20", "160", 3, Border.BLACK, art.copyOf()))
        repeat(20) { i -> b.add(IndexEntry(UUID.randomUUID(), 0, "Other $i", "Other $i", "XXX", "$i", 1, Border.BLACK, CardHasher.hash(synthetic(146, 204, 100 + i)))) }
        val index = b.build()
        val id = Identifier(index)
        val probe = CardHasher.hash(synthetic(900, 1260, 5))

        val noOcr = id.identify(probe, null, emptyList())!!
        assertEquals("Shock", index.cardName(noOcr.entry))
        assertEquals(false, noOcr.printingCertain)

        val withOcr = id.identify(probe, "Shock", listOf("160/280 C", "M2O • EN  Artist"))!!
        assertEquals("M20", index.setCode(withOcr.entry))
        assertEquals(true, withOcr.printingCertain)
    }

    @Test fun borderColourSeparatesSameArtReprints() {
        // Sakura-Tribe Elder: C19 (black border) and MB2 (white) share the art.
        val art = CardHasher.hash(synthetic(146, 204, 8))
        val b = CardIndex.Builder()
        b.add(IndexEntry(UUID.randomUUID(), 0, "Sakura-Tribe Elder", "Sakura-Tribe Elder", "C19", "177", 3, Border.BLACK, art))
        b.add(IndexEntry(UUID.randomUUID(), 0, "Sakura-Tribe Elder", "Sakura-Tribe Elder", "MB2", "72", 1, Border.WHITE, art.copyOf()))
        repeat(10) { i -> b.add(IndexEntry(UUID.randomUUID(), 0, "Other $i", "Other $i", "XXX", "$i", 1, Border.BLACK, CardHasher.hash(synthetic(146, 204, 200 + i)))) }
        val index = b.build()
        val id = Identifier(index)
        val m = id.identifyCard(CardHasher.hash(synthetic(900, 1260, 8)), null)!!
        assertEquals("C19", index.setCode(id.pickPrinting(m, Border.BLACK, CollectorLine.Parsed.EMPTY).entry))
        assertEquals("MB2", index.setCode(id.pickPrinting(m, Border.WHITE, CollectorLine.Parsed.EMPTY).entry))
        assertEquals(false, id.pickPrinting(m, Border.UNKNOWN, CollectorLine.Parsed.EMPTY).certain)
    }

    @Test fun measuresBorderTone() {
        fun framed(ring: Float): GrayImage {
            val base = synthetic(488, 680, 4)
            val px = base.data.copyOf()
            for (y in 0 until 680) for (x in 0 until 488) {
                val edge = minOf(x, y, 487 - x, 679 - y)
                if (edge < 20) px[y * 488 + x] = ring
            }
            return GrayImage(488, 680, px)
        }
        assertEquals(Border.BLACK, Border.measure(framed(12f)))
        assertEquals(Border.WHITE, Border.measure(framed(245f)))
    }

    @Test fun nameMatcherForgivesOcrSlips() {
        val m = NameMatcher(listOf("lightning bolt", "llanowar elves", "counterspell").map { NameMatcher.normalize(it) })
        assertEquals("lightning bolt", m.best("Lightnmg Bo1t")!!.normalizedName)
        assertEquals("llanowar elves", m.best("Llanowar Elves ")!!.normalizedName)
    }
}
