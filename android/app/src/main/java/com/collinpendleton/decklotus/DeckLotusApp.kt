package com.collinpendleton.decklotus

import android.app.Application
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import com.collinpendleton.decklotus.data.Api
import com.collinpendleton.decklotus.data.AuthStore
import com.collinpendleton.decklotus.data.UploadQueue
import okhttp3.OkHttpClient
import java.io.File

class DeckLotusApp : Application(), SingletonImageLoader.Factory {
    val auth by lazy { AuthStore(this) }
    val api by lazy { Api(auth) }
    val uploads by lazy { UploadQueue(File(filesDir, "pending-uploads.json"), api) }

    /**
     * Scryfall's image CDN answers OkHttp's default User-Agent with HTTP 400,
     * so every card image request identifies the app instead.
     */
    override fun newImageLoader(context: PlatformContext): ImageLoader {
        val client = OkHttpClient.Builder()
            .addInterceptor { chain ->
                chain.proceed(
                    chain.request().newBuilder()
                        .header("User-Agent", "DeckLotus-Android/${BuildConfig.VERSION_NAME}")
                        .header("Accept", "image/*")
                        .build(),
                )
            }
            .build()
        return ImageLoader.Builder(context)
            .components { add(OkHttpNetworkFetcherFactory(callFactory = { client })) }
            .build()
    }
}
