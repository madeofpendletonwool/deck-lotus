package com.collinpendleton.decklotus

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.collinpendleton.decklotus.data.DeckUsage
import com.collinpendleton.decklotus.data.InventoryCard
import com.collinpendleton.decklotus.data.InventoryQuery
import com.collinpendleton.decklotus.data.InventoryStats
import com.collinpendleton.decklotus.data.OwnedPrinting
import com.collinpendleton.decklotus.data.OwnedSet
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class CollectionSort(val api: String, val label: String) {
    NAME("name", "Name"),
    VALUE("value", "Value"),
    QUANTITY("quantity", "Most copies"),
    CMC("cmc", "Mana value"),
    COLOR("color", "Color"),
    TYPE("type", "Type"),
}

enum class FinishFilter(val api: String, val label: String) {
    ALL("all", "Any"), FOIL("foil", "Foil"), NONFOIL("nonfoil", "Nonfoil"),
}

enum class AvailabilityFilter(val api: String, val label: String) {
    ALL("all", "Any"), AVAILABLE("available", "Not in decks"), IN_DECKS("in_decks", "In decks"),
}

/** The filters picked in the filter sheet. The search box and sort live in [CollectionState]. */
data class CollectionFilters(
    val colors: Set<String> = emptySet(),
    val type: String? = null,
    val sets: Set<String> = emptySet(),
    val finish: FinishFilter = FinishFilter.ALL,
    val availability: AvailabilityFilter = AvailabilityFilter.ALL,
) {
    val activeCount get() = colors.size + sets.size + listOf(type != null, finish != FinishFilter.ALL, availability != AvailabilityFilter.ALL).count { it }
    val isEmpty get() = activeCount == 0
}

data class CollectionState(
    val cards: List<InventoryCard> = emptyList(),
    val stats: InventoryStats? = null,
    val query: String = "",
    val sort: CollectionSort = CollectionSort.NAME,
    val filters: CollectionFilters = CollectionFilters(),
    val grid: Boolean = true,
    val page: Int = 0,
    val totalPages: Int = 1,
    val totalCards: Int = 0,
    val loading: Boolean = false,
    val refreshing: Boolean = false,
    val error: String? = null,
) {
    val canLoadMore get() = page < totalPages
    val narrowed get() = query.isNotBlank() || !filters.isEmpty
}

class CollectionViewModel(app: Application) : AndroidViewModel(app) {
    private val api = (app as DeckLotusApp).api
    private val prefs = app.getSharedPreferences("collection", Context.MODE_PRIVATE)

    private val _state = MutableStateFlow(
        CollectionState(
            grid = prefs.getBoolean(KEY_GRID, true),
            sort = CollectionSort.entries.firstOrNull { it.name == prefs.getString(KEY_SORT, null) } ?: CollectionSort.NAME,
        ),
    )
    val state: StateFlow<CollectionState> = _state.asStateFlow()

    private val _usage = MutableStateFlow<Map<Int, List<DeckUsage>>>(emptyMap())
    val usage: StateFlow<Map<Int, List<DeckUsage>>> = _usage.asStateFlow()

