package com.collinpendleton.decklotus.indexer

import com.collinpendleton.decklotus.core.Border
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.util.UUID
import java.util.zip.GZIPInputStream

/** One face of one paper printing that we want a fingerprint for. */
data class FaceSource(
    val id: UUID,
    val face: Int,
    val cardName: String,
    val faceName: String,
    val setCode: String,
    val collectorNumber: String,
    val finishes: Int,
    val border: Border,
    val smallUrl: String,
    val normalUrl: String,
)

class Scryfall(private val cacheDir: File) {
    private val http = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(20))
        .followRedirects(HttpClient.Redirect.NORMAL)
        .build()
    private val json = Json { ignoreUnknownKeys = true }

    private fun request(url: String) = HttpRequest.newBuilder(URI(url))
        .header("User-Agent", "DeckLotusIndexer/0.1")
        .header("Accept", "application/json;q=0.9,*/*;q=0.8")
        .timeout(Duration.ofMinutes(10))
        .build()

    /** The Default Cards bulk file (one card per line), cached for a day. */
    fun defaultCards(refresh: Boolean): File {
        val out = File(cacheDir, "default-cards.jsonl.gz")
        val fresh = out.exists() && System.currentTimeMillis() - out.lastModified() < 24 * 3600_000L
        if (fresh && !refresh) return out
        val meta = http.send(request("https://api.scryfall.com/bulk-data/default-cards"), HttpResponse.BodyHandlers.ofString())
        check(meta.statusCode() == 200) { "bulk-data lookup failed: ${meta.statusCode()}" }
        val uri = json.parseToJsonElement(meta.body()).jsonObject["jsonl_download_uri"]!!.jsonPrimitive.content
        log("Downloading $uri")
        out.parentFile.mkdirs()
        val tmp = File(out.path + ".part")
        val res = http.send(request(uri), HttpResponse.BodyHandlers.ofFile(tmp.toPath()))
        check(res.statusCode() == 200) { "bulk download failed: ${res.statusCode()}" }
        tmp.renameTo(out)
        return out
    }

    fun faces(bulk: File, sets: Set<String>?): List<FaceSource> {
        val out = ArrayList<FaceSource>(130_000)
        GZIPInputStream(bulk.inputStream(), 1 shl 16).bufferedReader().useLines { lines ->
            for (line in lines) {
                if (line.isBlank()) continue
                val c = json.parseToJsonElement(line).jsonObject
                if (!wanted(c, sets)) continue
                out += facesOf(c)
            }
        }
        return out
    }

    private fun wanted(c: JsonObject, sets: Set<String>?): Boolean {
        val set = c.str("set") ?: return false
        if (sets != null && set !in sets) return false
        if (c.bool("digital") || c.bool("oversized")) return false
        val games = (c["games"] as? JsonArray)?.map { it.jsonPrimitive.content } ?: emptyList()
        if ("paper" !in games) return false
        if (c.str("layout") == "art_series") return false
        val status = c.str("image_status")
        return status != "missing" && status != "placeholder"
    }

    private fun facesOf(c: JsonObject): List<FaceSource> {
        val id = UUID.fromString(c.str("id"))
        val name = c.str("name")!!
        val set = c.str("set")!!.uppercase()
        val number = c.str("collector_number")!!
        val finishes = (c["finishes"] as? JsonArray)?.fold(0) { acc, f ->
            acc or when (f.jsonPrimitive.content) {
                "nonfoil" -> 1
                "foil" -> 2
                "etched" -> 4
                else -> 0
            }
        } ?: 1
        val border = Border.fromScryfall(c.str("border_color"))
        val faces = (c["card_faces"] as? JsonArray)?.map { it.jsonObject }
        val topImages = c["image_uris"] as? JsonObject
        if (topImages != null) {
            // Single image: normal cards, plus split / adventure / flip, whose
            // name bar shows the first face's name.
            val faceName = faces?.firstOrNull()?.str("name") ?: name
            return listOf(FaceSource(id, 0, name, faceName, set, number, finishes, border, topImages.str("small")!!, topImages.str("normal")!!))
        }
        return faces.orEmpty().mapIndexedNotNull { i, f ->
            val img = f["image_uris"] as? JsonObject ?: return@mapIndexedNotNull null
            FaceSource(id, i, name, f.str("name") ?: name, set, number, finishes, border, img.str("small")!!, img.str("normal")!!)
        }
    }

    /** Bytes of an image, from cache or the CDN (which isn't rate limited, but we stay modest). */
    fun image(url: String, cacheKey: String): ByteArray {
        val f = File(cacheDir, cacheKey)
        if (f.exists() && f.length() > 0) return f.readBytes()
        var last: Exception? = null
        repeat(4) { attempt ->
            try {
                val res = http.send(request(url), HttpResponse.BodyHandlers.ofByteArray())
                if (res.statusCode() == 200) {
                    f.parentFile.mkdirs()
                    f.writeBytes(res.body())
                    return res.body()
                }
                last = IllegalStateException("HTTP ${res.statusCode()} for $url")
                if (res.statusCode() == 404) throw last!!
            } catch (e: Exception) {
                last = e
            }
            Thread.sleep(500L shl attempt)
        }
        throw last!!
    }

    private fun JsonObject.str(k: String) = (this[k] as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { it.isString }?.content
    private fun JsonObject.bool(k: String) = (this[k] as? kotlinx.serialization.json.JsonPrimitive)?.let { runCatching { it.boolean }.getOrNull() } ?: false
}

fun log(msg: String) = System.err.println(msg)
