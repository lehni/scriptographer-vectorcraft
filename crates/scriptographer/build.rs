//! Picks what to embed: Scriptographer's bundle and the libraries it loads from the copy of
//! scriptographer-core in `core/` (`cargo xtask scriptographer-core`), or, with
//! `SCRIPTOGRAPHER_CORE=<dir>` set, from that checkout while the bundle is being developed; and
//! Paper.js from the same folder's `vendor/paper-hosted.js`, or, with
//! `SCRIPTOGRAPHER_PAPER_JS=<file>` set, that file, e.g. the latest `paper-hosted.js` built from
//! Paper.js's `develop` while Paper.js changes are being developed. A relative path is relative to
//! the workspace. Nothing is fetched: the build reads only local files.

use std::path::PathBuf;

fn main() {
    let crate_dir = PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap_or_default());
    let option = |name: &str| {
        println!("cargo::rerun-if-env-changed={name}");
        std::env::var_os(name).filter(|path| !path.is_empty()).map(PathBuf::from).map(|path| crate_dir.join("../..").join(path))
    };
    let core = option("SCRIPTOGRAPHER_CORE").unwrap_or_else(|| crate_dir.join("core"));
    let paper = option("SCRIPTOGRAPHER_PAPER_JS").unwrap_or_else(|| core.join("vendor/paper-hosted.js"));
    for path in [&core.join("dist/scriptographer.js"), &paper] {
        if !path.is_file() {
            println!("cargo::error=no such file: {}", path.display());
        }
    }
    for path in ["dist", "vendor"].map(|folder| core.join(folder)).iter().chain([&paper]) {
        println!("cargo::rerun-if-changed={}", path.display());
    }
    println!("cargo::rustc-env=SCRIPTOGRAPHER_CORE_PATH={}", core.display());
    println!("cargo::rustc-env=SCRIPTOGRAPHER_PAPER_JS_PATH={}", paper.display());
}
