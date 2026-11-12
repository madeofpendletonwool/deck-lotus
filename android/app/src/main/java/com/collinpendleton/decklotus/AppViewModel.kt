package com.collinpendleton.decklotus

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.collinpendleton.decklotus.data.Account
import com.collinpendleton.decklotus.data.ApiException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.io.IOException

data class LoginState(val busy: Boolean = false, val error: String? = null)

/** Who's signed in, and the sign-in form. */
class AppViewModel(app: Application) : AndroidViewModel(app) {
    private val deps = app as DeckLotusApp

    private val _account = MutableStateFlow(deps.auth.account)
    val account: StateFlow<Account?> = _account.asStateFlow()

    private val _login = MutableStateFlow(LoginState())
    val login: StateFlow<LoginState> = _login.asStateFlow()

    val lastServer get() = deps.auth.lastServer
    val lastUsername get() = deps.auth.lastUsername

    init {
        // A refresh token that stopped working (expired, server secret changed).
        viewModelScope.launch {
            deps.api.signedOut.collect {
                _account.value = null
                _login.value = LoginState(error = "Your session ended. Sign in again.")
            }
        }
    }

    fun signIn(server: String, username: String, password: String) {
        if (username.isBlank() || password.isEmpty()) {
            _login.value = LoginState(error = "Enter your username and password.")
            return
        }
        _login.value = LoginState(busy = true)
        viewModelScope.launch {
            try {
                _account.value = deps.api.login(server, username, password)
                _login.value = LoginState()
            } catch (e: ApiException) {
                _login.value = LoginState(
                    error = when (e.code) {
                        401 -> "Wrong username or password."
                        0 -> e.message
                        404 -> "No Deck Lotus server at that address."
                        else -> e.message ?: "Sign-in failed (${e.code})."
                    },
                )
            } catch (e: IOException) {
                // Include the reason (no route, refused, TLS, timeout): it's what tells you which.
                _login.value = LoginState(error = "Can't reach that server. Check the address and your connection. (${e.message ?: e.javaClass.simpleName})")
            } catch (e: Exception) {
                // e.g. the address answered with a web page instead of JSON.
                _login.value = LoginState(error = "That address didn't answer like a Deck Lotus server.")
            }
        }
    }

    fun signOut() {
        deps.api.logout()
        _account.value = null
    }
}
