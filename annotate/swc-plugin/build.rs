// The newer swc_core this crate pins spells a JSX attribute's string value as
// `JSXAttrValue::Str`. The Next-15 sibling crate pins a core that spells it
// `JSXAttrValue::Lit(Lit::Str(..))` and therefore does NOT set this cfg.
//
// Declared per-crate rather than sniffed, because a wrong guess produces a wasm
// that builds cleanly and then fails to invoke against its host — the silent
// failure this whole two-ABI arrangement exists to end.
fn main() {
    println!("cargo::rustc-check-cfg=cfg(swc_jsx_attr_str)");
    println!("cargo::rustc-cfg=swc_jsx_attr_str");
}
