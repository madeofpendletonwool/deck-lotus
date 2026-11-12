package com.collinpendleton.decklotus.ui

import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import com.collinpendleton.decklotus.DecksViewModel
import com.collinpendleton.decklotus.OpenDeck
import com.collinpendleton.decklotus.data.DeckCard
import com.collinpendleton.decklotus.data.DeckListItem
import com.collinpendleton.decklotus.data.DeckOwnership
import com.collinpendleton.decklotus.data.OwnershipCard
import java.text.NumberFormat
import java.util.Locale

private val money: NumberFormat = NumberFormat.getCurrencyInstance(Locale.US)

/** "commander" → "Commander", "duel" → "Duel"; null for no format. */
private fun formatLabel(f: String?) = f?.takeIf { it.isNotBlank() }?.replaceFirstChar { it.uppercase() }

@Composable
fun DecksScreen(vm: DecksViewModel, listState: LazyListState = rememberLazyListState()) {
    val s by vm.state.collectAsStateWithLifecycle()
    val open by vm.open.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { vm.loadIfNeeded() }

    val deck = open
    if (deck != null) {
        BackHandler(onBack = vm::closeDeck)
        DeckPage(deck, onBack = vm::closeDeck, onRetry = { vm.openDeck(deck.id, deck.name) })
        return
    }

    Column(Modifier.fillMaxSize().background(Lotus.bg).statusBarsPadding()) {
        Text("Decks", color = Lotus.text, fontSize = 24.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 16.dp, top = 8.dp))
        if (s.loaded) {
            val complete = s.decks.count { d -> s.ownership[d.id]?.let { it.cards > 0 && it.missingCards == 0 } == true }
            Text(
                buildString {
                    append(if (s.decks.size == 1) "1 deck" else "${s.decks.size} decks")
                    if (s.ownership.isNotEmpty()) append(" · $complete fully owned")
                },
                color = Lotus.text2, fontSize = 14.sp, modifier = Modifier.padding(start = 16.dp, bottom = 8.dp),
            )
        }
        s.error?.let {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(it, color = Lotus.danger, fontSize = 13.sp, modifier = Modifier.weight(1f))
                TextButton(onClick = { vm.reload() }) { Text("Retry") }
            }
        }
        PullToRefreshBox(isRefreshing = s.refreshing, onRefresh = { vm.reload(pullToRefresh = true) }, modifier = Modifier.fillMaxSize()) {
            when {
                !s.loaded && s.loading -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }
                s.loaded && s.decks.isEmpty() -> Box(Modifier.fillMaxSize().padding(32.dp), Alignment.Center) {
                    Text("No decks yet. Build one on the website and it shows up here.", color = Lotus.muted, fontSize = 15.sp, textAlign = TextAlign.Center)
                }
                else -> LazyColumn(state = listState, modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 16.dp)) {
                    items(s.decks, key = { it.id }) { d -> DeckRow(d, s.ownership[d.id]) { vm.openDeck(d.id, d.name) } }
                }
            }
        }
    }
}

@Composable
private fun DeckRow(d: DeckListItem, own: DeckOwnership?, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.width(52.dp).aspectRatio(0.716f).clip(RoundedCornerShape(5.dp)).background(Lotus.surface2), Alignment.Center) {
            Text(d.name.take(1).uppercase(), color = Lotus.muted, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
            AsyncImage(model = d.previewImage, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        }
        Column(Modifier.weight(1f).padding(start = 14.dp)) {
            Text(d.name, color = Lotus.text, fontSize = 16.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                listOfNotNull(formatLabel(d.format), "${d.mainboardCount} cards", d.sideboardCount.takeIf { it > 0 }?.let { "$it sideboard" }).joinToString(" · "),
                color = Lotus.muted, fontSize = 12.sp, maxLines = 1,
            )
            OwnershipLine(own)
        }
    }
}

/** "All owned", "8 missing · $43", or nothing while the numbers load. */
@Composable
private fun OwnershipLine(own: DeckOwnership?) {
    own ?: return
    if (own.cards == 0) return
    val (text, color) = when {
        own.missingCards == 0 && own.sharedCards == 0 -> "You own every card" to Lotus.success
        own.missingCards == 0 -> "You own every card · ${own.sharedCards} shared with other decks" to Lotus.success
        else -> buildString {
            append("${own.missingCards} missing")
            if (own.cost > 0) append(" · about ${money.format(own.cost)}")
        } to Lotus.gold
    }
    Text(text, color = color, fontSize = 12.sp, modifier = Modifier.padding(top = 2.dp), maxLines = 1, overflow = TextOverflow.Ellipsis)
}

