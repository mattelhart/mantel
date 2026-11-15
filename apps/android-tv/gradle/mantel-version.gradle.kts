// versionCode has to move forward. Android rejects an update whose code is
// lower than the one installed. The commit count does that for a full
// checkout, and a rebuild of the same commit stays installable. A shallow
// clone would report a tiny count and then refuse to install over a real one.
val repoRoot = rootProject.projectDir.parentFile.parentFile

fun gitOutput(vararg args: String): String {
    val exec = providers.exec {
        commandLine("git", "-C", repoRoot.absolutePath, *args)
        isIgnoreExitValue = true
    }
    val result = exec.result.get()
    val text = exec.standardOutput.asText.get().trim()
    if (result.exitValue != 0) {
        val err = exec.standardError.asText.get().trim()
        throw GradleException("git ${args.joinToString(" ")} failed: $err")
    }
    return text
}

val versionCodeOverride = providers.gradleProperty("mantel.versionCode").orNull?.trim()
val mantelVersionCode = if (!versionCodeOverride.isNullOrEmpty()) {
    versionCodeOverride.toInt()
} else {
    if (gitOutput("rev-parse", "--is-shallow-repository") == "true") {
        throw GradleException(
            "This git checkout is shallow, so the versionCode would be too small to install " +
                "over a previous build. Fetch the full history, or pass -Pmantel.versionCode=N " +
                "with N at least as high as the installed app.",
        )
    }
    val count = gitOutput("rev-list", "--count", "HEAD").toIntOrNull()
        ?: throw GradleException("git rev-list did not return a versionCode")
    if (count < 1) throw GradleException("versionCode must be at least 1")
    count
}

val mantelVersionName = repoRoot.resolve("VERSION").readText().trim() + " ($mantelVersionCode)"

extra["mantelVersionCode"] = mantelVersionCode
extra["mantelVersionName"] = mantelVersionName
logger.lifecycle("${project.name}: versionName=$mantelVersionName versionCode=$mantelVersionCode")
