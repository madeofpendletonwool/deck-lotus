package com.collinpendleton.decklotus.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Same palette as the web app (client/src styles).
object Lotus {
    val bg = Color(0xFF0C0D11)
    val surface = Color(0xFF14161C)
    val surface2 = Color(0xFF1C1F27)
    val border = Color(0xFF262A33)
    val text = Color(0xFFECEEF2)
    val text2 = Color(0xFFA7ADB9)
    val muted = Color(0xFF7B818E)
    val gold = Color(0xFFE4A43F)
    val goldSoft = Color(0x24E4A43F)
    val success = Color(0xFF34B27B)
    val danger = Color(0xFFE5534B)
    val foil = Color(0xFF9B8CFF)
}

@Composable
fun LotusTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Lotus.gold,
            onPrimary = Color(0xFF1A1206),
            background = Lotus.bg,
            onBackground = Lotus.text,
            surface = Lotus.surface,
            onSurface = Lotus.text,
            surfaceVariant = Lotus.surface2,
            onSurfaceVariant = Lotus.text2,
            outline = Lotus.border,
            error = Lotus.danger,
        ),
        content = content,
    )
}
