package com.collinpendleton.decklotus.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.InputChip
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import coil3.compose.AsyncImage
import com.collinpendleton.decklotus.AvailabilityFilter
import com.collinpendleton.decklotus.CollectionFilters
import com.collinpendleton.decklotus.CollectionSort
import com.collinpendleton.decklotus.CollectionViewModel
import com.collinpendleton.decklotus.FinishFilter
import com.collinpendleton.decklotus.data.InventoryCard
import com.collinpendleton.decklotus.data.OwnedPrinting
import com.collinpendleton.decklotus.data.OwnedSet
import java.text.NumberFormat
import java.util.Locale

private val money: NumberFormat = NumberFormat.getCurrencyInstance(Locale.US)
private val wholeMoney: NumberFormat = NumberFormat.getCurrencyInstance(Locale.US).apply { maximumFractionDigits = 0 }

/** Cents for small amounts, whole dollars once they stop mattering. */
private fun shortMoney(v: Double) = if (v >= 100) wholeMoney.format(v) else money.format(v)

private const val CARD_ASPECT = 0.716f

private val TYPES = listOf("Creature", "Instant", "Sorcery", "Artifact", "Enchantment", "Planeswalker", "Land", "Battle", "Legendary")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CollectionScreen(
    vm: CollectionViewModel = viewModel(),
    // Hoisted by the caller so the scroll position survives switching tabs.
    gridState: LazyGridState = rememberLazyGridState(),
    listState: LazyListState = rememberLazyListState(),
) {
    val s by vm.state.collectAsStateWithLifecycle()
    val usage by vm.usage.collectAsStateWithLifecycle()
    val sets by vm.sets.collectAsStateWithLifecycle()
    var openCardId by remember { mutableStateOf<Int?>(null) }
    var filtersOpen by remember { mutableStateOf(false) }

    // Load the next page when the grid or list nears its end.
    val nearEnd by remember(s.grid) {
        derivedStateOf {
            if (s.grid) (gridState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) > gridState.layoutInfo.totalItemsCount - 18
            else (listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) > listState.layoutInfo.totalItemsCount - 10
        }
    }
    LaunchedEffect(nearEnd, s.cards.size) { if (nearEnd) vm.loadMore() }

    val names = remember(sets) { sets.orEmpty().associate { it.code to it.name } }

    Column(Modifier.fillMaxSize().background(Lotus.bg).statusBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 6.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Collection", color = Lotus.text, fontSize = 24.sp, fontWeight = FontWeight.SemiBold)
                s.stats?.let { st ->
                    Text(
                        "%,d cards · %,d unique · %s".format(st.totalCopies, st.uniqueCards, money.format(st.estimatedValue)),
                        color = Lotus.text2, fontSize = 14.sp,
                    )
                }
            }
            IconButton(onClick = { vm.setGrid(!s.grid) }) {
                Icon(if (s.grid) LotusIcons.List else LotusIcons.Grid, if (s.grid) "Show as list" else "Show as grid", tint = Lotus.text2)
            }
        }

        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = s.query, onValueChange = vm::setQuery, singleLine = true,
                placeholder = { Text("Search your cards") },
                leadingIcon = { Icon(Icons.Default.Search, null) },
                trailingIcon = { if (s.query.isNotEmpty()) IconButton(onClick = { vm.setQuery("") }) { Icon(Icons.Default.Clear, "Clear search") } },
                modifier = Modifier.weight(1f),
            )
            IconButton(onClick = { filtersOpen = true; vm.loadSets() }, modifier = Modifier.padding(start = 4.dp)) {
                BadgedBox(badge = { if (!s.filters.isEmpty) Badge(containerColor = Lotus.gold, contentColor = Color.Black) { Text("${s.filters.activeCount}") } }) {
                    Icon(LotusIcons.Filter, "Filters", tint = if (s.filters.isEmpty) Lotus.text2 else Lotus.gold)
                }
            }
        }

        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(horizontal = 16.dp)) {
            items(CollectionSort.entries) { sort ->
                FilterChip(selected = s.sort == sort, onClick = { vm.setSort(sort) }, label = { Text(sort.label) })
            }
        }

        if (!s.filters.isEmpty) ActiveFilters(s.filters, names, vm::setFilters)

        if (s.narrowed && !s.loading) {
            Text(
                if (s.totalCards == 1) "1 card matches" else "%,d cards match".format(s.totalCards),
                color = Lotus.muted, fontSize = 12.sp, modifier = Modifier.padding(start = 16.dp, top = 6.dp),
            )
        }

        s.error?.let {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(it, color = Lotus.danger, fontSize = 13.sp, modifier = Modifier.weight(1f))
                TextButton(onClick = { vm.reload() }) { Text("Retry") }
            }
        }

        PullToRefreshBox(isRefreshing = s.refreshing, onRefresh = { vm.reload(pullToRefresh = true) }, modifier = Modifier.fillMaxSize().padding(top = 6.dp)) {
            val open = { card: InventoryCard -> openCardId = card.cardId; vm.loadUsage(card.cardId) }
            when {
                s.cards.isEmpty() && s.loading -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }
                s.cards.isEmpty() && s.error == null -> EmptyCollection(s.query, !s.filters.isEmpty, onClearFilters = { vm.setFilters(CollectionFilters()) })
                s.grid -> LazyVerticalGrid(
                    columns = GridCells.Adaptive(minSize = 104.dp),
                    state = gridState,
                    contentPadding = PaddingValues(start = 12.dp, end = 12.dp, bottom = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    items(s.cards.size, key = { s.cards[it].cardId }) { i -> CardTile(s.cards[i], showValue = s.sort == CollectionSort.VALUE) { open(s.cards[i]) } }
                    if (s.loading) item(span = { GridItemSpan(maxLineSpan) }) { LoadingMore() }
                }
                else -> LazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
                    items(s.cards, key = { it.cardId }) { card -> CollectionRow(card) { open(card) } }
                    if (s.loading) item { LoadingMore() }
                }
            }
        }
    }

    if (filtersOpen) {
        ModalBottomSheet(
            onDismissRequest = { filtersOpen = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = Lotus.surface,
        ) {
            FilterSheet(
                filters = s.filters, sets = sets, matching = s.totalCards, loading = s.loading,
                onChange = vm::setFilters, onDone = { filtersOpen = false },
            )
        }
    }

    // Look the card up by id so edits (which replace the list item) show live in the sheet.
    val openCard = openCardId?.let { id -> s.cards.firstOrNull { it.cardId == id } }
    if (openCardId != null) {
        ModalBottomSheet(onDismissRequest = { openCardId = null }, containerColor = Lotus.surface) {
            if (openCard == null) {
                Text("Removed from your collection.", color = Lotus.text2, modifier = Modifier.padding(24.dp))
            } else {
                CardSheet(openCard, usage[openCard.cardId], onQuantity = { p, q -> vm.setQuantity(openCard, p, q) }, onToggleFinish = { vm.toggleFinish(openCard, it) })
            }
        }
    }
}

