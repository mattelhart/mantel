const input = document.getElementById("server")
const status = document.getElementById("status")

function invoke(command, args) {
  const core = window.__TAURI__ && window.__TAURI__.core
  if (!core) {
    return Promise.reject("Open this page in Mantel Calendar.")
  }
  return core.invoke(command, args)
}

function message(error) {
  if (typeof error === "string") return error
  if (error && typeof error === "object" && "message" in error) return String(error.message)
  return "Could not reach the server."
}

invoke("current_server")
  .then((url) => {
    if (url) input.value = url
  })
  .catch(() => {})

document.getElementById("test").addEventListener("click", async () => {
  status.textContent = "Checking…"
  try {
    const origin = await invoke("test_server", { url: input.value })
    input.value = origin
    status.textContent = `Reached ${origin}`
  } catch (error) {
    status.textContent = message(error)
  }
})

document.getElementById("open").addEventListener("click", async () => {
  status.textContent = "Opening…"
  try {
    await invoke("open_server", { url: input.value })
  } catch (error) {
    status.textContent = message(error)
  }
})

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter") document.getElementById("open").click()
})
