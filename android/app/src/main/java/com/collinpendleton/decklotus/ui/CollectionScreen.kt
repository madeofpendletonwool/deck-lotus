package com.collinpendleton.decklotus.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import coil3.compose.AsyncImage
import com.collinpendleton.decklotus.CollectionSort
import com.collinpendleton.decklotus.CollectionViewModel
import com.collinpendleton.decklotus.data.InventoryCard
import com.collinpendleton.decklotus.data.OwnedPrinting
import java.text.NumberFormat
import java.util.Locale

private val money: NumberFormat = NumberFormat.getCurrencyInstance(Locale.US)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CollectionScreen(vm: CollectionViewModel = viewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    val usage by vm.usage.collectAsStateWithLifecycle()
    var openCardId by remember { mutableStateOf<Int?>(null) }
    val listState = rememberLazyListState()

    // Load the next page when the list nears its end.
    val nearEnd by remember { derivedStateOf { (listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) > listState.layoutInfo.totalItemsCount - 10 } }
    LaunchedEffect(nearEnd, s.cards.size) { if (nearEnd) vm.loadMore() }

    Column(Modifier.fillMaxSize().background(Lotus.bg).statusBarsPadding()) {
        Text("Collection", color = Lotus.text, fontSize = 24.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 16.dp, top = 12.dp))
        s.stats?.let { st ->
            Text(
                "%,d cards · %,d unique · %s".format(st.totalCopies, st.uniqueCards, money.format(st.estimatedValue)),
                color = Lotus.text2, fontSize = 14.sp, modifier = Modifier.padding(start = 16.dp, top = 2.dp),
            )
        }
        OutlinedTextField(
            value = s.query, onValueChange = vm::setQuery, singleLine = true,
            placeholder = { Text("Search your cards") },
            leadingIcon = { Icon(Icons.Default.Search, null) },
            trailingIcon = { if (s.query.isNotEmpty()) IconButton(onClick = { vm.setQuery("") }) { Icon(Icons.Default.Clear, "Clear") } },
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
        )
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp)) {
            items(CollectionSort.entries) { sort ->
                FilterChip(selected = s.sort == sort, onClick = { vm.setSort(sort) }, label = { Text(sort.label) })
            }
        }
        s.error?.let {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(it, color = Lotus.danger, fontSize = 13.sp, modifier = Modifier.weight(1f))
                TextButton(onClick = { vm.reload() }) { Text("Retry") }
            }
        }
        PullToRefreshBox(isRefreshing = s.refreshing, onRefresh = { vm.reload(pullToRefresh = true) }, modifier = Modifier.fillMaxSize()) {
            when {
                s.cards.isEmpty() && s.loading -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }
                s.cards.isEmpty() && s.error == null -> Box(Modifier.fillMaxSize().padding(32.dp), Alignment.Center) {
                    Text(
                        if (s.query.isBlank()) "Nothing here yet. Scan some cards and tap \"Add to collection\"." else "None of your cards match \"${s.query}\".",
                        color = Lotus.muted, fontSize = 15.sp,
                    )
                }
                else -> LazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
                    items(s.cards, key = { it.cardId }) { card -> CollectionRow(card) { openCardId = card.cardId; vm.loadUsage(card.cardId) } }
                    if (s.loading) item { Box(Modifier.fillMaxWidth().padding(16.dp), Alignment.Center) { CircularProgressIndicator(Modifier.size(24.dp)) } }
                }
            }
        }
    }

    // Look the card up by id so edits (which replace the list item) show live in the sheet.
    val open = openCardId?.let { id -> s.cards.firstOrNull { it.cardId == id } }
    if (openCardId != null) {
        ModalBottomSheet(onDismissRequest = { openCardId = null }, containerColor = Lotus.surface) {
            if (open == null) {
                Text("Removed from your collection.", color = Lotus.text2, modifier = Modifier.padding(24.dp))
            } else {
                CardSheet(open, usage[open.cardId], onQuantity = { p, q -> vm.setQuantity(open, p, q) }, onToggleFinish = { vm.toggleFinish(open, it) })
            }
        }
    }
}

@Composable
private fun CollectionRow(card: InventoryCard, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        AsyncImage(
            model = card.imageUrl, contentDescription = null, contentScale = ContentScale.Crop,
            modifier = Modifier.width(40.dp).aspectRatio(0.716f).clip(RoundedCornerShape(3.dp)).background(Lotus.surface2),
        )
        Column(Modifier.weight(1f).padding(start = 12.dp)) {
            Text(card.name, color = Lotus.text, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            val sets = card.printings.map { it.setCode.uppercase() }.distinct()
            Text(
                sets.take(4).joinToString(" · ") + if (sets.size > 4) " +${sets.size - 4}" else "",
                color = Lotus.muted, fontSize = 12.sp, maxLines = 1,
            )
        }
        if (card.printings.any { it.finish != "nonfoil" }) FinishTag("foil")
        Column(horizontalAlignment = Alignment.End, modifier = Modifier.padding(start = 10.dp)) {
            Text("×${card.totalOwned}", color = Lotus.text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
            if (card.totalInDecks > 0) Text("${card.totalInDecks} in decks", color = Lotus.muted, fontSize = 11.sp)
        }
    }
}

@Composable
fun FinishTag(finish: String) {
    if (finish == "nonfoil") return
    Text(
        if (finish == "etched") "ETCHED" else "FOIL", fontSize = 10.sp, fontWeight = FontWeight.Bold, color = Color.Black,
        modifier = Modifier.padding(start = 6.dp).clip(RoundedCornerShape(5.dp)).background(Lotus.foil).padding(horizontal = 6.dp, vertical = 2.dp),
    )
}

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
                AsyncImage(
                    model = card.imageUrl, contentDescription = card.name, contentScale = ContentScale.Crop,
                    modifier = Modifier.width(120.dp).aspectRatio(0.716f).clip(RoundedCornerShape(6.dp)).background(Lotus.surface2),
                )
                Column(Modifier.padding(start = 14.dp)) {
                    Text(card.name, color = Lotus.text, fontSize = 19.sp, fontWeight = FontWeight.SemiBold)
                    card.typeLine?.let { Text(it, color = Lotus.text2, fontSize = 13.sp) }
                    Spacer(Modifier.size(8.dp))
                    Text("${card.totalOwned} owned · ${card.available} free", color = Lotus.text, fontSize = 14.sp)
                    val value = card.printings.sumOf { (it.price ?: 0.0) * it.quantity }
                    if (value > 0) Text("About ${money.format(value)}", color = Lotus.muted, fontSize = 13.sp)
                }
            }
            Text("Your copies", color = Lotus.text2, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 18.dp, bottom = 4.dp))
        }
        items(card.printings, key = { "${it.printingId}-${it.finish}" }) { p ->
            Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                AsyncImage(
                    model = p.imageUrl, contentDescription = null, contentScale = ContentScale.Crop,
                    modifier = Modifier.width(36.dp).aspectRatio(0.716f).clip(RoundedCornerShape(3.dp)).background(Lotus.surface2),
                )
                Column(Modifier.weight(1f).padding(start = 10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("${p.setCode.uppercase()} #${p.collectorNumber ?: "?"}", color = Lotus.text, fontSize = 14.sp)
                        FinishTag(p.finish)
                    }
                    Text(
                        listOfNotNull(p.setName, p.price?.let { money.format(it) }).joinToString(" · "),
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