@Composable
private fun LoadingMore() {
    Box(Modifier.fillMaxWidth().padding(16.dp), Alignment.Center) { CircularProgressIndicator(Modifier.size(24.dp)) }
}

@Composable
private fun EmptyCollection(query: String, filtered: Boolean, onClearFilters: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            when {
                filtered && query.isNotBlank() -> "None of your cards match \"$query\" with these filters."
                filtered -> "None of your cards match these filters."
                query.isNotBlank() -> "None of your cards match \"$query\"."
                else -> "Nothing here yet. Scan some cards and tap \"Add to collection\"."
            },
            color = Lotus.muted, fontSize = 15.sp, textAlign = TextAlign.Center,
        )
        if (filtered) TextButton(onClick = onClearFilters) { Text("Clear filters") }
    }
}

/** The filters that are on, each removable with a tap. */
@Composable
private fun ActiveFilters(f: CollectionFilters, setNames: Map<String, String>, onChange: (CollectionFilters) -> Unit) {
    data class Active(val key: String, val label: String, val without: CollectionFilters)
    val active = buildList {
        MANA.filter { it.code in f.colors }.forEach { add(Active("c-${it.code}", it.label, f.copy(colors = f.colors - it.code))) }
        f.type?.let { add(Active("t", it, f.copy(type = null))) }
        if (f.finish != FinishFilter.ALL) add(Active("f", f.finish.label, f.copy(finish = FinishFilter.ALL)))
        if (f.availability != AvailabilityFilter.ALL) add(Active("a", f.availability.label, f.copy(availability = AvailabilityFilter.ALL)))
        f.sets.sorted().forEach { code -> add(Active("s-$code", setNames[code] ?: code.uppercase(), f.copy(sets = f.sets - code))) }
    }
    LazyRow(
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        contentPadding = PaddingValues(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.padding(top = 4.dp),
    ) {
        items(active, key = { it.key }) { a ->
            InputChip(
                selected = true, onClick = { onChange(a.without) },
                label = { Text(a.label, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 160.dp)) },
                trailingIcon = { Icon(Icons.Default.Close, "Remove", Modifier.size(16.dp)) },
            )
        }
        if (active.size > 1) item { TextButton(onClick = { onChange(CollectionFilters()) }) { Text("Clear all") } }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FilterSheet(
    filters: CollectionFilters,
    sets: List<OwnedSet>?,
    matching: Int,
    loading: Boolean,
    onChange: (CollectionFilters) -> Unit,
    onDone: () -> Unit,
) {
    var setQuery by remember { mutableStateOf("") }
    Column(Modifier.fillMaxWidth()) {
        // Fixed height, so "Clear all" appearing doesn't shift everything under your finger.
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(start = 16.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Filters", color = Lotus.text, fontSize = 19.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            if (!filters.isEmpty) TextButton(onClick = { onChange(CollectionFilters()) }) { Text("Clear all") }
        }
        LazyColumn(Modifier.weight(1f, fill = false).padding(horizontal = 16.dp)) {
            item {
                SectionLabel("Colors", "Cards with every color you pick")
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    MANA.forEach { m ->
                        val on = m.code in filters.colors
                        Box(
                            Modifier.size(42.dp).clip(CircleShape)
                                .border(2.dp, if (on) Lotus.gold else Color.Transparent, CircleShape)
                                .padding(3.dp).clip(CircleShape).background(m.fill)
                                .alpha(if (on || filters.colors.isEmpty()) 1f else 0.45f)
                                .clickable { onChange(filters.copy(colors = if (on) filters.colors - m.code else filters.colors + m.code)) },
                            Alignment.Center,
                        ) { Text(m.code, color = m.ink, fontSize = 15.sp, fontWeight = FontWeight.Bold) }
                    }
                }
            }
            item {
                SectionLabel("Type")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TYPES.forEach { t ->
                        FilterChip(selected = filters.type == t, onClick = { onChange(filters.copy(type = if (filters.type == t) null else t)) }, label = { Text(t) })
                    }
                }
            }
            item {
                SectionLabel("Finish")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FinishFilter.entries.forEach { f ->
                        FilterChip(selected = filters.finish == f, onClick = { onChange(filters.copy(finish = f)) }, label = { Text(f.label) })
                    }
                }
            }
            item {
                SectionLabel("Decks")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    AvailabilityFilter.entries.forEach { a ->
                        FilterChip(selected = filters.availability == a, onClick = { onChange(filters.copy(availability = a)) }, label = { Text(a.label) })
                    }
                }
            }
            item {
                SectionLabel("Sets", if (filters.sets.isEmpty()) "Cards you own a copy of from these sets" else "${filters.sets.size} picked")
                if ((sets?.size ?: 0) > 8) {
                    OutlinedTextField(
                        value = setQuery, onValueChange = { setQuery = it }, singleLine = true,
                        placeholder = { Text("Find a set") }, leadingIcon = { Icon(Icons.Default.Search, null) },
                        modifier = Modifier.fillMaxWidth().padding(bottom = 4.dp),
                    )
                }
                if (sets == null) Box(Modifier.fillMaxWidth().padding(12.dp), Alignment.Center) { CircularProgressIndicator(Modifier.size(22.dp)) }
            }
            val q = setQuery.trim()
            // Picked sets stay at the top so they're easy to undo.
            val shown = sets.orEmpty()
                .filter { q.isEmpty() || it.name.contains(q, ignoreCase = true) || it.code.equals(q, ignoreCase = true) }
                .sortedBy { it.code !in filters.sets }
            items(shown, key = { "set-${it.code}" }) { set ->
                val on = set.code in filters.sets
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(6.dp))
                        .clickable { onChange(filters.copy(sets = if (on) filters.sets - set.code else filters.sets + set.code)) }
                        .padding(vertical = 2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Checkbox(checked = on, onCheckedChange = null, colors = CheckboxDefaults.colors(checkedColor = Lotus.gold, checkmarkColor = Color.Black), modifier = Modifier.padding(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(set.name, color = Lotus.text, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(listOfNotNull(set.code.uppercase(), set.releaseDate?.take(4)).joinToString(" · "), color = Lotus.muted, fontSize = 12.sp)
                    }
                    Text("${set.ownedCount}", color = Lotus.text2, fontSize = 13.sp, modifier = Modifier.padding(end = 4.dp))
                }
            }
            if (sets != null && shown.isEmpty()) item {
                Text(if (sets.isEmpty()) "No sets yet." else "No set matches \"$q\".", color = Lotus.muted, fontSize = 13.sp, modifier = Modifier.padding(vertical = 8.dp))
            }
            item { Spacer(Modifier.size(8.dp)) }
        }
        Button(onClick = onDone, modifier = Modifier.fillMaxWidth().padding(16.dp)) {
            Text(
                when {
                    loading -> "Show cards"
                    matching == 1 -> "Show 1 card"
                    else -> "Show %,d cards".format(matching)
                },
            )
        }
    }
}

