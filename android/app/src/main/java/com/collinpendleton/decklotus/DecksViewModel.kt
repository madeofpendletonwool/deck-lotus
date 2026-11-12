package com.collinpendleton.decklotus

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.collinpendleton.decklotus.data.DeckDetail
import com.collinpendleton.decklotus.data.DeckListItem
import com.collinpendleton.decklotus.data.DeckOwnership
import com.collinpendleton.decklotus.data.DeckReport
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class DecksState(
    val decks: List<DeckListItem> = emptyList(),
    /** By deck id. Arrives after the list, since it takes longer to work out. */
    val ownership: Map<Int, DeckOwnership> = emptyMap(),
    val loaded: Boolean = false,
    val loading: Boolean = false,
    val refreshing: Boolean = false,
    val error: String? = null,
)

/** One open deck: its cards and how they stand against your collection. */
data class OpenDeck(
    val id: Int,
    val name: String,
    val detail: DeckDetail? = null,
    val report: DeckReport? = null,
    val loading: Boolean = true,
    val error: String? = null,
)

class DecksViewModel(app: Application) : AndroidViewModel(app) {
    private val api = (app as DeckLotusApp).api

    private val _state = MutableStateFlow(DecksState())
    val state: StateFlow<DecksState> = _state.asStateFlow()

    private val _open = MutableStateFlow<OpenDeck?>(null)
    val open: StateFlow<OpenDeck?> = _open.asStateFlow()

    private var listJob: Job? = null
    private var deckJob: Job? = null

    fun reload(pullToRefresh: Boolean = false) {
        listJob?.cancel()
        _state.update { it.copy(loading = true, refreshing = pullToRefresh, error = null) }
        listJob = viewModelScope.launch {
            try {
                val decks = api.decks()
                _state.update { it.copy(decks = decks, loaded = true, loading = false, refreshing = false) }
                val ownership = runCatching { api.deckSummaries() }.getOrNull()
                if (ownership != null) _state.update { it.copy(ownership = ownership) }
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, refreshing = false, error = e.message ?: "Couldn't load your decks") }
            }
        }
        // An open deck may have changed too (cards scanned into it, say).
        _open.value?.let { openDeck(it.id, it.name) }
    }

    fun loadIfNeeded() {
        if (!_state.value.loaded && !_state.value.loading) reload()
    }

    fun openDeck(id: Int, name: String) {
        deckJob?.cancel()
        _open.update { if (it?.id == id) it.copy(loading = true, error = null) else OpenDeck(id, name) }
        deckJob = viewModelScope.launch {
            try {
                val (detail, report) = coroutineScope {
                    val d = async { api.deck(id) }
                    val r = async { api.deckReport(id) }
                    d.await() to r.await()
                }
                _open.update { it?.takeIf { o -> o.id == id }?.copy(detail = detail, report = report, loading = false) }
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                _open.update { it?.takeIf { o -> o.id == id }?.copy(loading = false, error = e.message ?: "Couldn't load that deck") }
            }
        }
    }

    fun closeDeck() {
        deckJob?.cancel()
        _open.value = null
    }
}
