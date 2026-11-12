package com.collinpendleton.decklotus.core

/**
 * Reads the bottom-left info line that modern cards print, e.g.
 *   "0123 R"          / "123/280 R"
 *   "NEO • EN  Artist Name"
 * OCR on 6pt text confuses O/0, I/l/1, S/5 and B/8, so both sides of a
 * comparison are folded to one "confusable" alphabet first.
 */
object CollectorLine {
    data class Parsed(val numbers: Set<String>, val setCodes: Set<String>) {
        val isEmpty get() = numbers.isEmpty() && setCodes.isEmpty()

        /** Pool reads from several frames: each frame's OCR gets different bits right. */
        operator fun plus(o: Parsed) = Parsed(numbers + o.numbers, setCodes + o.setCodes)

        companion object {
            val EMPTY = Parsed(emptySet(), emptySet())
        }
    }

    private val splitter = Regex("[\\s•·*/|,.]+")
    private val numberish = Regex("^[0-9OoIlSB]{1,4}[a-z]?$")
    private val codeish = Regex("^[A-Z0-9]{3,5}$")
    private val notCodes = setOf("EN", "TM", "WOTC", "ILLUS", "THE", "AND")

    fun parse(lines: List<String>): Parsed {
        val numbers = mutableSetOf<String>()
        val codes = mutableSetOf<String>()
        for (line in lines) {
            // "123/280" -> the part before the slash is the collector number.
            Regex("([0-9OoIlSB]{1,4})\\s*/\\s*[0-9OoIlSB]{1,4}").findAll(line).forEach {
                numbers += normalizeNumber(it.groupValues[1])
            }
            for (raw in line.split(splitter)) {
                val tok = raw.trim()
                if (tok.isEmpty()) continue
                if (numberish.matches(tok) && tok.any { it.isDigit() }) numbers += normalizeNumber(tok)
                val up = tok.uppercase()
                if (codeish.matches(up) && up.any { it.isLetter() } && up !in notCodes) codes += fold(up)
            }
        }
        return Parsed(numbers - "", codes)
    }

    /** How well a printing agrees with what was read. 0 = no evidence. */
    fun score(parsed: Parsed, setCode: String, collectorNumber: String): Int {
        var s = 0
        if (normalizeNumber(collectorNumber) in parsed.numbers) s += 2
        if (fold(setCode.uppercase()) in parsed.setCodes) s += 2
        return s
    }

    fun normalizeNumber(n: String): String {
        val digits = n.map {
            when (it) {
                'O', 'o' -> '0'
                'I', 'l' -> '1'
                'S' -> '5'
                'B' -> '8'
                else -> it
            }
        }.joinToString("")
        return digits.trimStart('0').lowercase()
    }

    /** Fold digits that look like letters so "M2O" and "M20" compare equal. */
    fun fold(code: String): String = code.map {
        when (it) {
            '0' -> 'O'
            '1' -> 'I'
            '5' -> 'S'
            '8' -> 'B'
            else -> it
        }
    }.joinToString("")
}
