plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "com.collinpendleton.decklotus"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.collinpendleton.decklotus"
        minSdk = 26
        targetSdk = 36
        // CI sets these for release builds: the code must grow with every build so a new APK
        // installs over the old one. Local builds keep the base numbers.
        versionCode = System.getenv("VERSION_CODE")?.toInt() ?: 4
        versionName = "0.4.0" + (System.getenv("VERSION_SUFFIX") ?: "")
        ndk {
            // Real phones only: OpenCV's native lib is 24-60 MB per ABI, and the
            // emulator's camera is no use for testing a scanner anyway.
            abiFilters += setOf("arm64-v8a")
        }
    }

    // The release key lives outside the repo (CI decodes it from a secret). Without it, local
    // release builds fall back to the debug key so they can still be side-loaded for testing.
    val releaseKeystore = System.getenv("RELEASE_STORE_FILE")?.let(::file)?.takeIf { it.exists() }
    signingConfigs {
        if (releaseKeystore != null) create("release") {
            storeFile = releaseKeystore
            storePassword = System.getenv("RELEASE_STORE_PASSWORD")
            keyAlias = System.getenv("RELEASE_KEY_ALIAS")
            keyPassword = System.getenv("RELEASE_KEY_PASSWORD")
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            isMinifyEnabled = false
            // Not debuggable, so ART compiles it properly: the debug build runs
            // the index loader many times slower.
            signingConfig = signingConfigs.getByName(if (releaseKeystore != null) "release" else "debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    androidResources {
        // The card index is already gzipped.
        noCompress += "bin"
    }

    lint {
        abortOnError = false
        disable += setOf("GradleDependency", "NewerVersionAvailable", "AndroidGradlePluginVersion", "OldTargetApi")
    }
}

dependencies {
    implementation(project(":core"))

    implementation(libs.androidx.core)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons)
    debugImplementation(libs.compose.ui.tooling)

    implementation(libs.camerax.core)
    implementation(libs.camerax.camera2)
    implementation(libs.camerax.lifecycle)
    implementation(libs.camerax.view)
    implementation(libs.mlkit.text)
    implementation(libs.opencv)

    implementation(libs.coil.compose)
    implementation(libs.coil.network)
    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
}
