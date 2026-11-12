package com.collinpendleton.decklotus

import android.os.Bundle
import android.util.Log
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.collinpendleton.decklotus.ui.LotusTheme
import com.collinpendleton.decklotus.ui.AppRoot
import org.opencv.android.OpenCVLoader

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!OpenCVLoader.initLocal()) Log.e("DeckLotus", "OpenCV failed to load")
        enableEdgeToEdge()
        // Phone on a stand scanning a stack: don't let the screen sleep.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContent { LotusTheme { AppRoot() } }
    }
}
