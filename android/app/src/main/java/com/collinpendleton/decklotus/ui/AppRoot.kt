package com.collinpendleton.decklotus.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.collinpendleton.decklotus.AppViewModel
import com.collinpendleton.decklotus.CollectionViewModel
import com.collinpendleton.decklotus.ScanViewModel
import com.collinpendleton.decklotus.data.Account

private enum class Tab(val label: String, val icon: ImageVector) {
    SCAN("Scan", LotusIcons.Scan),
    COLLECTION("Collection", LotusIcons.Collection),
    ACCOUNT("Account", LotusIcons.Account),
}

@Composable
fun AppRoot(app: AppViewModel = viewModel()) {
    val account by app.account.collectAsStateWithLifecycle()
    val login by app.login.collectAsStateWithLifecycle()
    val signedIn = account
    if (signedIn == null) {
        LoginScreen(login, app.lastServer, app.lastUsername, app::signIn)
    } else {
        MainShell(signedIn, onSignOut = app::signOut)
    }
}

@Composable
private fun MainShell(account: Account, onSignOut: () -> Unit) {
    // Activity-scoped, so the camera pipeline, scan list and collection survive tab switches.
    val scan: ScanViewModel = viewModel()
    val collection: CollectionViewModel = viewModel()
    var tab by rememberSaveable { mutableIntStateOf(Tab.SCAN.ordinal) }
    val pending by scan.pendingCount.collectAsStateWithLifecycle()
    val upload by scan.upload.collectAsStateWithLifecycle()
    val index by scan.indexStatus.collectAsStateWithLifecycle()

    // Signing back in finishes uploads that stalled on an expired session.
    LaunchedEffect(account.username, account.serverUrl) { if (pending > 0) scan.retryUploads() }
    // Freshly uploaded cards should be there when you look.
    LaunchedEffect(tab, upload) { if (tab == Tab.COLLECTION.ordinal) collection.reload() }

    Scaffold(
        containerColor = Lotus.bg,
        contentWindowInsets = WindowInsets(0),
        bottomBar = {
            NavigationBar(containerColor = Lotus.surface) {
                Tab.entries.forEach { t ->
                    NavigationBarItem(
                        selected = tab == t.ordinal,
                        onClick = { tab = t.ordinal },
                        icon = {
                            BadgedBox(badge = { if (t == Tab.ACCOUNT && pending > 0) Badge { Text("$pending") } }) {
                                Icon(t.icon, t.label)
                            }
                        },
                        label = { Text(t.label) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = Lotus.gold, selectedTextColor = Lotus.gold,
                            indicatorColor = Lotus.goldSoft,
                            unselectedIconColor = Lotus.text2, unselectedTextColor = Lotus.text2,
                        ),
                    )
                }
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when (Tab.entries[tab]) {
                Tab.SCAN -> ScanScreen(scan)
                Tab.COLLECTION -> CollectionScreen(collection)
                Tab.ACCOUNT -> AccountScreen(account, index, pending, onSignOut)
            }
        }
    }
}