@Composable
private fun SectionLabel(title: String, hint: String? = null) {
    Row(Modifier.padding(top = 18.dp, bottom = 8.dp), verticalAlignment = Alignment.Bottom) {
        Text(title, color = Lotus.text2, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        hint?.let { Text(it, color = Lotus.muted, fontSize = 12.sp, modifier = Modifier.padding(start = 8.dp)) }
    }
}

/** A card image with its name drawn underneath, so a missing or slow image still says what it is. */
@Composable
private fun CardImage(url: String?, name: String, modifier: Modifier, nameSize: Int = 11) {
    Box(modifier.clip(RoundedCornerShape(6.dp)).background(Lotus.surface2), Alignment.Center) {
        Text(name, color = Lotus.muted, fontSize = nameSize.sp, textAlign = TextAlign.Center, maxLines = 4, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(6.dp))
        AsyncImage(model = url, contentDescription = name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
    }
}

@Composable
private fun CardTile(card: InventoryCard, showValue: Boolean, onClick: () -> Unit) {
    Column(Modifier.clip(RoundedCornerShape(6.dp)).clickable(onClick = onClick)) {
        Box(Modifier.fillMaxWidth().aspectRatio(CARD_ASPECT)) {
            CardImage(card.imageUrl, card.name, Modifier.fillMaxSize())
            Text(
                "×${card.totalOwned}", color = Lotus.text, fontSize = 12.sp, fontWeight = FontWeight.Bold,
                modifier = Modifier.align(Alignment.TopEnd).padding(4.dp).clip(RoundedCornerShape(6.dp))
                    .background(Color(0xD90C0D11)).padding(horizontal = 6.dp, vertical = 2.dp),
            )
            card.printings.map { it.finish }.firstOrNull { it != "nonfoil" }?.let { finish ->
                FinishTag(finish, Modifier.align(Alignment.TopStart).padding(4.dp))
            }
        }
        Text(card.name, color = Lotus.text, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 4.dp, start = 2.dp, end = 2.dp))
        Text(
            if (card.totalValue > 0) shortMoney(card.totalValue) else "—",
            color = if (showValue && card.totalValue > 0) Lotus.gold else Lotus.muted, fontSize = 11.sp,
            modifier = Modifier.padding(horizontal = 2.dp),
        )
    }
}

@Composable
private fun CollectionRow(card: InventoryCard, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        CardImage(card.imageUrl, "", Modifier.width(40.dp).aspectRatio(CARD_ASPECT))
        Column(Modifier.weight(1f).padding(start = 12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(card.name, color = Lotus.text, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                card.printings.map { it.finish }.firstOrNull { it != "nonfoil" }?.let { FinishTag(it, Modifier.padding(start = 6.dp)) }
            }
            val sets = card.printings.map { it.setCode.uppercase() }.distinct()
            Text(
                sets.take(4).joinToString(" · ") + if (sets.size > 4) " +${sets.size - 4}" else "",
                color = Lotus.muted, fontSize = 12.sp, maxLines = 1,
            )
        }
        Column(horizontalAlignment = Alignment.End, modifier = Modifier.padding(start = 10.dp)) {
            Text("×${card.totalOwned}", color = Lotus.text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
            Text(
                listOfNotNull(card.totalValue.takeIf { it > 0 }?.let(::shortMoney), card.totalInDecks.takeIf { it > 0 }?.let { "$it in decks" }).joinToString(" · "),
                color = Lotus.muted, fontSize = 11.sp,
            )
        }
    }
}

@Composable
fun FinishTag(finish: String, modifier: Modifier = Modifier.padding(start = 6.dp)) {
    if (finish == "nonfoil") return
    Text(
        if (finish == "etched") "ETCHED" else "FOIL", fontSize = 10.sp, fontWeight = FontWeight.Bold, color = Color.Black,
        modifier = modifier.clip(RoundedCornerShape(5.dp)).background(Lotus.foil).padding(horizontal = 6.dp, vertical = 2.dp),
    )
}

/** "$4.20", or "≈ $4.20" when there's no price for this finish and it's the closest one. */
private fun priceLabel(p: OwnedPrinting): String? = p.price?.let { (if (p.priceEstimated) "≈ " else "") + money.format(it) }

@Composable
private fun CardSheet(
    card: InventoryCard,
    decks: List<com.collinpendleton.decklotus.data.DeckUsage>?,
    onQuantity: (OwnedPrinting, Int) -> Unit,
    onToggleFinish: (OwnedPrinting) -> Unit,
) {
    LazyColumn(Modifier.fillMaxWidth().heightIn(max = 640.dp).padding(horizontal = 16.dp)) {
        item {
            Row {
                CardImage(card.imageUrl, card.name, Modifier.width(120.dp).aspectRatio(CARD_ASPECT), nameSize = 13)
                Column(Modifier.padding(start = 14.dp)) {
                    Text(card.name, color = Lotus.text, fontSize = 19.sp, fontWeight = FontWeight.SemiBold)
                    card.typeLine?.let { Text(it, color = Lotus.text2, fontSize = 13.sp) }
                    Spacer(Modifier.size(8.dp))
                    Text("${card.totalOwned} owned · ${card.available} free", color = Lotus.text, fontSize = 14.sp)
                    if (card.totalValue > 0) {
                        val estimated = card.printings.any { it.priceEstimated }
                        Text("About ${money.format(card.totalValue)}", color = Lotus.muted, fontSize = 13.sp)
                        if (estimated) Text("≈ marks copies with no price for their finish yet", color = Lotus.muted, fontSize = 11.sp)
                    }
                }
            }
            Text("Your copies", color = Lotus.text2, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 18.dp, bottom = 4.dp))
        }
        items(card.printings, key = { "${it.printingId}-${it.finish}" }) { p ->
            Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                CardImage(p.imageUrl, "", Modifier.width(36.dp).aspectRatio(CARD_ASPECT))
                Column(Modifier.weight(1f).padding(start = 10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("${p.setCode.uppercase()} #${p.collectorNumber ?: "?"}", color = Lotus.text, fontSize = 14.sp)
                        FinishTag(p.finish)
                    }
                    Text(
                        listOfNotNull(p.setName, priceLabel(p)).joinToString(" · "),
                        color = Lotus.muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        if (p.finish == "nonfoil") "Mark foil" else "Mark nonfoil",
                        color = Lotus.gold, fontSize = 12.sp,
                        modifier = Modifier.clip(RoundedCornerShape(4.dp)).clickable { onToggleFinish(p) }.padding(vertical = 4.dp),
                    )
                }
                Stepper(p.quantity, onChange = { onQuantity(p, it) })
            }
            HorizontalDivider(color = Lotus.border)
        }
        if (!decks.isNullOrEmpty()) {
            item {
                Text("In your decks", color = Lotus.text2, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp, bottom = 4.dp))
            }
            items(decks, key = { "deck-${it.id}" }) { d ->
                Row(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                    Text(d.name, color = Lotus.text, fontSize = 14.sp, modifier = Modifier.weight(1f))
                    Text("×${d.quantity}", color = Lotus.text2, fontSize = 14.sp)
                }
            }
        }
        item { Spacer(Modifier.size(24.dp)) }
    }
}

@Composable
private fun Stepper(value: Int, onChange: (Int) -> Unit) {
    Row(
        Modifier.clip(RoundedCornerShape(8.dp)).border(1.dp, Lotus.border, RoundedCornerShape(8.dp)),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            if (value <= 1) "✕" else "−", color = if (value <= 1) Lotus.danger else Lotus.text, fontSize = 18.sp,
            modifier = Modifier.clickable { onChange(value - 1) }.padding(horizontal = 14.dp, vertical = 6.dp),
        )
        Text("$value", color = Lotus.text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 4.dp))
        Text("+", color = Lotus.text, fontSize = 18.sp, modifier = Modifier.clickable { onChange(value + 1) }.padding(horizontal = 14.dp, vertical = 6.dp))
    }
}
