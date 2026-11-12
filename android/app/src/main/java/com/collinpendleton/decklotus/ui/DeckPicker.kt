package com.collinpendleton.decklotus.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
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
import coil3.compose.AsyncImage
import com.collinpendleton.decklotus.data.DeckListItem
import com.collinpendleton.decklotus.data.DeckTarget

private val BOARDS = listOf("mainboard" to "Mainboard", "sideboard" to "Sideboard", "maybeboard" to "Maybeboard")

/**
 * Pick where the scanned cards go: a deck, its board, and whether they're also new to the
 * collection. [initial] is the last choice (deck id, board, also-collection).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeckPickerSheet(
    count: Int,
    decks: List<DeckListItem>?,
    error: String?,
    initial: Triple<Int?, String, Boolean>,
    onRetry: () -> Unit,
    onDismiss: () -> Unit,
    onConfirm: (DeckTarget) -> Unit,
) {
    var deckId by remember { mutableStateOf(initial.first) }
    var board by remember { mutableStateOf(initial.second) }
    var alsoCollection by remember { mutableStateOf(initial.third) }
    val chosen = decks?.firstOrNull { it.id == deckId }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Lotus.surface) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
            Text(
                if (count == 1) "Add 1 card to a deck" else "Add $count cards to a deck",
                color = Lotus.text, fontSize = 19.sp, fontWeight = FontWeight.SemiBold,
            )
            when {
                error != null && decks == null -> Row(Modifier.padding(vertical = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(error, color = Lotus.danger, fontSize = 14.sp, modifier = Modifier.weight(1f))
                    TextButton(onClick = onRetry) { Text("Retry") }
                }
                decks == null -> Box(Modifier.fillMaxWidth().padding(24.dp), Alignment.Center) { CircularProgressIndicator() }
                decks.isEmpty() -> Text(
                    "You don't have any decks yet. Make one on the website first.",
                    color = Lotus.muted, fontSize = 14.sp, modifier = Modifier.padding(vertical = 16.dp),
                )
                else -> LazyColumn(Modifier.fillMaxWidth().heightIn(max = 320.dp).padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(decks, key = { it.id }) { d ->
                        val on = d.id == deckId
                        Row(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp))
                                .border(1.5.dp, if (on) Lotus.gold else Lotus.border, RoundedCornerShape(8.dp))
                                .background(if (on) Lotus.goldSoft else Color.Transparent)
                                .clickable { deckId = d.id }
                                .padding(8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(Modifier.width(30.dp).aspectRatio(0.716f).clip(RoundedCornerShape(3.dp)).background(Lotus.surface2)) {
                                AsyncImage(model = d.previewImage, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                            }
                            Column(Modifier.weight(1f).padding(start = 10.dp)) {
                                Text(d.name, color = Lotus.text, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(
                                    listOfNotNull(d.format?.replaceFirstChar { it.uppercase() }, "${d.mainboardCount} cards").joinToString(" · "),
                                    color = Lotus.muted, fontSize = 12.sp,
                                )
                            }
                        }
                    }
                }
            }

            if (!decks.isNullOrEmpty()) {
                Text("Board", color = Lotus.text2, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp, bottom = 6.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    BOARDS.forEach { (value, label) ->
                        FilterChip(selected = board == value, onClick = { board = value }, label = { Text(label) })
                    }
                }
                Row(
                    Modifier.fillMaxWidth().padding(top = 14.dp).clip(RoundedCornerShape(8.dp)).clickable { alsoCollection = !alsoCollection }.padding(vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text("Also add to my collection", color = Lotus.text, fontSize = 15.sp)
                        Text(
                            if (alsoCollection) "For new cards: they're counted in your collection too."
                            else "Off for cards already in your collection, so they aren't counted twice.",
                            color = Lotus.muted, fontSize = 12.sp,
                        )
                    }
                    Switch(
                        checked = alsoCollection, onCheckedChange = { alsoCollection = it },
                        colors = SwitchDefaults.colors(checkedTrackColor = Lotus.gold, checkedThumbColor = Color.Black),
                    )
                }
                Button(
                    onClick = { chosen?.let { onConfirm(DeckTarget(it.id, it.name, board, alsoCollection)) } },
                    enabled = chosen != null,
                    modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp),
                ) {
                    Text(
                        when {
                            chosen == null -> "Pick a deck"
                            else -> "Add ${if (count == 1) "1 card" else "$count cards"} to ${chosen.name}"
                        },
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}
