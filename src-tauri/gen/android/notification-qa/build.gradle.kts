plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "com.nuvio.notificationqa"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.nuvio.notificationqa"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
        testInstrumentationRunner = "com.nuvio.notificationqa.NotificationInstrumentation"
    }
    sourceSets["main"].java.srcDir(layout.buildDirectory.dir("production"))
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.fromTarget("17")
    }
}
val copyProductionNotifications by tasks.registering(Copy::class) {
    from("../app/src/main/java/com/nuvio/drive") {
        include("NuvioForegroundService.kt", "NuvioNotificationContent.kt")
    }
    into(layout.buildDirectory.dir("production/com/nuvio/drive"))
}
tasks.named("preBuild").configure { dependsOn(copyProductionNotifications) }
dependencies { implementation("androidx.core:core-ktx:1.16.0") }
