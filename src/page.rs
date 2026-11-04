//! The complete phone interface arrives in one HTTP response. No blocking asset requests.
use std::sync::OnceLock;

pub struct Page {
    pub html: String,
    pub policy: String,
}
pub fn page() -> &'static Page {
    static PAGE: OnceLock<Page> = OnceLock::new();
    PAGE.get_or_init(|| {
        let css = include_str!("../web/style.css");
        let boot = include_str!("../web/boot.js");
        let gestures =
            include_str!("../web/gestures.js").replace("export class Gestures", "class Gestures");
        let text = include_str!("../web/text.js").replace("export function", "function");
        let app = include_str!("../web/app.js")
            .replace("import { Gestures } from './gestures.js';", "")
            .replace("import { textEdit, normalizeText } from './text.js';", "");
        let script = format!("(function () {{\n{gestures}\n{text}\n{app}\n}})();");
        let html = include_str!("../web/index.html")
            .replace(
                "<link rel=\"stylesheet\" href=\"/style.css\">",
                &format!("<style>{css}</style>"),
            )
            .replace(
                "<script type=\"module\" src=\"/app.js\"></script>",
                &format!("<script>{boot}</script><script>{script}</script>"),
            );
        let policy = format!(
            "style-src 'self' 'sha256-{}'; script-src 'self' 'sha256-{}' 'sha256-{}'",
            crate::crypto::sha256(css.as_bytes()),
            crate::crypto::sha256(boot.as_bytes()),
            crate::crypto::sha256(script.as_bytes())
        );
        Page { html, policy }
    })
}
#[cfg(test)]
mod tests {
    #[test]
    fn phone_boot_is_self_contained() {
        let page = super::page();
        assert!(!page.html.contains("rel=\"stylesheet\""));
        assert!(!page.html.contains("<script type=\"module\""));
        assert!(!page.html.contains("import { Gestures }"));
        assert!(!page.html.contains("export class"));
        assert!(page.html.contains("Tap to start typing"));
        assert!(page.html.contains("ghostpad-started"));
        for tag in ["script", "style"] {
            for rest in page.html.split(&format!("<{tag}>")).skip(1) {
                let content = rest.split_once(&format!("</{tag}>")).unwrap().0;
                assert!(
                    page.policy
                        .contains(&crate::crypto::sha256(content.as_bytes()))
                );
            }
        }
    }
}
