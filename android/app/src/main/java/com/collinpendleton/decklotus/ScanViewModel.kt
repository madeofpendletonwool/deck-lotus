package com.collinpendleton.decklotus

import android.app.Application
import android.content.ContentValues
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.provider.MediaStore
import android.graphics.Bitmap
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.collinpendleton.decklotus.core.CardIndex
import com.collinpendleton.decklotus.core.IndexEntry
import com.collinpendleton.decklotus.data.DeckListItem
import com.collinpendleton.decklotus.data.DeckTarget
import com.collinpendleton.decklotus.data.ScannedCard
import com.collinpendleton.decklotus.data.SessionStore
import com.collinpendleton.decklotus.scan.CardOcr
import com.collinpendleton.decklotus.scan.FrameState
import com.collinpendleton.decklotus.scan.Phase
import com.collinpendleton.decklotus.scan.PrintingUpdate
import com.collinpendleton.decklotus.scan.ScanEvent
import com.collinpendleton.decklotus.scan.ScanPipeline
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.io.File

sealed interface IndexStatus {
    data object Loading : IndexStatus
    data class Ready(val size: Int, val builtAt: Long, val source: String, val loadMillis: Long) : IndexStatus
    data class Missing(val message: String) : IndexStatus
}

/** Getting scans into the collection on the server. */
sealed interface UploadState {
    data object Idle : UploadState
    data object Sending : UploadState
    data class Sent(val message: String) : UploadState
    /** Saved on the phone, will retry. [count] cards are waiting. */
    data class Waiting(val count: Int, val message: String) : UploadState
}

data class DebugInfo(
    val thumb: Bitmap,
    val summary: String,
    val nameText: String,
    val collectorText: List<String>,
)

class ScanViewModel(app: Application) : AndroidViewModel(app) {
    private val store = SessionStore(File(app.filesDir, "session.json"))

    private val _index = MutableStateFlow<IndexStatus>(IndexStatus.Loading)
    val indexStatus: StateFlow<IndexStatus> = _index.asStateFlow()
    private var index: CardIndex? = null

    private val _frame = MutableStateFlow(FrameState(Phase.NO_INDEX))
    val frame: StateFlow<FrameState> = _frame.asStateFlow()

    private val _session = MutableStateFlow(store.load())
    val session: StateFlow<List<ScannedCard>> = _session.asStateFlow()

    private val _foilMode = MutableStateFlow(false)
    val foilMode: StateFlow<Boolean> = _foilMode.asStateFlow()

    private val _debug = MutableStateFlow<DebugInfo?>(null)
    val debug: StateFlow<DebugInfo?> = _debug.asStateFlow()

    private val uploads = (app as DeckLotusApp).uploads
    private val _upload = MutableStateFlow<UploadState>(UploadState.Idle)
    val upload: StateFlow<UploadState> = _upload.asStateFlow()
    private val _pending = MutableStateFlow(uploads.pending().sumOf { it.cards.size })
    /** Cards saved on the phone that the server hasn't confirmed yet. */
    val pendingCount: StateFlow<Int> = _pending.asStateFlow()

    private val ocr = CardOcr()
    private val tones = runCatching { ToneGenerator(AudioManager.STREAM_NOTIFICATION, 70) }.getOrNull()
    private val vibrator: Vibrator? = if (Build.VERSION.SDK_INT >= 31) {
        app.getSystemService(VibratorManager::class.java)?.defaultVibrator
    } else {
        @Suppress("DEPRECATION") app.getSystemService(Vibrator::class.java)
    }

    private var lastFrameEmit = 0L

    val pipeline = ScanPipeline(
        ocr = ocr,
        onState = { s ->
            // The overlay doesn't need more than ~30 updates a second.
            val now = SystemClock.elapsedRealtime()
            if (s.phase != _frame.value.phase || now - lastFrameEmit > 33) {
                lastFrameEmit = now
                _frame.value = s
            }
        },
        onCard = ::onCard,
        onPrinting = ::onPrinting,
        onUnknown = { thumb, name ->
            _debug.value = DebugInfo(thumb, "Couldn't identify", name, emptyList())
            tones?.startTone(ToneGenerator.TONE_PROP_NACK, 120)
        },
    )

