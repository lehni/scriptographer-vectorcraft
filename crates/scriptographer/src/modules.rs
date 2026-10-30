//! What scripts import, and their workers load, outside a browser: the bundle resolves and runs
//! `import`s (core's `src/modules.js`) and reads each module with `readModule(url)` ([`read`]): a
//! file, or a URL on the web, which loads on the script's thread and shows in the console. Workers
//! find their scripts with [`locate`].

use std::path::{Path, PathBuf};

use crate::{Call, Error, Value};

/// `readModule(url)`: the text of the module at `url`, a `file:` URL or one on the web.
pub(crate) fn read<H>(call: &mut dyn Call<H>, _this: &Value<H>, args: &[Value<H>]) -> Result<Value<H>, Error> {
    let url = call.to_string(args.first().unwrap_or(&Value::Undefined))?;
    let key = match url::Url::parse(&url) {
        Ok(parsed) if parsed.scheme() == "file" => {
            parsed.to_file_path().map_err(|()| Error::Script(format!("{url} names no file")))?.to_string_lossy().into_owned()
        }
        Ok(_) if is_web(&url) => url,
        _ => return Err(Error::Script(format!("{url} is neither a file nor on the web"))),
    };
    let cache = call.host()?.borrow().cache.clone();
    source(&key, cache.as_deref()).map(Value::String).map_err(Error::Script)
}

/// The module `specifier` names, imported by the code at `importer` (a path or a URL; the script's
/// folder when there is none), as its canonical path or its URL.
pub(crate) fn locate(specifier: &str, importer: Option<&str>, directory: Option<PathBuf>) -> Result<String, Error> {
    let fail = |e: &dyn std::fmt::Display| Error::Script(format!("import '{specifier}': {e}"));
    if let Ok(url) = url::Url::parse(specifier)
        && url.scheme() != "file"
    {
        return Ok(url.to_string());
    }
    if let Some(base) = importer.and_then(|i| url::Url::parse(i).ok()).filter(|u| matches!(u.scheme(), "https" | "http")) {
        return base.join(specifier).map(|u| u.to_string()).map_err(|e| fail(&e));
    }
    let folder = importer.and_then(|i| Path::new(i).parent().map(Path::to_path_buf)).or(directory);
    let path = match folder {
        Some(folder) if Path::new(specifier).is_relative() => folder.join(specifier),
        _ => PathBuf::from(specifier),
    };
    let path = std::fs::canonicalize(&path).map_err(|e| fail(&e))?;
    Ok(path.to_string_lossy().into_owned())
}

fn is_web(key: &str) -> bool {
    url::Url::parse(key).is_ok_and(|url| matches!(url.scheme(), "https" | "http"))
}

/// The text of the script at `key` ([`locate`]): downloaded when it's a URL, with its copy in
/// `cache`, else read.
pub(crate) fn source(key: &str, cache: Option<&Path>) -> Result<String, String> {
    if is_web(key) { download(key, cache) } else { std::fs::read_to_string(key).map_err(|e| e.to_string()) }
}

/// What the cache keeps of a download besides its text: what tells the server which one it is.
#[derive(Default, serde::Serialize, serde::Deserialize)]
struct Cached {
    url: String,
    etag: Option<String>,
    modified: Option<String>,
}

/// The text at `url`, downloaded on the script's thread. With a `cache`, the copy kept there is
/// what the server says is still the one (`304 Not Modified`, asked by its `ETag` or
/// `Last-Modified`), and what stands in when the server can't be reached or fails (5xx); each
/// download is kept there, a file named for its URL, with what tells the server which it is.
fn download(url: &str, cache: Option<&Path>) -> Result<String, String> {
    use sha2::Digest as _;
    let name: String = sha2::Sha256::digest(url.as_bytes()).iter().take(12).map(|b| format!("{b:02x}")).collect();
    let files = cache.map(|cache| (cache.join(format!("{name}.js")), cache.join(format!("{name}.json"))));
    let kept = files.as_ref().and_then(|(text, about)| {
        let about: Cached = serde_json::from_slice(&std::fs::read(about).ok()?).ok().filter(|a: &Cached| a.url == url)?;
        Some((std::fs::read_to_string(text).ok()?, about))
    });
    let mut asking = Vec::new();
    if let Some((_, about)) = &kept {
        asking.extend(about.etag.clone().map(|etag| ("If-None-Match".to_owned(), etag)));
        asking.extend(about.modified.clone().map(|modified| ("If-Modified-Since".to_owned(), modified)));
    }
    let answer = match crate::fetch::get(url, &asking) {
        Ok(answer) => answer,
        Err(e) => return kept.map(|(text, _)| text).ok_or(e),
    };
    match (answer.status, kept) {
        (304, Some((text, _))) => Ok(text),
        (500..=599, Some((text, _))) => Ok(text),
        (200..=299, _) => {
            let text = String::from_utf8_lossy(&answer.body).into_owned();
            if let Some((text_file, about_file)) = files {
                let header = |name: &str| answer.headers.iter().find(|(n, _)| n.eq_ignore_ascii_case(name)).map(|(_, v)| v.clone());
                let about = Cached { url: url.to_owned(), etag: header("etag"), modified: header("last-modified") };
                // A copy that can't be kept only costs the next download.
                let _ = keep(&text_file, &about_file, &text, &about);
            }
            Ok(text)
        }
        (status, _) => Err(format!("{url} answered {status}")),
    }
}

/// Keeps a download's `text` and what's `about` it.
fn keep(text_file: &Path, about_file: &Path, text: &str, about: &Cached) -> Result<(), String> {
    if let Some(folder) = text_file.parent() {
        std::fs::create_dir_all(folder).map_err(|e| e.to_string())?;
    }
    std::fs::write(text_file, text).map_err(|e| e.to_string())?;
    std::fs::write(about_file, serde_json::to_vec(about).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}
