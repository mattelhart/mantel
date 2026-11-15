use url::Url;

pub const DEFAULT_SERVER: &str = "http://localhost:8080";

/// The address the window should open. A bare host is the Pi on port 8080.
/// A path is dropped: Mantel is served from the origin, and the web app routes itself.
pub fn normalize_server(raw: &str) -> Result<String, String> {
    let text = raw.trim();
    if text.is_empty() {
        return Err("Enter an address like http://localhost:8080".into());
    }
    let with_scheme = if text.contains("://") {
        text.to_string()
    } else {
        format!("http://{text}")
    };
    let mut url = Url::parse(&with_scheme)
        .map_err(|_| "Enter an address like http://localhost:8080".to_string())?;
    match url.scheme() {
        "http" | "https" => {}
        _ => return Err("Use an http or https address".into()),
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Leave the username and password off the address".into());
    }
    if url.host_str().is_none() {
        return Err("Enter an address like http://localhost:8080".into());
    }
    if url.port().is_none() && url.scheme() == "http" {
        let _ = url.set_port(Some(8080));
    }
    url.set_path("");
    url.set_query(None);
    url.set_fragment(None);
    let mut out = url.to_string();
    if out.ends_with('/') {
        out.pop();
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_default_and_a_bare_lan_address_use_port_8080() {
        assert_eq!(
            normalize_server("localhost").unwrap(),
            "http://localhost:8080"
        );
        assert_eq!(
            normalize_server("http://localhost:8080/").unwrap(),
            "http://localhost:8080"
        );
        assert_eq!(
            normalize_server("10.0.15.178").unwrap(),
            "http://10.0.15.178:8080"
        );
        assert_eq!(
            normalize_server("http://10.0.15.178:9090/calendar/today").unwrap(),
            "http://10.0.15.178:9090"
        );
    }

    #[test]
    fn https_keeps_its_own_port() {
        assert_eq!(
            normalize_server("https://calendar.example/mantel").unwrap(),
            "https://calendar.example"
        );
        assert_eq!(
            normalize_server("https://pi.local:8443").unwrap(),
            "https://pi.local:8443"
        );
    }

    #[test]
    fn blank_credentials_and_other_schemes_are_refused() {
        assert!(normalize_server("  ").is_err());
        assert!(normalize_server("http://user:pass@localhost:8080").is_err());
        assert!(normalize_server("ftp://localhost").is_err());
    }
}