    init {
        viewModelScope.launch(Dispatchers.IO) { loadIndex() }
        // Anything left from last time (offline, app killed mid-send) goes now.
        if (uploads.pending().isNotEmpty()) retryUploads()
    }

    /**
     * Moves everything scanned into the collection. The cards leave the scan
     * list straight away; they're safe on disk until the server confirms.
     */
    fun addToCollection() = deliver(target = null)

    /** Moves everything scanned into a deck (and the collection too, if the target says so). */
    fun addToDeck(target: DeckTarget) {
        prefs.edit()
            .putInt(KEY_LAST_DECK, target.deckId)
            .putString(KEY_LAST_BOARD, target.board)
            .putBoolean(KEY_ALSO_COLLECTION, target.collection)
            .apply()
        deliver(target)
    }

    private fun deliver(target: DeckTarget?) {
        val cards = _session.value
        if (cards.isEmpty() || _upload.value == UploadState.Sending) return
        viewModelScope.launch(Dispatchers.IO) {
            uploads.enqueue(cards.reversed(), target) // oldest scan first
            mutate { list -> list.filterNot { c -> cards.any { it.key == c.key } } }
            send()
        }
    }

    private val prefs = app.getSharedPreferences("scan", android.content.Context.MODE_PRIVATE)

    /** What the deck picker starts with: the last deck, board and collection choice used. */
    val lastDeckChoice get() = Triple(
        prefs.getInt(KEY_LAST_DECK, -1).takeIf { it >= 0 },
        prefs.getString(KEY_LAST_BOARD, "mainboard") ?: "mainboard",
        prefs.getBoolean(KEY_ALSO_COLLECTION, false),
    )

    /** Your decks, for the "Add to deck" picker; null while loading, or if it couldn't load. */
    private val _decks = MutableStateFlow<List<DeckListItem>?>(null)
    val decks: StateFlow<List<DeckListItem>?> = _decks.asStateFlow()
    private val _decksError = MutableStateFlow<String?>(null)
    val decksError: StateFlow<String?> = _decksError.asStateFlow()

    fun loadDecks() {
        _decksError.value = null
        viewModelScope.launch {
            try {
                _decks.value = api.decks()
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                _decksError.value = e.message ?: "Couldn't load your decks"
            }
        }
    }

    private val api = (app as DeckLotusApp).api

    fun retryUploads() {
        if (_upload.value == UploadState.Sending) return
        viewModelScope.launch(Dispatchers.IO) { send() }
    }

    fun dismissUploadMessage() {
        if (_upload.value is UploadState.Sent) _upload.value = UploadState.Idle
    }

    private suspend fun send() {
        _upload.value = UploadState.Sending
        _pending.value = uploads.pending().sumOf { it.cards.size }
        val outcome = uploads.flush()
        _pending.value = uploads.pending().sumOf { it.cards.size }
        _upload.value = when (val r = outcome) {
            is com.collinpendleton.decklotus.data.UploadOutcome.Done -> {
                if (r.returned.isNotEmpty()) {
                    // Cards the server doesn't know yet go back on the list rather than vanish.
                    mutate { list -> val base = System.nanoTime()
                        r.returned.mapIndexed { i, c -> c.copy(key = base + i) } + list }
                }
                UploadState.Sent(sentMessage(r))
            }
            is com.collinpendleton.decklotus.data.UploadOutcome.Offline ->
                UploadState.Waiting(uploads.pending().sumOf { it.cards.size }, r.message)
            com.collinpendleton.decklotus.data.UploadOutcome.SignedOut ->
                UploadState.Waiting(uploads.pending().sumOf { it.cards.size }, "Sign in again to finish adding them")
        }
    }

