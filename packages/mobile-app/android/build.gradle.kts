allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}

subprojects {
    afterEvaluate {
        if (project.plugins.hasPlugin("com.android.application") || project.plugins.hasPlugin("com.android.library")) {
            val android = project.extensions.getByType(com.android.build.gradle.BaseExtension::class.java)
            if (android.namespace == null) {
                when (project.name) {
                    "solana_wallet_adapter_android" -> android.namespace = "com.solana.mobilewalletadapter.clients.android"
                }
            }
        }
    }
}

subprojects {
    // `mic_stream` compila Kotlin a jvmTarget 21 mientras su modulo Java vecino
    // va a 1.8, y Gradle aborta con "Inconsistent JVM Target Compatibility".
    // Ningun modulo Android necesita mas de 17, asi que se fija aqui para
    // todos: la app ya usaba 17 y los plugins deben seguirla.
    plugins.withId("com.android.base") {
        extensions.configure<com.android.build.gradle.BaseExtension>("android") {
            compileOptions.sourceCompatibility = JavaVersion.VERSION_17
            compileOptions.targetCompatibility = JavaVersion.VERSION_17
        }
    }
    plugins.withId("org.jetbrains.kotlin.android") {
        extensions.configure<org.jetbrains.kotlin.gradle.dsl.KotlinAndroidProjectExtension>("kotlin") {
            compilerOptions.jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        }
    }
}

subprojects {
    project.evaluationDependsOn(":app")
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
