package com.collinpendleton.decklotus.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

internal data class ManaColor(val code: String, val label: String, val fill: Color, val ink: Color)

internal val MANA = listOf(
    ManaColor("W", "White", Color(0xFFF4EBCB), Color(0xFF3A3424)),
    ManaColor("U", "Blue", Color(0xFF3F86D1), Color.White),
    ManaColor("B", "Black", Color(0xFF3A3340), Color(0xFFE6E0EA)),
    ManaColor("R", "Red", Color(0xFFD9573A), Color.White),
    ManaColor("G", "Green", Color(0xFF3C9659), Color.White),
    ManaColor("C", "Colorless", Color(0xFFB9B4AA), Color(0xFF2C2A26)),
)

/** Generic and other symbols ({2}, {X}, {T}) are drawn grey. */
private val GENERIC = ManaColor("", "", Color(0xFF8C8F98), Color(0xFF16171B))

/**
 * A mana cost like "{2}{U}{R}" as small coloured pips. A hybrid or Phyrexian symbol ({W/U}, {G/P})
 * takes its first colour. Double-faced cards' "{1}{U} // {3}" shows the front face only.
 */
@Composable
fun ManaCost(cost: String?, modifier: Modifier = Modifier, pip: Int = 15) {
    if (cost.isNullOrBlank()) return
    val symbols = Regex("""\{([^}]+)\}""").findAll(cost.substringBefore("//")).map { it.groupValues[1] }.toList()
    if (symbols.isEmpty()) return
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(1.dp), verticalAlignment = Alignment.CenterVertically) {
        symbols.forEach { sym ->
            val first = sym.substringBefore('/')
            val color = MANA.firstOrNull { it.code == first && first != "C" } ?: if (first == "C") MANA.last() else GENERIC
            Box(Modifier.size(pip.dp).clip(CircleShape).background(color.fill), Alignment.Center) {
                Text(
                    // Letters on every pip, so colour isn't the only cue
                    first.take(2),
                    color = color.ink, fontSize = (pip * 0.62).sp, fontWeight = FontWeight.Bold, maxLines = 1,
                    // Without trimming, font padding pushes the letter below the pip's centre
                    style = TextStyle(
                        platformStyle = PlatformTextStyle(includeFontPadding = false),
                        lineHeight = (pip * 0.62).sp,
                        lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.Both),
                    ),
                )
            }
        }
    }
}
