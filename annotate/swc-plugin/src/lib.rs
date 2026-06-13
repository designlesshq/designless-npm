//! SWC plugin - stamp annotate/v1 source markers on host JSX elements.
//!
//! The Next/Turbopack engine of @designless/annotate. Same frozen contract as
//! the Babel engine (../../src/contract.js): on each intrinsic host JSX element
//! it adds `data-source-file` (repo-relative POSIX), `data-source-line`,
//! `data-selectable`, and `data-designless="annotate/v1"`. Components and
//! fragments are skipped; already-stamped elements are left untouched.
//!
//! Discipline (mirrors gating.js): never panic into the host build - a marker
//! we can't produce is simply not produced. The dev/prod gate lives in the
//! /next wrapper (production omits the plugin entirely -> byte-identity), so by
//! the time this runs we are in a dev build and should stamp.

use serde::Deserialize;
use swc_core::common::SourceMapper;
use swc_core::ecma::ast::{
    JSXAttr, JSXAttrName, JSXAttrOrSpread, JSXAttrValue, JSXElementName, JSXOpeningElement, Program,
    Str,
};
use swc_core::ecma::visit::{VisitMut, VisitMutWith};
use swc_core::plugin::metadata::TransformPluginMetadataContextKind;
use swc_core::plugin::proxies::{PluginSourceMapProxy, TransformPluginProgramMetadata};
use swc_core::plugin::plugin_transform;

const MARKER_VERSION: &str = "annotate/v1";

#[derive(Default, Deserialize)]
struct Config {
    /// Project root, passed by the /next wrapper so paths become repo-relative.
    #[serde(default)]
    root: String,
}

struct Annotate {
    root: String,
    filename: String,
    source_map: PluginSourceMapProxy,
}

/// Host element? Lowercase intrinsic (div, h1) or custom element (has a dash).
/// Mirrors contract.js `isHostElement`.
fn is_host(name: &str) -> bool {
    if name.is_empty() || name.contains('.') {
        return false;
    }
    let first = name.as_bytes()[0];
    first.is_ascii_lowercase() || name.contains('-')
}

/// Normalize an absolute file path to a repo-relative POSIX path, refusing
/// anything that would escape the root. Mirrors contract.js `toRepoRelative`.
fn to_repo_relative(root: &str, filename: &str) -> Option<String> {
    if root.is_empty() || filename.is_empty() {
        // No root -> emit the filename as-is only if it is already relative and
        // safe; otherwise skip. (Next often hands us project-relative paths.)
        let f = filename.replace('\\', "/");
        if !f.is_empty() && !f.starts_with('/') && !f.split('/').any(|s| s == "..") {
            return Some(f);
        }
        return None;
    }
    let r = root.trim_end_matches(['/', '\\']);
    if filename == r {
        return None;
    }
    let rel = if let Some(stripped) = filename.strip_prefix(&format!("{r}/")) {
        stripped
    } else if let Some(stripped) = filename.strip_prefix(&format!("{r}\\")) {
        stripped
    } else {
        // Filename may already be relative (Next/Turbopack); accept if safe.
        let f = filename.replace('\\', "/");
        if !f.starts_with('/') && !f.split('/').any(|s| s == "..") {
            return Some(f);
        }
        return None;
    };
    let rel = rel.replace('\\', "/");
    if rel.is_empty() || rel.starts_with('/') || rel.split('/').any(|s| s == "..") {
        return None;
    }
    Some(rel)
}

fn has_attr(el: &JSXOpeningElement, want: &str) -> bool {
    el.attrs.iter().any(|a| {
        if let JSXAttrOrSpread::JSXAttr(JSXAttr {
            name: JSXAttrName::Ident(id),
            ..
        }) = a
        {
            id.sym.as_ref() == want
        } else {
            false
        }
    })
}

fn str_attr(name: &str, value: &str) -> JSXAttrOrSpread {
    JSXAttrOrSpread::JSXAttr(JSXAttr {
        span: Default::default(),
        name: JSXAttrName::Ident(swc_core::ecma::ast::IdentName::new(
            name.into(),
            Default::default(),
        )),
        value: Some(JSXAttrValue::Str(Str {
            span: Default::default(),
            value: value.into(),
            raw: None,
        })),
    })
}

fn bare_attr(name: &str) -> JSXAttrOrSpread {
    JSXAttrOrSpread::JSXAttr(JSXAttr {
        span: Default::default(),
        name: JSXAttrName::Ident(swc_core::ecma::ast::IdentName::new(
            name.into(),
            Default::default(),
        )),
        value: None,
    })
}

impl Annotate {
    fn line_of(&self, el: &JSXOpeningElement) -> Option<usize> {
        let loc = self.source_map.lookup_char_pos(el.span.lo);
        if loc.line > 0 {
            Some(loc.line)
        } else {
            None
        }
    }
}

impl VisitMut for Annotate {
    fn visit_mut_jsx_opening_element(&mut self, el: &mut JSXOpeningElement) {
        el.visit_mut_children_with(self);

        let name = match &el.name {
            JSXElementName::Ident(id) => id.sym.as_ref().to_string(),
            _ => return, // member / namespaced -> not a host tag
        };
        if !is_host(&name) {
            return;
        }
        // Idempotent: never double-stamp (re-run, or author-placed markers).
        if has_attr(el, "data-source-file") {
            return;
        }
        let rel = match to_repo_relative(&self.root, &self.filename) {
            Some(r) => r,
            None => return, // unstampable file -> skip, contract-safe
        };

        el.attrs.push(str_attr("data-source-file", &rel));
        if let Some(line) = self.line_of(el) {
            el.attrs.push(str_attr("data-source-line", &line.to_string()));
        }
        if !has_attr(el, "data-selectable") {
            el.attrs.push(bare_attr("data-selectable"));
        }
        el.attrs.push(str_attr("data-designless", MARKER_VERSION));
    }
}

#[plugin_transform]
fn designless_annotate(mut program: Program, metadata: TransformPluginProgramMetadata) -> Program {
    let config: Config = metadata
        .get_transform_plugin_config()
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default();

    let filename = metadata
        .get_context(&TransformPluginMetadataContextKind::Filename)
        .unwrap_or_default();

    let mut visitor = Annotate {
        root: config.root,
        filename,
        source_map: metadata.source_map.clone(),
    };
    program.visit_mut_with(&mut visitor);
    program
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_detection_matches_the_contract() {
        assert!(is_host("div"));
        assert!(is_host("h1"));
        assert!(is_host("my-widget"));
        assert!(!is_host("SkillCard"));
        assert!(!is_host("Foo.Bar"));
        assert!(!is_host(""));
    }

    #[test]
    fn repo_relative_confinement() {
        assert_eq!(
            to_repo_relative("/repo", "/repo/src/page.tsx").as_deref(),
            Some("src/page.tsx")
        );
        assert_eq!(to_repo_relative("/repo", "/etc/passwd"), None);
        assert_eq!(to_repo_relative("/repo", "/repo"), None);
        // Already-relative (Next) passes through when safe.
        assert_eq!(
            to_repo_relative("", "app/page.tsx").as_deref(),
            Some("app/page.tsx")
        );
        assert_eq!(to_repo_relative("", "../escape.tsx"), None);
    }
}

