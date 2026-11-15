plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("org.jetbrains.kotlin.plugin.compose")
}

apply(from = rootProject.file("gradle/mantel-version.gradle.kts"))

android {
    namespace = "dev.mantel.calendar.tv"
    compileSdk = 35

    defaultConfig {
        applicationId = "dev.mantel.calendar.tv"
        minSdk = 26
        targetSdk = 35
        versionCode = extra["mantelVersionCode"] as Int
        versionName = extra["mantelVersionName"] as String
    }

    // The committed debug key, not ~/.android/debug.keystore. Same block in :phone.
    signingConfigs {
        create("mantel") {
            storeFile = rootProject.file("signing/mantel-debug.keystore")
            storePassword = "mantel-debug"
            keyAlias = "manteldebug"
            keyPassword = "mantel-debug"
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("mantel")
        }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("mantel")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
            excludes += "/META-INF/INDEX.LIST"
            excludes += "/META-INF/DEPENDENCIES"
            excludes += "/META-INF/io.netty.versions.properties"
        }
    }
}

dependencies {
    implementation(project(":core"))
    implementation(project(":device"))
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.tv:tv-material:1.0.0")
    implementation("androidx.tv:tv-foundation:1.0.0")
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("io.ktor:ktor-client-cio:2.3.12")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
}