    private fun sentMessage(r: com.collinpendleton.decklotus.data.UploadOutcome.Done) = buildList {
        r.decks.groupBy { it.deckName to it.board }.forEach { (k, ds) ->
            val n = ds.sumOf { it.count }
            val where = if (k.second == "mainboard") k.first else "${k.first} (${k.second})"
            add(if (n == 1) "Added 1 card to $where" else "Added $n cards to $where")
        }
        if (r.added > 0) add(
            when {
                r.decks.isNotEmpty() -> "and your collection"
                r.added == 1 -> "Added 1 card to your collection"
                else -> "Added ${r.added} cards to your collection"
            },
        )
        if (isEmpty()) add("Nothing added")
    }.joinToString(" ").let { base ->
        if (r.returned.isEmpty()) base
        else "$base. ${r.returned.size} couldn't be added, kept here: ${r.reasons.firstOrNull().orEmpty()}"
    }

    /**
     * An index pushed to the app's files dir (adb push, see README) wins over
     * the one bundled in the APK, so it can be rebuilt without reinstalling.
     */
    private fun loadIndex() {
        val t0 = SystemClock.elapsedRealtime()
        val app = getApplication<Application>()
        val pushed = app.getExternalFilesDir(null)?.let { File(it, "card-index.bin") }
        try {
            val (idx, source) = if (pushed != null && pushed.exists()) {
                pushed.inputStream().use { CardIndex.read(it) } to "pushed file"
            } else {
                app.assets.open("card-index.bin").use { CardIndex.read(it) } to "bundled"
            }
            index = idx
            pipeline.index = idx
            _index.value = IndexStatus.Ready(idx.size, idx.builtAt, source, SystemClock.elapsedRealtime() - t0)
            // Only the rare unsure card needs the OCR name table, so scanning
            // starts without it; it fills in a moment later.
            idx.buildNameTables()
        } catch (e: java.io.FileNotFoundException) {
            _index.value = IndexStatus.Missing("No card index. Build one with the indexer and push it (see android/README.md).")
        } catch (e: Exception) {
            _index.value = IndexStatus.Missing(e.message ?: e.toString())
        }
    }

    private fun onCard(e: ScanEvent) {
        val idx = index ?: return
        val entry = idx.entry(e.entry)
        val foil = _foilMode.value && entry.finishes and IndexEntry.FINISH_FOIL != 0
        val card = ScannedCard(
            key = e.key,
            scryfallId = entry.scryfallId.toString(),
            face = entry.face,
            cardName = entry.cardName,
            setCode = entry.setCode,
            collectorNumber = entry.collectorNumber,
            finishes = entry.finishes,
            foil = foil,
            confidence = e.confidence.name,
            printingCertain = e.printingCertain,
            distance = 0,
            hash = e.hash.toList(),
            scannedAt = System.currentTimeMillis(),
        )
        mutate { listOf(card) + it }
        _debug.value = DebugInfo(e.warped, e.debug, e.nameText, emptyList())
        feedback(card.confidence == "LOW")
    }

    /** The collector line settled (or changed) the printing of a card already in the list. */
    private fun onPrinting(u: PrintingUpdate) {
        val idx = index ?: return
        val e = idx.entry(u.entry)
        mutate { list ->
            list.map {
                if (it.key != u.key || it.pickedByHand) it else it.copy(
                    scryfallId = e.scryfallId.toString(), face = e.face, setCode = e.setCode,
                    collectorNumber = e.collectorNumber, finishes = e.finishes,
                    foil = it.foil && e.finishes and IndexEntry.FINISH_FOIL != 0,
                    printingCertain = u.certain,
                )
            }
        }
        _debug.value = _debug.value?.copy(summary = (_debug.value?.summary ?: "") + " → ${u.why}", collectorText = u.collectorText)
    }

    private fun feedback(review: Boolean) {
        tones?.startTone(if (review) ToneGenerator.TONE_PROP_BEEP2 else ToneGenerator.TONE_PROP_BEEP, 80)
        vibrator?.vibrate(VibrationEffect.createOneShot(if (review) 70 else 25, VibrationEffect.DEFAULT_AMPLITUDE))
    }

    fun setFoilMode(on: Boolean) { _foilMode.value = on }

    fun toggleFoil(key: Long) = mutate { list -> list.map { if (it.key == key) it.copy(foil = !it.foil) else it } }