private enum class DeckView(val label: String) { ALL("All cards"), MISSING("Missing"), SHARED("Shared") }

/** Where a card sits in the "All cards" list. */
private fun section(c: DeckCard): String = when {
    c.board == "sideboard" -> "Sideboard"
    c.board == "maybeboard" -> "Maybeboard"
    c.isCommander != 0 -> "Commander"
    else -> {
        val t = c.typeLine.orEmpty().substringBefore("//")
        when {
            "Creature" in t -> "Creatures"
            "Planeswalker" in t -> "Planeswalkers"
            "Battle" in t -> "Battles"
            "Instant" in t -> "Instants"
            "Sorcery" in t -> "Sorceries"
            "Artifact" in t -> "Artifacts"
            "Enchantment" in t -> "Enchantments"
            "Land" in t -> "Lands"
            else -> "Other"
        }
    }
}

private val SECTION_ORDER = listOf("Commander", "Creatures", "Planeswalkers", "Battles", "Instants", "Sorceries", "Artifacts", "Enchantments", "Lands", "Other", "Sideboard", "Maybeboard")

/** A card in one section, with the copies of every printing of it there added up. */
private data class Line(val card: DeckCard, val quantity: Int)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DeckPage(deck: OpenDeck, onBack: () -> Unit, onRetry: () -> Unit) {
    var view by rememberSaveable(deck.id) { mutableStateOf(DeckView.ALL) }
    val context = LocalContext.current
    val detail = deck.detail
    val report = deck.report
    val byCard = remember(report) { report?.cards.orEmpty().associateBy { it.cardId } }

    Column(Modifier.fillMaxSize().background(Lotus.bg).statusBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(end = 12.dp, top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back to decks", tint = Lotus.text) }
            Column(Modifier.weight(1f)) {
                Text(detail?.name ?: deck.name, color = Lotus.text, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                formatLabel(detail?.format)?.let { Text(it, color = Lotus.muted, fontSize = 12.sp) }
            }
        }
        when {
            detail == null && deck.loading -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }
            detail == null -> Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                Text(deck.error ?: "Couldn't load that deck", color = Lotus.danger, fontSize = 14.sp, textAlign = TextAlign.Center)
                TextButton(onClick = onRetry) { Text("Retry") }
            }
            else -> {
                report?.let { OwnershipHeader(it.summary) }
                val missing = report?.cards.orEmpty().filter { it.missing > 0 }
                val shared = report?.cards.orEmpty().filter { it.status == "shared" }
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(horizontal = 16.dp), modifier = Modifier.padding(vertical = 6.dp)) {
                    items(DeckView.entries.filter { it == DeckView.ALL || report != null }) { v ->
                        val n = when (v) { DeckView.ALL -> null; DeckView.MISSING -> missing.size; DeckView.SHARED -> shared.size }
                        FilterChip(selected = view == v, onClick = { view = v }, label = { Text(if (n == null) v.label else "${v.label} $n") })
                    }
                }
                when (view) {
                    DeckView.ALL -> AllCards(detail.cards, byCard)
                    DeckView.MISSING -> OwnershipList(
                        missing, empty = "You own every card in this deck.",
                        onShare = {
                            val text = missing.joinToString("\n") { "${it.missing} ${it.name}" }
                            val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
                            context.startActivity(Intent.createChooser(send, "Share the missing cards"))
                        },
                    )
                    DeckView.SHARED -> OwnershipList(shared, empty = "No card here is wanted by more decks than you have copies for.", onShare = null)
                }
            }
        }
    }
}

@Composable
private fun OwnershipHeader(s: DeckOwnership) {
    if (s.cards == 0) return
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp).clip(RoundedCornerShape(10.dp)).background(Lotus.surface).padding(14.dp)) {
        Text(
            if (s.missingCards == 0) "You own every card" else "You own ${s.ownedCards} of ${s.cards} cards",
            color = Lotus.text, fontSize = 15.sp, fontWeight = FontWeight.Medium,
        )
        LinearProgressIndicator(
            progress = { s.ownedCards.toFloat() / s.cards },
            color = if (s.missingCards == 0) Lotus.success else Lotus.gold, trackColor = Lotus.surface2,
            modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp).height(6.dp).clip(RoundedCornerShape(3.dp)),
        )
        val parts = buildList {
            if (s.missingCards > 0) add(
                "${s.missingCopies} ${if (s.missingCopies == 1) "copy" else "copies"} to get" +
                    (if (s.cost > 0) ", about ${money.format(s.cost)}" else "") +
                    (if (s.unpriced > 0) " (${s.unpriced} unpriced)" else ""),
            )
            if (s.sharedCards > 0) add("${s.sharedCards} shared with other decks")
        }
        if (parts.isNotEmpty()) Text(parts.joinToString(" · "), color = Lotus.text2, fontSize = 13.sp)
        Text("Basic lands aren't counted.", color = Lotus.muted, fontSize = 11.sp, modifier = Modifier.padding(top = 2.dp))
    }
}

