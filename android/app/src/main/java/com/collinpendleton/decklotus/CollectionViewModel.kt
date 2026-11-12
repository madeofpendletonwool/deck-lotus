package com.collinpendleton.decklotus

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.collinpendleton.decklotus.data.DeckUsage
import com.collinpendleton.decklotus.data.InventoryCard
import com.collinpendleton.decklotus.data.InventoryStats
import com.collinpendleton.decklotus.data.OwnedPrinting
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class CollectionSort(val api: String, val label: String) {
    NAME("name", "Name"),
    QUANTITY("quantity", "Most copies"),
    CMC("cmc", "Mana value"),
    COLOR("color", "Color"),
    TYPE("type", "Type"),
}

data class CollectionState(
    val cards: List<InventoryCard> = emptyList(),
    val stats: InventoryStats? = null,
    val query: String = "",
    val sort: CollectionSort = CollectionSort.NAME,
    val page: Int = 0,
    val totalPages: Int = 1,
    val totalCards: Int = 0,
    val loading: Boolean = false,
    val refreshing: Boolean = false,
    val error: String? = null,
) {
    val canLoadMore get() = page < totalPages
}

class CollectionViewModel(app: Application) : AndroidViewModel(app) {
    private val api = (app as DeckLotusApp).api

    private val _state = MutableStateFlow(CollectionState())
    val state: StateFlow<CollectionState> = _state.asStateFlow()

    private val _usage = MutableStateFlow<Map<Int, List<DeckUsage>>>(emptyMap())
    val usage: StateFlow<Map<Int, List<DeckUsage>>> = _usage.asStateFlow()

    private var loadJob: Job? = null
    private var searchJob: Job? = null

    init { reload() }

    fun setQuery(q: String) {
        _state.update { it.copy(query = q) }
        searchJob?.cancel()
        // Wait for a pause in typing before hitting the server.
        searchJob = viewModelScope.launch { delay(300); reload() }
    }

    fun setSort(s: CollectionSort) {
        if (s == _state.value.sort) return
        _state.update { it.copy(sort = s) }
        reload()
    }

    fun reload(pullToRefresh: Boolean = false) {
        loadJob?.cancel()
        _state.update { it.copy(page = 0, totalPages = 1, error = null, refreshing = pullToRefresh) }
        loadJob = viewModelScope.launch {
            launch { runCatching { api.stats() }.onSuccess { s -> _state.update { it.copy(stats = s) } } }
            fetch(page = 1, replace = true)
            _state.update { it.copy(refreshing = false) }
        }
    }

    fun loadMore() {
        val s = _state.value
        if (s.loading || !s.canLoadMore || loadJob?.isActive == true) return
        loadJob = viewModelScope.launch { fetch(page = s.page + 1, replace = false) }
    }

    private suspend fun fetch(page: Int, replace: Boolean) {
        val s = _state.value
        _state.update { it.copy(loading = true) }
        try {
            val res = api.inventory(s.query, s.sort.api, page)
            _state.update {
                it.copy(
                    cards = if (replace) res.cards else it.cards + res.cards.filter { c -> it.cards.none { o -> o.cardId == c.cardId } },
                    page = res.pagination.page,
                    totalPages = res.pagination.totalPages,
                    totalCards = res.pagination.totalCards,
                    loading = false,
                )
            }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            _state.update { it.copy(loading = false, error = e.message ?: "Couldn't load your collection") }
        }
    }

    fun loadUsage(cardId: Int) {
        viewModelScope.launch {
            runCatching { api.ownershipUsage(cardId) }.onSuccess { u -> _usage.update { it + (cardId to u.deckUsage) } }
        }
    }

    /** Set copies of one printing in one finish; updates the list in place when the server agrees. */
    fun setQuantity(card: InventoryCard, p: OwnedPrinting, quantity: Int) = mutate(card) {
        api.setQuantity(p.printingId, quantity.coerceAtLeast(0), p.finish)
        card.printings.map { if (it.printingId == p.printingId && it.finish == p.finish) it.copy(quantity = quantity) else it }
            .filter { it.quantity > 0 }
    }

    /** Move these copies between foil and nonfoil (merging with any already there). */
    fun toggleFinish(card: InventoryCard, p: OwnedPrinting) = mutate(card) {
        val to = if (p.finish == "nonfoil") "foil" else "nonfoil"
        val existing = card.printings.firstOrNull { it.printingId == p.printingId && it.finish == to }
        val merged = (existing?.quantity ?: 0) + p.quantity
        api.setQuantity(p.printingId, 0, p.finish)
        api.setQuantity(p.printingId, merged, to)
        card.printings.filterNot { it.printingId == p.printingId && (it.finish == to || it.finish == p.finish) } +
            p.copy(finish = to, quantity = merged)
    }

    private fun mutate(card: InventoryCard, change: suspend () -> List<OwnedPrinting>) {
        viewModelScope.launch {
            try {
                val printings = change().sortedWith(compareBy({ it.setCode }, { it.collectorNumber }, { it.finish != "nonfoil" }))
                val owned = printings.sumOf { it.quantity }
                _state.update { s ->
                    s.copy(
                        cards = if (owned == 0) s.cards.filterNot { it.cardId == card.cardId }
                        else s.cards.map { if (it.cardId == card.cardId) it.copy(printings = printings, totalOwned = owned, available = owned - it.totalInDecks) else it },
                        error = null,
                    )
                }
                runCatching { api.stats() }.onSuccess { st -> _state.update { it.copy(stats = st) } }
            } catch (e: Exception) {
                _state.update { it.copy(error = e.message ?: "Couldn't save that change") }
            }
        }
    }
}