    fun remove(key: Long) = mutate { list -> list.filterNot { it.key == key } }

    fun undo() = mutate { it.drop(1) }

    fun clear() = mutate { emptyList() }

    /** Other printings of the same card, closest picture match first. */
    fun printingsFor(card: ScannedCard): List<IndexEntry> {
        val idx = index ?: return emptyList()
        val h = card.hash.toLongArray()
        return idx.printingsOfCard(card.cardName)
            .sortedBy { idx.distance(it, h) }
            .map { idx.entry(it) }
            .distinctBy { it.scryfallId }
    }

    fun choosePrinting(key: Long, e: IndexEntry) = mutate { list ->
        list.map {
            if (it.key != key) it else it.copy(
                scryfallId = e.scryfallId.toString(), face = e.face, setCode = e.setCode,
                collectorNumber = e.collectorNumber, finishes = e.finishes,
                foil = it.foil && e.finishes and IndexEntry.FINISH_FOIL != 0,
                printingCertain = true,
                pickedByHand = true,
            )
        }
    }

    fun exportText() = SessionStore.exportText(_session.value)

    /** Saves the last straightened frame so failures can be collected for tuning. */
    /**
     * Saves the last straightened card, with what the scanner made of it
     * printed underneath, to Pictures/Deck Lotus so it shows in the gallery
     * and can be shared for tuning. Returns where it went, or null.
     */
    fun saveDebugFrame(): String? {
        val d = _debug.value ?: return null
        val notes = listOf(d.summary, "name: ${d.nameText.ifEmpty { "-" }}", "collector: ${d.collectorText.joinToString(" | ").ifEmpty { "-" }}")
        val img = annotate(d.thumb, notes)
        val name = "deck-lotus-${System.currentTimeMillis()}.png"
        val app = getApplication<Application>()
        return try {
            if (Build.VERSION.SDK_INT >= 29) {
                val values = ContentValues().apply {
                    put(MediaStore.Images.Media.DISPLAY_NAME, name)
                    put(MediaStore.Images.Media.MIME_TYPE, "image/png")
                    put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/Deck Lotus")
                }
                val uri = app.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return null
                app.contentResolver.openOutputStream(uri)?.use { img.compress(Bitmap.CompressFormat.PNG, 100, it) }
                "Pictures/Deck Lotus/$name"
            } else {
                val dir = app.getExternalFilesDir("captures") ?: return null
                dir.mkdirs()
                File(dir, name).outputStream().use { img.compress(Bitmap.CompressFormat.PNG, 100, it) }
                "captures/$name"
            }
        } catch (e: Exception) {
            null
        }
    }

    private fun annotate(card: Bitmap, lines: List<String>): Bitmap {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; textSize = 15f }
        val width = card.width
        // Wrap each note to the image width.
        val wrapped = lines.flatMap { line ->
            val out = mutableListOf<String>()
            var rest = line
            while (rest.isNotEmpty()) {
                val n = paint.breakText(rest, true, width - 16f, null).coerceAtLeast(1)
                out += rest.take(n); rest = rest.drop(n)
            }
            out
        }
        val lineH = 20
        val out = Bitmap.createBitmap(width, card.height + 12 + wrapped.size * lineH, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(out)
        canvas.drawColor(Color.rgb(12, 13, 17))
        canvas.drawBitmap(card, 0f, 0f, null)
        wrapped.forEachIndexed { i, l -> canvas.drawText(l, 8f, card.height + 6f + (i + 1) * lineH - 5, paint) }
        return out
    }

    private fun mutate(f: (List<ScannedCard>) -> List<ScannedCard>) {
        _session.update(f)
        val snapshot = _session.value
        viewModelScope.launch(Dispatchers.IO) { store.save(snapshot) }
    }

    override fun onCleared() {
        ocr.close()
        tones?.release()
    }

    private companion object {
        const val KEY_LAST_DECK = "last_deck"
        const val KEY_LAST_BOARD = "last_board"
        const val KEY_ALSO_COLLECTION = "also_collection"
    }
}
