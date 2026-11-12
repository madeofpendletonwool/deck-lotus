package com.collinpendleton.decklotus.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.util.Size
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.core.UseCaseGroup
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import coil3.compose.AsyncImage
import com.collinpendleton.decklotus.IndexStatus
import com.collinpendleton.decklotus.ScanViewModel
import com.collinpendleton.decklotus.UploadState
import com.collinpendleton.decklotus.core.IndexEntry
import com.collinpendleton.decklotus.data.ScannedCard
import com.collinpendleton.decklotus.scan.FrameState
import com.collinpendleton.decklotus.scan.Phase
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.util.concurrent.Executors

@Composable
fun ScanScreen(vm: ScanViewModel = viewModel()) {
    val context = LocalContext.current
    var granted by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
    }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it }
    LaunchedEffect(Unit) { if (!granted) launcher.launch(Manifest.permission.CAMERA) }

    val frame by vm.frame.collectAsStateWithLifecycle()
    val index by vm.indexStatus.collectAsStateWithLifecycle()
    val session by vm.session.collectAsStateWithLifecycle()
    val foilMode by vm.foilMode.collectAsStateWithLifecycle()
    val debug by vm.debug.collectAsStateWithLifecycle()
    val upload by vm.upload.collectAsStateWithLifecycle()

    var torch by remember { mutableStateOf(false) }
    var showDebug by remember { mutableStateOf(false) }
    var picking by remember { mutableStateOf<ScannedCard?>(null) }
    var confirmClear by remember { mutableStateOf(false) }
    var camera by remember { mutableStateOf<Camera?>(null) }

    Column(Modifier.fillMaxSize().background(Lotus.bg)) {
        Box(Modifier.fillMaxWidth().weight(1f).background(Color.Black)) {
            if (granted) {
                CameraPreview(vm, onCamera = { camera = it })
                CardOutline(frame)
            } else {
                Column(Modifier.align(Alignment.Center).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("The scanner needs the camera.", color = Lotus.text)
                    Spacer(Modifier.size(12.dp))
                    Button(onClick = { launcher.launch(Manifest.permission.CAMERA) }) { Text("Allow camera") }
                }
            }

            Row(
                Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Pill(indexLabel(index), if (index is IndexStatus.Missing) Lotus.danger else Lotus.text2)
                if (frame.fps > 0) Pill("%.0f fps".format(frame.fps), Lotus.muted)
                if (showDebug && frame.sharpness > 0) Pill("sharp ${frame.sharpness}", Lotus.muted)
                Spacer(Modifier.weight(1f))
                FilterChip(
                    selected = foilMode,
                    onClick = { vm.setFoilMode(!foilMode) },
                    label = { Text("Foil mode") },
                    colors = FilterChipDefaults.filterChipColors(
                        containerColor = Color(0x99000000), labelColor = Lotus.text,
                        selectedContainerColor = Lotus.foil, selectedLabelColor = Color.Black,
                    ),
                )
                OverlayButton(if (torch) "Light on" else "Light", torch) {
                    torch = !torch
                    camera?.cameraControl?.enableTorch(torch)
                }
                OverlayButton("Debug", showDebug) { showDebug = !showDebug }
            }

            if (index is IndexStatus.Missing) {
                Text(
                    (index as IndexStatus.Missing).message,
                    color = Lotus.text,
                    modifier = Modifier.align(Alignment.Center).padding(24.dp)
                        .background(Color(0xCC000000), RoundedCornerShape(10.dp)).padding(16.dp),
                )
            }

            if (showDebug) {
                debug?.let { d ->
                    Row(
                        Modifier.align(Alignment.TopStart).padding(top = 64.dp, start = 12.dp, end = 12.dp)
                            .statusBarsPadding()
                            .background(Color(0xD9000000), RoundedCornerShape(10.dp)).padding(8.dp),
                    ) {
                        Image(d.thumb.asImageBitmap(), null, Modifier.width(88.dp).clip(RoundedCornerShape(4.dp)))
                        Column(Modifier.padding(start = 8.dp)) {
                            Text(d.summary, color = Lotus.text, fontSize = 12.sp)
                            Text("name: ${d.nameText.ifEmpty { "—" }}", color = Lotus.text2, fontSize = 12.sp)
                            Text("collector: ${d.collectorText.joinToString(" | ").ifEmpty { "—" }}", color = Lotus.text2, fontSize = 12.sp)
                            TextButton(onClick = {
                                val f = vm.saveDebugFrame()
                                Toast.makeText(context, f?.let { "Saved to $it" } ?: "Couldn't save", Toast.LENGTH_SHORT).show()
                            }) { Text("Save frame") }
                        }
                    }
                }
            }

            PhaseBanner(frame.phase, Modifier.align(Alignment.BottomCenter).padding(12.dp))
        }

        SessionPanel(
            session = session,
            onFoil = vm::toggleFoil,
            onRemove = vm::remove,
            onPick = { picking = it },
            onUndo = vm::undo,
            onShare = {
                val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, vm.exportText())
                context.startActivity(Intent.createChooser(send, "Export scanned cards"))
            },
            onClear = { confirmClear = true },
            upload = upload,
            onAdd = vm::addToCollection,
            onRetry = vm::retryUploads,
            onDismissUpload = vm::dismissUploadMessage,
        )
    }

    picking?.let { card ->
        PrintingPicker(card, vm.printingsFor(card), onDismiss = { picking = null }) {
            vm.choosePrinting(card.key, it)
            picking = null
        }
    }
    if (confirmClear) {
        AlertDialog(
            onDismissRequest = { confirmClear = false },
            title = { Text("Clear ${session.size} scanned cards?") },
            text = { Text("They haven't been added to your inventory yet. Export them first if you want to keep them.") },
            confirmButton = { TextButton(onClick = { vm.clear(); confirmClear = false }) { Text("Clear", color = Lotus.danger) } },
            dismissButton = { TextButton(onClick = { confirmClear = false }) { Text("Cancel") } },
        )
    }
}

