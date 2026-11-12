plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
    application
}

kotlin {
    jvmToolchain(17)
}

application {
    mainClass.set("com.collinpendleton.decklotus.indexer.MainKt")
    applicationDefaultJvmArgs = listOf("-Xmx3g", "-Djava.awt.headless=true")
}

tasks.named<JavaExec>("run") {
    // Relative paths in arguments resolve from android/, not android/indexer/.
    workingDir = rootProject.projectDir
}

dependencies {
    implementation(project(":core"))
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.core)
}