    /** Sets you own cards from, for the filter sheet; null until first asked for. */
    private val _sets = MutableStateFlow<List<OwnedSet>?>(null)
    val sets: StateFlow<List<OwnedSet>?> = _sets.asStateFlow()

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
        prefs.edit().putString(KEY_SORT, s.name).apply()
        _state.update { it.copy(sort = s) }
        reload()
    }

    fun setFilters(f: CollectionFilters) {
        if (f == _state.value.filters) return
        _state.update { it.copy(filters = f) }
        reload()
    }

    fun setGrid(grid: Boolean) {
        prefs.edit().putBoolean(KEY_GRID, grid).apply()
        _state.update { it.copy(grid = grid) }
    }

    fun loadSets(force: Boolean = false) {
        if (_sets.value != null && !force) return
        viewModelScope.launch { runCatching { api.ownedSets() }.onSuccess { _sets.value = it } }
    }

    fun reload(pullToRefresh: Boolean = false) {
        loadJob?.cancel()
        _state.update { it.copy(page = 0, totalPages = 1, error = null, refreshing = pullToRefresh) }
        // New cards can bring new sets.
        if (_sets.value != null) loadSets(force = true)
        loadJob = viewModelScope.launch {
            launch { refreshStats() }
            fetch(page = 1, replace = true)
            _state.update { it.copy(refreshing = false) }
        }
    }

    fun loadMore() {
        val s = _state.value
        if (s.loading || !s.canLoadMore || loadJob?.isActive == true) return
        loadJob = viewModelScope.launch { fetch(page = s.page + 1, replace = false) }
    }

    private fun CollectionState.toQuery() = InventoryQuery(
        name = query,
        sort = sort.api,
        colors = filters.colors,
        type = filters.type,
        sets = filters.sets,
        finish = filters.finish.api,
        availability = filters.availability.api,
    )

    private suspend fun fetch(page: Int, replace: Boolean) {
        val s = _state.value
        _state.update { it.copy(loading = true) }
        try {
            val res = api.inventory(s.toQuery(), page)
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

    private suspend fun refreshStats() {
        runCatching { api.stats() }.onSuccess { st -> _state.update { it.copy(stats = st) } }
    }

    fun loadUsage(cardId: Int) {
        viewModelScope.launch {
            runCatching { api.ownershipUsage(cardId) }.onSuccess { u -> _usage.update { it + (cardId to u.deckUsage) } }
        }
    }

    /** Set copies of one printing in one finish; updates the list in place when the server agrees. */
    fun setQuantity(card: InventoryCard, p: OwnedPrinting, quantity: Int) = mutate(card, refetch = false) {
        api.setQuantity(p.printingId, quantity.coerceAtLeast(0), p.finish)
        card.printings.map { if (it.printingId == p.printingId && it.finish == p.finish) it.copy(quantity = quantity) else it }
            .filter { it.quantity > 0 }
    }

    /** Move these copies between foil and nonfoil (merging with any already there). */
    fun toggleFinish(card: InventoryCard, p: OwnedPrinting) = mutate(card, refetch = true) {
        val to = if (p.finish == "nonfoil") "foil" else "nonfoil"
        val existing = card.printings.firstOrNull { it.printingId == p.printingId && it.finish == to }
        val merged = (existing?.quantity ?: 0) + p.quantity
        api.setQuantity(p.printingId, 0, p.finish)
        api.setQuantity(p.printingId, merged, to)
        card.printings.filterNot { it.printingId == p.printingId && (it.finish == to || it.finish == p.finish) } +
            p.copy(finish = to, quantity = merged)
    }

    /**
     * Applies [change] and shows its result right away. With [refetch], the card is then
     * fetched again, because a finish change also changes its price and only the server
     * knows the new one.
     */
    private fun mutate(card: InventoryCard, refetch: Boolean, change: suspend () -> List<OwnedPrinting>) {
        viewModelScope.launch {
            try {
                val printings = change().sortedWith(compareBy({ it.setCode }, { it.collectorNumber }, { it.finish != "nonfoil" }))
                replaceCard(card.cardId, printings.takeIf { it.isNotEmpty() }?.let { ps ->
                    val owned = ps.sumOf { it.quantity }
                    card.copy(printings = ps, totalOwned = owned, available = owned - card.totalInDecks, totalValue = ps.sumOf { (it.price ?: 0.0) * it.quantity })
                })
                _state.update { it.copy(error = null) }
                if (refetch) fetchCard(card)?.let { fresh -> replaceCard(card.cardId, fresh) }
                refreshStats()
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(error = e.message ?: "Couldn't save that change") }
            }
        }
    }

    /** One card as the server sees it now, ignoring the current filters. */
    private suspend fun fetchCard(card: InventoryCard): InventoryCard? =
        runCatching { api.inventory(InventoryQuery(name = card.name), page = 1, limit = 20) }
            .getOrNull()?.cards?.firstOrNull { it.cardId == card.cardId }

    /** Swap a card in the list, or drop it when [with] is null (no copies left). */
    private fun replaceCard(cardId: Int, with: InventoryCard?) {
        _state.update { s ->
            s.copy(cards = if (with == null) s.cards.filterNot { it.cardId == cardId } else s.cards.map { if (it.cardId == cardId) with else it })
        }
    }

    private companion object {
        const val KEY_GRID = "grid"
        const val KEY_SORT = "sort"
    }
}