private fun indexLabel(s: IndexStatus) = when (s) {
    IndexStatus.Loading -> "Loading cards…"
    is IndexStatus.Missing -> "No card index"
    is IndexStatus.Ready -> "%,d printings · loaded in %.1f s".format(s.size, s.loadMillis / 1000.0)
}

@Composable
private fun CameraPreview(vm: ScanViewModel, onCamera: (Camera) -> Unit) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val previewView = remember { PreviewView(context).apply { scaleType = PreviewView.ScaleType.FILL_CENTER } }
    val executor = remember { Executors.newSingleThreadExecutor() }
    var bound by remember { mutableStateOf<ProcessCameraProvider?>(null) }
    DisposableEffect(Unit) { onDispose { executor.shutdown() } }

    LaunchedEffect(owner) {
        val provider = withContext(Dispatchers.IO) { ProcessCameraProvider.getInstance(context).get() }
        fun selector() = ResolutionSelector.Builder()
            .setAspectRatioStrategy(AspectRatioStrategy.RATIO_16_9_FALLBACK_AUTO_STRATEGY)
            // 1080p keeps the collector line readable without making each frame expensive.
            .setResolutionStrategy(ResolutionStrategy(Size(1920, 1080), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
            .build()
        val preview = Preview.Builder().setResolutionSelector(selector()).build()
        preview.setSurfaceProvider(previewView.surfaceProvider)
        val analysis = ImageAnalysis.Builder()
            .setResolutionSelector(selector())
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
            .build()
        analysis.setAnalyzer(executor, vm.pipeline)
        // The viewport exists once the preview has been laid out. Sharing it
        // makes the analysis frames' cropRect match exactly what's on screen.
        while (previewView.viewPort == null) delay(16)
        val group = UseCaseGroup.Builder()
            .setViewPort(previewView.viewPort!!)
            .addUseCase(preview)
            .addUseCase(analysis)
            .build()
        provider.unbindAll()
        bound = provider
        onCamera(provider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, group))
    }
    // Leaving the Scan tab: let go of the camera (and stop analysing frames).
    DisposableEffect(Unit) { onDispose { bound?.unbindAll() } }
    AndroidView({ previewView }, Modifier.fillMaxSize())
}

