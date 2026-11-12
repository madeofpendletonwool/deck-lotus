package com.collinpendleton.decklotus.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.collinpendleton.decklotus.LoginState
import com.collinpendleton.decklotus.R

@Composable
fun LoginScreen(
    state: LoginState,
    initialServer: String,
    initialUsername: String,
    onSignIn: (server: String, username: String, password: String) -> Unit,
) {
    var server by rememberSaveable { mutableStateOf(initialServer) }
    var username by rememberSaveable { mutableStateOf(initialUsername) }
    var password by remember { mutableStateOf("") }
    val passwordFocus = remember { FocusRequester() }
    fun submit() { if (!state.busy) onSignIn(server, username, password) }

    Column(
        Modifier.fillMaxSize().background(Lotus.bg).systemBarsPadding().imePadding()
            .verticalScroll(rememberScrollState()).padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Image(painterResource(R.mipmap.ic_launcher), null, Modifier.size(72.dp))
        Spacer(Modifier.height(16.dp))
        Text("Deck Lotus", color = Lotus.text, fontSize = 26.sp, fontWeight = FontWeight.SemiBold)
        Text("Sign in to your server", color = Lotus.text2, fontSize = 15.sp)
        Spacer(Modifier.height(28.dp))

        Column(Modifier.widthIn(max = 420.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedTextField(
                value = server, onValueChange = { server = it },
                label = { Text("Server") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next),
                // Self-hosted servers on a home network are often plain http; allowed, but said out loud.
                supportingText = if (server.trim().startsWith("http://")) {
                    { Text("Not encrypted: your password is sent in the clear. Fine on your own network, not over the internet.", color = Lotus.gold) }
                } else null,
            )
            OutlinedTextField(
                value = username, onValueChange = { username = it },
                label = { Text("Username or email") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                keyboardActions = KeyboardActions(onNext = { passwordFocus.requestFocus() }),
            )
            OutlinedTextField(
                value = password, onValueChange = { password = it },
                label = { Text("Password") }, singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth().focusRequester(passwordFocus),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(onGo = { submit() }),
            )
            state.error?.let { Text(it, color = Lotus.danger, fontSize = 14.sp) }
            Button(onClick = ::submit, enabled = !state.busy, modifier = Modifier.fillMaxWidth().height(48.dp)) {
                if (state.busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                else Text("Sign in", fontSize = 16.sp)
            }
        }
    }
}
