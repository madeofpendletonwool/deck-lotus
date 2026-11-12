package com.collinpendleton.decklotus.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** Outline icons for the bottom bar, drawn on a 24-unit grid. */
object LotusIcons {
    private fun icon(name: String, block: ImageVector.Builder.() -> Unit) =
        ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply(block).build()

    private fun ImageVector.Builder.stroke(build: PathBuilder.() -> Unit) = path(
        fill = null,
        stroke = SolidColor(Color.Black),
        strokeLineWidth = 1.8f,
        strokeLineCap = StrokeCap.Round,
        strokeLineJoin = StrokeJoin.Round,
        pathBuilder = build,
    )

    private fun PathBuilder.roundRect(x: Float, y: Float, w: Float, h: Float, r: Float) {
        moveTo(x + r, y)
        lineTo(x + w - r, y); arcTo(r, r, 0f, false, true, x + w, y + r)
        lineTo(x + w, y + h - r); arcTo(r, r, 0f, false, true, x + w - r, y + h)
        lineTo(x + r, y + h); arcTo(r, r, 0f, false, true, x, y + h - r)
        lineTo(x, y + r); arcTo(r, r, 0f, false, true, x + r, y)
        close()
    }

    private fun PathBuilder.circle(cx: Float, cy: Float, r: Float) {
        moveTo(cx - r, cy)
        arcTo(r, r, 0f, true, true, cx + r, cy)
        arcTo(r, r, 0f, true, true, cx - r, cy)
        close()
    }

    val Scan = icon("Scan") {
        // Viewfinder corners around a card.
        stroke {
            moveTo(3f, 8f); lineTo(3f, 5f); arcTo(2f, 2f, 0f, false, true, 5f, 3f); lineTo(8f, 3f)
            moveTo(16f, 3f); lineTo(19f, 3f); arcTo(2f, 2f, 0f, false, true, 21f, 5f); lineTo(21f, 8f)
            moveTo(21f, 16f); lineTo(21f, 19f); arcTo(2f, 2f, 0f, false, true, 19f, 21f); lineTo(16f, 21f)
            moveTo(8f, 21f); lineTo(5f, 21f); arcTo(2f, 2f, 0f, false, true, 3f, 19f); lineTo(3f, 16f)
        }
        stroke { roundRect(8.5f, 6.5f, 7f, 11f, 1.2f) }
    }

    val Collection = icon("Collection") {
        // A fanned stack of cards.
        stroke { roundRect(9f, 4f, 10f, 15f, 1.5f) }
        stroke {
            moveTo(6.5f, 6.5f); lineTo(6.5f, 19f); arcTo(1.5f, 1.5f, 0f, false, false, 8f, 20.5f); lineTo(16f, 20.5f)
        }
        stroke {
            moveTo(4f, 9f); lineTo(4f, 21f); arcTo(1.5f, 1.5f, 0f, false, false, 5.5f, 22.5f); lineTo(12f, 22.5f)
        }
    }

    val Account = icon("Account") {
        stroke { circle(12f, 8.5f, 4f) }
        stroke {
            moveTo(4.5f, 20.5f)
            curveTo(5.5f, 16.5f, 8.5f, 14.5f, 12f, 14.5f)
            curveTo(15.5f, 14.5f, 18.5f, 16.5f, 19.5f, 20.5f)
        }
    }
}