@Composable
private fun AllCards(cards: List<DeckCard>, byCard: Map<Int, OwnershipCard>) {
    val sections = remember(cards) {
        cards.groupBy(::section)
            .mapValues { (_, rows) -> rows.groupBy { it.cardId }.map { (_, same) -> Line(same.first(), same.sumOf { it.quantity }) }.sortedWith(compareBy({ it.card.cmc ?: 0.0 }, { it.card.name })) }
            .toList().sortedBy { SECTION_ORDER.indexOf(it.first) }
    }
    if (cards.isEmpty()) {
        Box(Modifier.fillMaxSize().padding(32.dp), Alignment.Center) { Text("This deck has no cards yet.", color = Lotus.muted, fontSize = 15.sp) }
        return
    }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 16.dp)) {
        sections.forEach { (name, lines) ->
            item(key = "h-$name") {
                Text(
                    "$name  ${lines.sumOf { it.quantity }}", color = Lotus.text2, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(start = 16.dp, top = 14.dp, bottom = 4.dp),
                )
            }
            items(lines, key = { "$name-${it.card.cardId}" }) { line ->
                // Maybeboards don't claim copies, so they get no ownership mark
                CardLine(line, if (line.card.board == "maybeboard") null else byCard[line.card.cardId])
            }
        }
    }
}

@Composable
private fun CardLine(line: Line, own: OwnershipCard?) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
        Text("${line.quantity}", color = Lotus.text2, fontSize = 14.sp, modifier = Modifier.width(24.dp))
        Box(Modifier.width(30.dp).aspectRatio(0.716f).clip(RoundedCornerShape(3.dp)).background(Lotus.surface2)) {
            AsyncImage(model = line.card.imageUrl, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        }
        Column(Modifier.weight(1f).padding(start = 10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(line.card.name, color = Lotus.text, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                ManaCost(line.card.manaCost, Modifier.padding(start = 6.dp), pip = 14)
            }
            if (own?.status == "shared") {
                Text("Also in " + own.otherDecks.joinToString { it.name }, color = Lotus.muted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        own?.let { StatusMark(it) }
    }
}

/** ✓ owned, "shared", "1 of 2", or "missing". */
@Composable
private fun StatusMark(c: OwnershipCard) {
    val (text, color) = when (c.status) {
        "owned" -> "✓" to Lotus.success
        "shared" -> "shared" to Lotus.gold
        "partial" -> "${c.owned} of ${c.need}" to Lotus.gold
        else -> "missing" to Lotus.danger
    }
    Text(text, color = color, fontSize = 12.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(start = 8.dp))
}

@Composable
private fun OwnershipList(cards: List<OwnershipCard>, empty: String, onShare: (() -> Unit)?) {
    if (cards.isEmpty()) {
        Box(Modifier.fillMaxSize().padding(32.dp), Alignment.Center) { Text(empty, color = Lotus.muted, fontSize = 15.sp, textAlign = TextAlign.Center) }
        return
    }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 16.dp)) {
        if (onShare != null) item {
            Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Cheapest printing when the deck's has no price", color = Lotus.muted, fontSize = 11.sp, modifier = Modifier.weight(1f))
                TextButton(onClick = onShare) { Text("Share list") }
            }
        }
        items(cards, key = { it.cardId }) { c ->
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(c.name, color = Lotus.text, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        when {
                            c.status == "shared" -> "You have ${c.owned}; also in " + c.otherDecks.joinToString { "${it.name} (${it.quantity})" }
                            c.owned > 0 -> "Need ${c.need}, have ${c.owned}"
                            else -> "Need ${c.need}"
                        },
                        color = Lotus.muted, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis,
                    )
                }
                if (c.missing > 0) {
                    Column(horizontalAlignment = Alignment.End, modifier = Modifier.padding(start = 10.dp)) {
                        Text("×${c.missing}", color = Lotus.text, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                        c.priceEach?.let { Text(money.format(it * c.missing), color = Lotus.muted, fontSize = 12.sp) }
                    }
                }
            }
            HorizontalDivider(color = Lotus.border, modifier = Modifier.padding(horizontal = 16.dp))
        }
        item { Spacer(Modifier.size(8.dp)) }
    }
}
