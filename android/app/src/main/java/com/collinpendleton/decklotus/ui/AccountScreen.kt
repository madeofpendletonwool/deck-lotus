package com.collinpendleton.decklotus.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.collinpendleton.decklotus.BuildConfig
import com.collinpendleton.decklotus.IndexStatus
import com.collinpendleton.decklotus.data.Account
import java.text.DateFormat
import java.util.Date

@Composable
fun AccountScreen(account: Account, index: IndexStatus, pendingUploads: Int, onSignOut: () -> Unit) {
    var confirm by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().background(Lotus.bg).statusBarsPadding().padding(16.dp)) {
        Text("Account", color = Lotus.text, fontSize = 24.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.size(16.dp))
        Section {
            Line("Signed in as", account.username)
            Line("Server", account.serverUrl.removePrefix("https://"))
        }
        Section {
            val idx = when (index) {
                is IndexStatus.Ready -> "%,d printings, built %s".format(index.size, DateFormat.getDateInstance(DateFormat.MEDIUM).format(Date(index.builtAt)))
                IndexStatus.Loading -> "Loading…"
                is IndexStatus.Missing -> "Missing"
            }
            Line("Card scanner data", idx)
            if (pendingUploads > 0) Line("Waiting to upload", "$pendingUploads cards")
            Line("App version", BuildConfig.VERSION_NAME)
        }
        Spacer(Modifier.size(8.dp))
        OutlinedButton(onClick = { confirm = true }, modifier = Modifier.fillMaxWidth()) { Text("Sign out", color = Lotus.danger) }
    }
    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text("Sign out?") },
            text = {
                Text(
                    if (pendingUploads > 0) "$pendingUploads scanned cards haven't reached the server yet. They stay on this phone and upload after you sign back in."
                    else "Scans in progress stay on this phone.",
                )
            },
            confirmButton = { TextButton(onClick = { confirm = false; onSignOut() }) { Text("Sign out", color = Lotus.danger) } },
            dismissButton = { TextButton(onClick = { confirm = false }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun Section(content: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxWidth().padding(bottom = 12.dp).background(Lotus.surface, RoundedCornerShape(12.dp)).padding(horizontal = 14.dp, vertical = 6.dp),
    ) { content() }
}

@Composable
private fun Line(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        Text(label, color = Lotus.text2, fontSize = 14.sp, modifier = Modifier.weight(1f))
        Text(value, color = Lotus.text, fontSize = 14.sp)
    }
}