/** "Add 12 to collection", or how the last upload went. */
@Composable
private fun UploadBar(count: Int, upload: UploadState, onAdd: () -> Unit, onRetry: () -> Unit, onDismiss: () -> Unit) {
    when (upload) {
        is UploadState.Waiting -> Row(
            Modifier.fillMaxWidth().background(Lotus.goldSoft).padding(start = 16.dp, end = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("${upload.count} cards saved on this phone. ${upload.message}.", color = Lotus.text, fontSize = 13.sp, modifier = Modifier.weight(1f))
            TextButton(onClick = onRetry) { Text("Retry") }
        }
        is UploadState.Sent -> Row(
            Modifier.fillMaxWidth().background(Color(0x2234B27B)).clickable(onClick = onDismiss).padding(horizontal = 16.dp, vertical = 10.dp),
        ) { Text(upload.message, color = Lotus.success, fontSize = 13.sp) }
        else -> Unit
    }
    if (count > 0) {
        Button(
            onClick = onAdd, enabled = upload != UploadState.Sending,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            Text(if (upload == UploadState.Sending) "Adding…" else if (count == 1) "Add 1 card to collection" else "Add $count cards to collection")
        }
    }
}

/** Draws the detected card's outline over the preview (which is FILL_CENTER scaled). */
@Composable
private fun CardOutline(frame: FrameState) {
    val corners = frame.corners ?: return
    val color = when (frame.phase) {
        Phase.HOLDING, Phase.READING, Phase.CHECKING_PRINTING -> Lotus.gold
        Phase.UNKNOWN -> Lotus.danger
        else -> Color.White
    }
    Canvas(Modifier.fillMaxSize()) {
        val fw = frame.frameAspect
        val scale = maxOf(size.width / fw, size.height)
        val ox = (size.width - fw * scale) / 2
        val oy = (size.height - scale) / 2
        val pts = corners.map { (x, y) -> Offset(ox + x * fw * scale, oy + y * scale) }
        val path = Path().apply {
            moveTo(pts[0].x, pts[0].y)
            pts.drop(1).forEach { lineTo(it.x, it.y) }
            close()
        }
        drawPath(path, color.copy(alpha = 0.12f))
        drawPath(path, color, style = Stroke(width = 3.dp.toPx()))
    }
}

@Composable
private fun PhaseBanner(phase: Phase, modifier: Modifier) {
    val (text, color) = when (phase) {
        Phase.NO_INDEX -> "Waiting for the card index" to Lotus.text2
        Phase.SEARCHING -> "Looking for a card" to Lotus.text2
        Phase.STEADYING -> "Hold still…" to Lotus.text
        Phase.BLURRY -> "Too blurry. Hold steady or add light" to Lotus.text
        Phase.READING -> "Reading the name…" to Lotus.gold
        Phase.CHECKING_PRINTING -> "Got it. Checking the printing, hold a moment" to Lotus.gold
        Phase.HOLDING -> "Got it. Next card" to Lotus.success
        Phase.UNKNOWN -> "Can't identify this one. Try reducing glare" to Lotus.danger
    }
    Text(
        text, color = color, fontSize = 14.sp, fontWeight = FontWeight.Medium,
        modifier = modifier.background(Color(0xB3000000), RoundedCornerShape(20.dp)).padding(horizontal = 14.dp, vertical = 6.dp),
    )
}

@Composable
private fun Pill(text: String, color: Color) {
    Text(
        text, color = color, fontSize = 12.sp,
        modifier = Modifier.background(Color(0x99000000), RoundedCornerShape(12.dp)).padding(horizontal = 8.dp, vertical = 4.dp),
    )
}

@Composable
private fun OverlayButton(label: String, active: Boolean, onClick: () -> Unit) {
    Text(
        label, color = if (active) Color.Black else Lotus.text, fontSize = 13.sp,
        modifier = Modifier.clip(RoundedCornerShape(8.dp))
            .background(if (active) Lotus.gold else Color(0x99000000))
            .clickable(onClick = onClick).padding(horizontal = 10.dp, vertical = 7.dp),
    )
}

@Composable
private fun SessionPanel(
    session: List<ScannedCard>,
    onFoil: (Long) -> Unit,
    onRemove: (Long) -> Unit,
    onPick: (ScannedCard) -> Unit,
    onUndo: () -> Unit,
    onShare: () -> Unit,
    onClear: () -> Unit,
    upload: UploadState,
    onAdd: () -> Unit,
    onRetry: () -> Unit,
    onDismissUpload: () -> Unit,
) {
    Column(
        Modifier.fillMaxWidth().fillMaxHeight(0.42f).background(Lotus.surface),
    ) {
        UploadBar(session.size, upload, onAdd, onRetry, onDismissUpload)
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp, top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            val review = session.count { it.needsReview }
            Text("${session.size} scanned", color = Lotus.text, fontWeight = FontWeight.SemiBold)
            if (review > 0) Text("  · $review to check", color = Lotus.gold, fontSize = 13.sp)
            Spacer(Modifier.weight(1f))
            TextButton(onClick = onUndo, enabled = session.isNotEmpty()) { Text("Undo") }
            TextButton(onClick = onShare, enabled = session.isNotEmpty()) { Text("Export") }
            TextButton(onClick = onClear, enabled = session.isNotEmpty()) { Text("Clear", color = if (session.isEmpty()) Lotus.muted else Lotus.text2) }
        }
        HorizontalDivider(color = Lotus.border)
        if (session.isEmpty()) {
            Text(
                "Lay a card under the camera. It's read as soon as it's still: no button. " +
                    "A plain mat that contrasts with the card's border works best.",
                color = Lotus.muted, fontSize = 14.sp, modifier = Modifier.padding(16.dp),
            )
            return@Column
        }
        LastCard(session.first(), onFoil, onPick, onRemove)
        HorizontalDivider(color = Lotus.border)
        LazyColumn(Modifier.fillMaxSize()) {
            items(session.drop(1), key = { it.key }) { c -> CardRow(c, onFoil, onPick, onRemove) }
        }
    }
}

@Composable
private fun LastCard(c: ScannedCard, onFoil: (Long) -> Unit, onPick: (ScannedCard) -> Unit, onRemove: (Long) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
        AsyncImage(
            model = c.imageUrl, contentDescription = c.cardName, contentScale = ContentScale.Crop,
            modifier = Modifier.width(64.dp).heightIn(min = 89.dp).clip(RoundedCornerShape(4.dp)).background(Lotus.surface2),
        )
        Column(Modifier.weight(1f).padding(start = 12.dp)) {
            Text(c.cardName, color = Lotus.text, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text("${c.setCode} · #${c.collectorNumber}", color = Lotus.text2, fontSize = 14.sp)
            if (c.needsReview) Text(if (c.printingCertain) "Low confidence, check the card" else "Same art in several sets. Check the printing", color = Lotus.gold, fontSize = 12.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 6.dp)) {
                val foilable = c.finishes and IndexEntry.FINISH_FOIL != 0
                FilterChip(
                    selected = c.foil, enabled = foilable, onClick = { onFoil(c.key) },
                    label = { Text(if (foilable) "Foil" else "No foil") },
                    colors = FilterChipDefaults.filterChipColors(selectedContainerColor = Lotus.foil, selectedLabelColor = Color.Black),
                )
                OutlinedButton(
                    onClick = { onPick(c) },
                    border = BorderStroke(1.dp, if (c.printingCertain) Lotus.border else Lotus.gold),
                ) { Text("Printing", color = if (c.printingCertain) Lotus.text2 else Lotus.gold) }
                TextButton(onClick = { onRemove(c.key) }) { Text("Remove", color = Lotus.text2) }
            }
        }
    }
}

@Composable
private fun CardRow(c: ScannedCard, onFoil: (Long) -> Unit, onPick: (ScannedCard) -> Unit, onRemove: (Long) -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable { onPick(c) }.padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AsyncImage(
            model = c.imageUrl, contentDescription = null, contentScale = ContentScale.Crop,
            modifier = Modifier.size(width = 30.dp, height = 42.dp).clip(RoundedCornerShape(2.dp)).background(Lotus.surface2),
        )
        Column(Modifier.weight(1f).padding(start = 10.dp)) {
            Text(c.cardName, color = Lotus.text, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("${c.setCode} · #${c.collectorNumber}", color = if (c.needsReview) Lotus.gold else Lotus.muted, fontSize = 12.sp)
        }
        val foilable = c.finishes and IndexEntry.FINISH_FOIL != 0
        Text(
            "FOIL", fontSize = 11.sp, fontWeight = FontWeight.Bold,
            color = when { c.foil -> Color.Black; foilable -> Lotus.muted; else -> Lotus.border },
            modifier = Modifier.clip(RoundedCornerShape(6.dp))
                .background(if (c.foil) Lotus.foil else Color.Transparent)
                .border(1.dp, if (c.foil) Lotus.foil else Lotus.border, RoundedCornerShape(6.dp))
                .clickable(enabled = foilable) { onFoil(c.key) }
                .padding(horizontal = 8.dp, vertical = 4.dp),
        )
        Text(
            "✕", color = Lotus.muted, fontSize = 16.sp,
            modifier = Modifier.clip(RoundedCornerShape(6.dp)).clickable { onRemove(c.key) }.padding(horizontal = 12.dp, vertical = 6.dp),
        )
    }
}

@Composable
private fun PrintingPicker(card: ScannedCard, printings: List<IndexEntry>, onDismiss: () -> Unit, onChoose: (IndexEntry) -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(card.cardName) },
        text = {
            LazyColumn(Modifier.heightIn(max = 460.dp)) {
                items(printings, key = { "${it.scryfallId}-${it.face}" }) { p ->
                    val current = p.scryfallId.toString() == card.scryfallId
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(6.dp))
                            .background(if (current) Lotus.goldSoft else Color.Transparent)
                            .clickable { onChoose(p) }.padding(6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        AsyncImage(
                            model = p.imageUrl, contentDescription = null, contentScale = ContentScale.Crop,
                            modifier = Modifier.size(width = 46.dp, height = 64.dp).clip(RoundedCornerShape(3.dp)).background(Lotus.surface2),
                        )
                        Column(Modifier.padding(start = 10.dp)) {
                            Text("${p.setCode} · #${p.collectorNumber}", color = Lotus.text, fontSize = 15.sp)
                            val finishes = buildList {
                                if (p.finishes and IndexEntry.FINISH_NONFOIL != 0) add("nonfoil")
                                if (p.finishes and IndexEntry.FINISH_FOIL != 0) add("foil")
                                if (p.finishes and IndexEntry.FINISH_ETCHED != 0) add("etched")
                            }
                            Text(finishes.joinToString(" · "), color = Lotus.muted, fontSize = 12.sp)
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Close") } },
    )
}
